import Foundation
import UserNotifications

/**
 * Keeps signed-in mailboxes in step with Gmail, local-first like core's
 * mail-sync.ts: the store renders from its copy (cached on disk, so launch
 * is instant), changes are made there first and then written to Gmail, and
 * Gmail's history catches the copy up when the relay says a mailbox changed,
 * on launch and when the app comes back.
 */
@MainActor
final class MailSync {
    private let store: MailStore
    private let google: GoogleAuth
    private var states: [String: MailboxState] = [:]
    private var running: [String: Task<Void, Never>] = [:]
    private var saving: Task<Void, Never>?

    /** What's kept per mailbox besides its threads: Gmail's cursor and where each folder's list got to. */
    struct MailboxState: Codable {
        var historyID: String?
        var draftIDs: [String: String] = [:]
        /** Folder key → the next page's token; "" once the folder has no more. */
        var pages: [String: String] = [:]
        var watchedAt: Date?
    }

    init(store: MailStore, google: GoogleAuth) {
        self.store = store
        self.google = google
    }

    private func api(_ email: String) -> GmailAPI {
        GmailAPI(email: email) { [google] force in try await google.accessToken(email, force: force) }
    }

    // ── The cache ────────────────────────────────────────────────────────────

    private struct Cached: Codable {
        var mailbox: Mailbox
        var state: MailboxState
        var threads: [MailThread]
    }

    private static let folder = URL.applicationSupportDirectory.appending(path: "mail", directoryHint: .isDirectory)
    private static func file(_ email: String) -> URL { folder.appending(path: "\(email.lowercased()).json") }

    /** The mailboxes as they were last time, straight from disk. */
    func loadCache(for emails: [String]) {
        for email in emails {
            guard
                let data = try? Data(contentsOf: Self.file(email)),
                let cached = try? JSONDecoder().decode(Cached.self, from: data)
            else { continue }
            states[email] = cached.state
            store.upsert(mailbox: cached.mailbox)
            store.upsert(threads: cached.threads)
        }
    }

