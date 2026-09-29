import Foundation
import UserNotifications

/**
 * Keeps signed-in mailboxes in step with their servers, local-first like
 * core's mail-sync.ts: the store renders from its copy (cached on disk, so
 * launch is instant), changes are made there first and then written through
 * the mailbox's provider (Gmail or IMAP), and the provider catches the copy
 * up when a mailbox changed (a relay event, IDLE), on launch and when the
 * app comes back.
 */
@MainActor
final class MailSync {
    private let store: MailStore
    private let google: GoogleAuth
    private var providers: [String: any MailProvider] = [:]
    private var states: [String: MailboxState] = [:]
    private var running: [String: Task<Void, Never>] = [:]
    private var watching: [String: Task<Void, Never>] = [:]
    private var saving: Task<Void, Never>?
    /** Mailboxes with a provider call under way, and the calls waiting their turn. */
    private var busy: Set<String> = []
    private var waiting: [String: [CheckedContinuation<Void, Never>]] = [:]

    init(store: MailStore, google: GoogleAuth) {
        self.store = store
        self.google = google
    }

    /** The mailbox's provider: IMAP when it has IMAP settings, else Gmail. */
    private func provider(_ email: String) -> any MailProvider {
        if let provider = providers[email] { return provider }
        let provider: any MailProvider = if let settings = store.mailbox(email)?.imap {
            ImapProvider(email: email, settings: settings)
        } else {
            GmailProvider(api: GmailAPI(email: email) { [google] force in try await google.accessToken(email, force: force) })
        }
        providers[email] = provider
        return provider
    }

    /**
     * Runs `body` with the mailbox's provider and state, then shows what it
     * answers. For a provider whose calls rewrite what's here (`takesTurns`:
     * IMAP moves re-key messages), one at a time per mailbox, so each starts
     * from what the last left: a sync that IDLE starts while a move is under
     * way would otherwise bring the thread back as it was. Gmail's calls run
     * side by side, as bulk actions want.
     */
    @discardableResult
    private func run(
        _ email: String, _ body: (any MailProvider, inout MailboxState, [MailThread]) async throws -> MailDelta
    ) async throws -> MailDelta {
        let provider = provider(email)
        let turns = provider.takesTurns
        if turns, busy.contains(email) {
            await withCheckedContinuation { waiting[email, default: []].append($0) }
        } else if turns {
            busy.insert(email)
        }
        defer {
            if turns, let next = waiting[email]?.first {
                waiting[email]?.removeFirst()
                next.resume()
            } else if turns {
                busy.remove(email)
            }
        }
        var state = states[email] ?? MailboxState()
        let delta = try await body(provider, &state, store.allThreads(of: email))
        states[email] = state
        store.remove(threadIDs: delta.removed.subtracting(delta.threads.map(\.id)))
        store.upsert(threads: delta.threads)
        scheduleSave()
        return delta
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
        providers[email] = nil
        running[email]?.cancel()
        running[email] = nil
        watching.removeValue(forKey: email)?.cancel()
        try? FileManager.default.removeItem(at: Self.file(email))
    }

    func forgetAll() {
        for email in Set(states.keys).union(providers.keys) { forget(email) }
        try? FileManager.default.removeItem(at: Self.folder)
    }

    // ── Syncing ──────────────────────────────────────────────────────────────

    /** Catches every signed-in, turned-on mailbox up. */
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
        let task = Task { await catchUp(email, notify: notify) }
        running[email] = task
        await task.value
        running[email] = nil
    }

    private func catchUp(_ email: String, notify: Bool) async {
        do {
            let before = Dictionary(store.allThreads(of: email).map { ($0.id, $0) }) { a, _ in a }
            let delta = try await run(email) { provider, state, known in try await provider.sync(&state, known: known) }
            if notify { await announce(delta.threads, before: before) }
            let provider = provider(email)
            let labels = try await provider.labels()
            let signature = try await provider.signature()
            // Read after the awaits, so what changed meanwhile (a synced signature) isn't written over.
            if var mailbox = store.mailbox(email) {
                mailbox.labels = labels
                if let signature { mailbox.signature = signature }
                store.upsert(mailbox: mailbox)
            }
            scheduleSave()
        } catch where Self.signedOut(error) {
            // A password the server refuses is no use kept (as GoogleAuth drops a revoked sign-in).
            if store.mailbox(email)?.imap != nil { ImapProvider.setPassword(nil, for: email) }
            store.setSignedOut(true, email)
            providers[email] = nil
        } catch {
            // Offline or the server refused: the copy stands, and the next sync tries again.
        }
    }

    /** The sign-in is gone (Google's, or the IMAP password): only signing in again helps. */
    private static func signedOut(_ error: Error) -> Bool {
        if case GoogleAuth.Failure.signedOut = error { return true }
        return (error as? ImapError)?.isSignedOut == true
    }

    // ── Live ─────────────────────────────────────────────────────────────────

    /** Keeps new mail coming while the app is open (Gmail's pushes through the relay, IMAP's IDLE). */
    func watch(pushTopic: String?) async {
        for mailbox in store.shownMailboxes where !mailbox.signedOut && watching[mailbox.email] == nil {
            let email = mailbox.email
            var task: Task<Void, Never>?
            _ = try? await run(email) { provider, state, _ in
                task = await provider.watch(pushTopic: pushTopic, &state) { [weak self] in
                    Task { await self?.sync(email, notify: true) }
                }
                return MailDelta()
            }
            if let task { watching[email] = task }
        }
    }

    /** The app went to the background: IDLE stops (Gmail's pushes carry on through the relay). */
    func stopWatching() {
        for task in watching.values { task.cancel() }
        watching = [:]
    }

    // ── Folders and search ───────────────────────────────────────────────────

    static func key(_ folder: Folder) -> String {
        switch folder {
        case .label(let id, _): "label:\(id)"
        default: folder.title
        }
    }

    /** Whether a folder has more on the server than has been loaded. */
    func hasMore(_ folder: Folder, scope: String?) -> Bool {
        mailboxes(scope).contains { states[$0]?.pages[Self.key(folder)] != "" }
    }

    /** The folder's next page in each mailbox of `scope` (its first, the first time). */
    func loadMore(_ folder: Folder, scope: String?) async {
        let key = Self.key(folder)
        for email in mailboxes(scope) where states[email]?.pages[key] != "" {
            _ = try? await run(email) { provider, state, known in try await provider.loadMore(folder, &state, known: known) }
        }
    }

    /** The servers' search, in each mailbox of `scope`; answers the matching thread ids. */
    func search(_ query: String, scope: String?) async -> [String] {
        var found: [String] = []
        for email in mailboxes(scope) {
            guard let (ids, threads) = try? await provider(email).search(query, known: store.allThreads(of: email)) else { continue }
            store.upsert(threads: threads)
            found += ids
        }
        return found
    }

    private func mailboxes(_ scope: String?) -> [String] {
        store.shownMailboxes.filter { !$0.signedOut && (scope == nil || $0.email == scope) }.map(\.email)
    }

    // ── Writing changes ──────────────────────────────────────────────────────

    /** Writes a change the store already shows; if the server refuses, the thread is reloaded as it has it. */
    func apply(_ change: MailStore.Change, to thread: MailThread) {
        guard store.mailbox(thread.mailbox)?.signedOut == false else { return }
        let email = thread.mailbox
        Task {
            do {
                try await run(email) { provider, state, _ in try await provider.apply(change, to: thread, &state) }
            } catch {
                _ = try? await run(email) { provider, state, known in try await provider.refresh(thread, &state, known: known) }
            }
        }
    }

    /** Sends (or keeps in Drafts) a message the store already shows, then shows the server's copy of its thread. */
    func write(_ draft: Draft, asDraft: Bool) async throws {
        guard let mailbox = store.mailbox(draft.from) else { return }
        let replyTo = draft.threadID.flatMap(store.thread)
        // The message replied to (not the copy the store shows of this one, which has no Message-ID yet).
        let quoted = replyTo?.sent.last { $0.headers["Message-ID"] != nil }
        let to = Draft.people(draft.to), cc = Draft.people(draft.cc)
        let raw = MIME.message(
            from: mailbox.me,
            to: to,
            cc: cc,
            subject: draft.subject,
            text: draft.body,
            html: Compose.html(draft.body, signature: mailbox.signature),
            inReplyTo: quoted?.headers["Message-ID"],
            references: quoted?.headers["References"],
            // Gmail stamps its own; an IMAP server keeps the message as written.
            stamped: mailbox.imap != nil
        )
        let message = Outgoing(raw: raw, from: mailbox.email, recipients: (to + cc).map(\.email), threadID: draft.threadID, draft: draft.messageID)
        try await run(mailbox.email) { provider, state, known in
            asDraft
                ? try await provider.saveDraft(message, &state, known: known)
                : try await provider.send(message, &state, known: known)
        }
    }

    func discard(_ draft: Draft) async {
        guard let messageID = draft.messageID else { return }
        _ = try? await run(draft.from) { provider, state, _ in
            try await provider.deleteDraft(messageID, &state)
            return MailDelta()
        }
    }

    func setSignature(_ html: String, for email: String) async throws {
        let saved = try await provider(email).setSignature(html)
        if var mailbox = store.mailbox(email) {
            mailbox.signature = saved
            store.upsert(mailbox: mailbox)
        }
        scheduleSave()
    }

    /** An inline image's bytes, for the HTML that shows it. */
    func inlineImage(_ attachment: Attachment, of message: Message, in email: String) async -> Data? {
        try? await provider(email).attachment(attachment, of: message)
    }

    func attachment(_ attachment: Attachment, of message: Message, in email: String) async throws -> URL {
        let data = try await provider(email).attachment(attachment, of: message)
        let folder = URL.temporaryDirectory.appending(path: message.id.replacingOccurrences(of: "/", with: "_"), directoryHint: .isDirectory)
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