    /** Writes the copy soon (changes come in bursts). */
    private func scheduleSave() {
        saving?.cancel()
        saving = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            save()
        }
    }

    private func save() {
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        for mailbox in store.mailboxes where !mailbox.signedOut {
            // The newest few hundred threads are plenty to open with; the rest reloads.
            let threads = store.allThreads(of: mailbox.email).sorted { $0.latest.date > $1.latest.date }.prefix(400)
            let cached = Cached(mailbox: mailbox, state: states[mailbox.email] ?? MailboxState(), threads: Array(threads))
            try? JSONEncoder().encode(cached).write(to: Self.file(mailbox.email), options: .atomic)
        }
    }

    func forget(_ email: String) {
        states[email] = nil
        running[email]?.cancel()
        running[email] = nil
        try? FileManager.default.removeItem(at: Self.file(email))
    }

    func forgetAll() {
        for email in Array(states.keys) { forget(email) }
        try? FileManager.default.removeItem(at: Self.folder)
    }

    // ── Syncing ──────────────────────────────────────────────────────────────

    /** Catches every signed-in, turned-on mailbox up with Gmail. */
    func syncAll(notify: Bool = false) async {
        await withTaskGroup(of: Void.self) { group in
            for mailbox in store.shownMailboxes where !mailbox.signedOut {
                group.addTask { await self.sync(mailbox.email, notify: notify) }
            }
        }
    }

    /** Catches one mailbox up (one sync at a time per mailbox). */
    func sync(_ email: String, notify: Bool = false) async {
        if let running = running[email] { return await running.value }
        let task = Task { await run(email, notify: notify) }
        running[email] = task
        await task.value
        running[email] = nil
    }

    private func run(_ email: String, notify: Bool) async {
        let api = api(email)
        var state = states[email] ?? MailboxState()
        do {
            if let historyID = state.historyID {
                do {
                    let (changed, cursor) = try await api.history(since: historyID)
                    let before = Dictionary(uniqueKeysWithValues: changed.compactMap { id in store.thread(id).map { (id, $0) } })
                    let fresh = try await api.threads(Array(changed))
                    store.upsert(threads: fresh)
                    store.remove(threadIDs: changed.subtracting(fresh.map(\.id)))
                    if !changed.isEmpty { state.draftIDs = try await api.draftIDs() }
                    state.historyID = cursor
                    if notify { await announce(fresh, before: before) }
                } catch is GmailAPI.HistoryExpired {
                    state = MailboxState(watchedAt: state.watchedAt)
                    store.remove(threadIDs: Set(store.allThreads(of: email).map(\.id)))
                }
            }
            if state.historyID == nil {
                // First sync: where Gmail is now, then the inbox's first page.
                state.historyID = try await api.historyID()
                let (ids, next) = try await api.threadIDs(label: "INBOX")
                store.upsert(threads: try await api.threads(ids))
                state.pages[Self.key(.inbox)] = next ?? ""
                state.draftIDs = try await api.draftIDs()
            }
            if var mailbox = store.mailbox(email) {
                mailbox.labels = try await api.labels()
                mailbox.signature = try await api.signature()
                store.upsert(mailbox: mailbox)
            }
            states[email] = state
            scheduleSave()
        } catch GoogleAuth.Failure.signedOut {
            store.setSignedOut(true, email)
        } catch {
            // Offline or Gmail refused: the copy stands, and the next sync tries again.
        }
    }

    /** Asks Gmail to push this mailbox's changes to the relay, once a day. */
    func watch(topic: String) async {
        for mailbox in store.shownMailboxes where !mailbox.signedOut {
            var state = states[mailbox.email] ?? MailboxState()
            guard (state.watchedAt ?? .distantPast) < .now.addingTimeInterval(-86_400) else { continue }
            guard (try? await api(mailbox.email).watch(topic: topic)) != nil else { continue }
            state.watchedAt = .now
            states[mailbox.email] = state
        }
        scheduleSave()
    }

    // ── Folders and search ───────────────────────────────────────────────────

    private static func key(_ folder: Folder) -> String {
        switch folder {
        case .label(let id, _): "label:\(id)"
        default: folder.title
        }
    }

    private static func gmailLabel(_ folder: Folder) -> String? {
        switch folder {
        case .inbox: "INBOX"
        case .starred: "STARRED"
        case .sent: "SENT"
        case .drafts: "DRAFT"
        case .important: "IMPORTANT"
        case .allMail: nil
        case .junk: "SPAM"
        case .trash: "TRASH"
        case .label(let id, _): id
        }
    }

    /** Whether a folder has more in Gmail than has been loaded. */
    func hasMore(_ folder: Folder, scope: String?) -> Bool {
        mailboxes(scope).contains { states[$0]?.pages[Self.key(folder)] != "" }
    }

    /** The folder's next page in each mailbox of `scope` (its first, the first time). */
    func loadMore(_ folder: Folder, scope: String?) async {
        let key = Self.key(folder)
        for email in mailboxes(scope) where states[email]?.pages[key] != "" {
            let api = api(email)
            guard let (ids, next) = try? await api.threadIDs(label: Self.gmailLabel(folder), pageToken: states[email]?.pages[key]) else { continue }
            let missing = ids.filter { store.thread($0) == nil }
            if let threads = try? await api.threads(missing) { store.upsert(threads: threads) }
            states[email, default: MailboxState()].pages[key] = next ?? ""
        }
        scheduleSave()
    }

    /** Gmail's search, in each mailbox of `scope`; answers the matching thread ids. */
    func search(_ query: String, scope: String?) async -> [String] {
        var found: [String] = []
        for email in mailboxes(scope) {
            guard let (ids, _) = try? await api(email).threadIDs(label: nil, query: query, max: 25) else { continue }
            let missing = ids.filter { store.thread($0) == nil }
            if let threads = try? await api(email).threads(missing) { store.upsert(threads: threads) }
            found += ids
        }
        return found
    }

    private func mailboxes(_ scope: String?) -> [String] {
        store.shownMailboxes.filter { !$0.signedOut && (scope == nil || $0.email == scope) }.map(\.email)
    }

    // ── Writing changes to Gmail ─────────────────────────────────────────────

    /** Writes a change the store already shows; if Gmail refuses, the thread is reloaded as Gmail has it. */
    func apply(_ change: MailStore.Change, to thread: MailThread) {
        guard store.mailbox(thread.mailbox)?.signedOut == false else { return }
        let api = api(thread.mailbox)
        Task {
            do {
                switch change {
                case .modify(let add, let remove): try await api.modify(thread: thread.id, add: add, remove: remove)
                case .star(let message): try await api.modify(message: message, add: ["STARRED"])
                case .trash: try await api.trash(thread: thread.id)
                case .untrash: try await api.untrash(thread: thread.id)
                case .delete: try await api.delete(thread: thread.id)
                }
            } catch {
                await reload(thread.id, in: thread.mailbox)
            }
            scheduleSave()
        }
    }

    private func reload(_ id: String, in email: String) async {
        if let thread = try? await api(email).thread(id) {
            store.upsert(threads: [thread])
        } else {
            store.remove(threadIDs: [id])
        }
    }

    /** Sends (or keeps in Drafts) a message the store already shows, then loads Gmail's copy of its thread. */
    func write(_ draft: Draft, asDraft: Bool) async throws {
        guard let mailbox = store.mailbox(draft.from) else { return }
        let api = api(mailbox.email)
        let replyTo = draft.threadID.flatMap(store.thread)
        let quoted = replyTo.map { $0.sent.last ?? $0.latest }
        let raw = MIME.message(
            from: mailbox.me,
            to: Draft.people(draft.to),
            cc: Draft.people(draft.cc),
            subject: draft.subject,
            text: draft.body,
            html: Compose.html(draft.body, signature: mailbox.signature),
            inReplyTo: quoted?.headers["Message-ID"],
            references: quoted?.headers["References"]
        )
        let draftID = draft.messageID.flatMap { states[mailbox.email]?.draftIDs[$0] }
        let sent: GmailAPI.Sent
        if asDraft {
            let saved = try await api.saveDraft(id: draftID, raw: raw, thread: draft.threadID)
            states[mailbox.email, default: MailboxState()].draftIDs[saved.message.id] = saved.draft
            sent = saved.message
        } else if let draftID {
            _ = try await api.saveDraft(id: draftID, raw: raw, thread: draft.threadID)
            sent = try await api.sendDraft(id: draftID)
        } else {
            sent = try await api.send(raw: raw, thread: draft.threadID)
        }
        await reload(sent.threadId, in: mailbox.email)
        scheduleSave()
    }

    func discard(_ draft: Draft) async {
        guard
            let messageID = draft.messageID,
            let draftID = states[draft.from]?.draftIDs[messageID]
        else { return }
        try? await api(draft.from).deleteDraft(id: draftID)
        states[draft.from]?.draftIDs[messageID] = nil
        scheduleSave()
    }

    func setSignature(_ html: String, for email: String) async throws {
        let saved = try await api(email).setSignature(html)
        if var mailbox = store.mailbox(email) {
            mailbox.signature = saved
            store.upsert(mailbox: mailbox)
        }
        scheduleSave()
    }

    func attachment(_ attachment: Attachment, of message: Message, in email: String) async throws -> URL {
        guard let id = attachment.id else { throw GmailAPI.Failure(status: 0, message: "No file to open.") }
        let data = try await api(email).attachment(message: message.id, id: id)
        let folder = URL.temporaryDirectory.appending(path: message.id, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: attachment.filename.isEmpty ? "attachment" : attachment.filename)
        try data.write(to: url)
        return url
    }

    // ── Notifications ────────────────────────────────────────────────────────

    /** New mail found by sync, as Settings › Notifications says (core's notifier.ts). */
    private func announce(_ threads: [MailThread], before: [String: MailThread]) async {
        let mode = store.preferences.notifications
        guard mode != .off else { return }
        for thread in threads {
            let known = Set(before[thread.id]?.messages.map(\.id) ?? [])
            let arrived = thread.messages.filter { !known.contains($0.id) && $0.unread && !$0.draft }
            guard let message = arrived.last else { continue }
            if mode == .inbox && !thread.labels.contains("INBOX") { continue }
            let content = UNMutableNotificationContent()
            content.title = message.from.label
            content.subtitle = thread.subject
            content.body = message.snippet
            content.sound = .default
            content.threadIdentifier = thread.id
            content.userInfo = ["thread": thread.id]
            try? await UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: message.id, content: content, trigger: nil)
            )
        }
    }
}

/** What the composer's plain text becomes as HTML, with the mailbox's signature as Gmail keeps it. */
enum Compose {
    static func html(_ text: String, signature: String) -> String {
        let escape = { (s: String) in
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\n", with: "<br>")
        }
        // The composer shows the signature as text; send Gmail's formatted one in its place.
        let plain = Signature.plainText(signature)
        if !plain.isEmpty, let range = text.range(of: plain) {
            return "<div dir=\"ltr\">\(escape(String(text[..<range.lowerBound])))\(signature)\(escape(String(text[range.upperBound...])))</div>"
        }
        return "<div dir=\"ltr\">\(escape(text))</div>"
    }
}
