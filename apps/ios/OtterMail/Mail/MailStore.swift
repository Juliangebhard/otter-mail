import Foundation
import Observation
import SwiftUI

/**
 * Everything the app shows and does with mail. Local-first, as on the Mac:
 * screens render from here and never wait on the network. Changes show at
 * once and are handed to `sync`, which writes them to Gmail; in the demo
 * there's no sync and the pretend mail just changes.
 */
@Observable
final class MailStore {
    private(set) var mailboxes: [Mailbox]
    private(set) var threads: [MailThread]
    let preferences: Preferences
    /** Gmail, for signed-in mailboxes; nil in the demo. */
    @ObservationIgnored var sync: MailSync?

    init(preferences: Preferences, mailboxes: [Mailbox] = [], threads: [MailThread] = []) {
        self.preferences = preferences
        self.mailboxes = mailboxes
        self.threads = threads
    }

    static func demo(preferences: Preferences) -> MailStore {
        let demo = DemoMail.load()
        return MailStore(preferences: preferences, mailboxes: demo.mailboxes, threads: demo.threads)
    }

    var isDemo: Bool { sync == nil }

    // ── Mailboxes ────────────────────────────────────────────────────────────

    /** Every mailbox in the user's order, turned-off ones included. */
    var arrangedMailboxes: [Mailbox] {
        let order = preferences.arrangement.order
        let rank = { (m: Mailbox) in order.firstIndex(of: m.email) ?? order.count }
        return mailboxes.enumerated()
            .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
            .map(\.element)
    }

    /** The mailboxes the app shows: turned on, in order. */
    var shownMailboxes: [Mailbox] {
        arrangedMailboxes.filter { !preferences.arrangement.off.contains($0.email) }
    }

    /** "All mailboxes" is offered (it needs two or more). */
    var offersCombined: Bool { preferences.arrangement.combined && shownMailboxes.count > 1 }

    func mailbox(_ email: String) -> Mailbox? { mailboxes.first { $0.email == email } }

    func upsert(mailbox: Mailbox) {
        if let i = mailboxes.firstIndex(where: { $0.email == mailbox.email }) {
            if mailboxes[i] != mailbox { mailboxes[i] = mailbox }
        } else {
            mailboxes.append(mailbox)
        }
    }

    /** Removes the mailbox and its mail from this device; nothing is deleted from Gmail. */
    func remove(mailbox email: String) {
        mailboxes.removeAll { $0.email == email }
        threads.removeAll { $0.mailbox == email }
        preferences.arrangement.order.removeAll { $0 == email }
        preferences.arrangement.off.removeAll { $0 == email }
    }

    func setSignedOut(_ signedOut: Bool, _ email: String) {
        guard var mailbox = mailbox(email), mailbox.signedOut != signedOut else { return }
        mailbox.signedOut = signedOut
        upsert(mailbox: mailbox)
    }

    func setOn(_ on: Bool, _ mailbox: Mailbox) {
        var off = Set(preferences.arrangement.off)
        if on { off.remove(mailbox.email) } else { off.insert(mailbox.email) }
        preferences.arrangement.off = arrangedMailboxes.map(\.email).filter(off.contains)
    }

    func move(from source: IndexSet, to destination: Int) {
        var order = arrangedMailboxes.map(\.email)
        order.move(fromOffsets: source, toOffset: destination)
        preferences.arrangement.order = order
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    /** A folder's threads in `scope` (a mailbox's address, or nil for all shown), newest first. */
    func threads(in folder: Folder, scope: String?) -> [MailThread] {
        inScope(scope).filter { matches($0, folder) }.sorted { $0.latest.date > $1.latest.date }
    }

    func unreadCount(in folder: Folder, scope: String?) -> Int {
        inScope(scope).filter { $0.unread && matches($0, folder) }.count
    }

    func thread(_ id: String) -> MailThread? { threads.first { $0.id == id } }

    func allThreads(of email: String) -> [MailThread] { threads.filter { $0.mailbox == email } }

    private func inScope(_ scope: String?) -> [MailThread] {
        let shown = Set(shownMailboxes.map(\.email))
        return threads.filter { thread in scope.map { thread.mailbox == $0 } ?? shown.contains(thread.mailbox) }
    }

    private func matches(_ thread: MailThread, _ folder: Folder) -> Bool {
        let away = thread.labels.contains("SPAM") || thread.labels.contains("TRASH")
        switch folder {
        case .inbox: return thread.labels.contains("INBOX") && !away
        case .starred: return thread.starred && !away
        case .sent: return thread.sent.contains { $0.from.email.lowercased() == thread.mailbox.lowercased() } && !away
        case .drafts: return thread.messages.contains(where: \.draft) && !away
        case .important: return thread.labels.contains("IMPORTANT") && !away
        case .allMail: return !away && !thread.isDraft
        case .junk: return thread.labels.contains("SPAM")
        case .trash: return thread.labels.contains("TRASH")
        case .label(let id, _): return thread.labels.contains(id) && !away
        }
    }

    /**
     * Gmail-style search over what's here: `from:`, `to:`, `subject:`,
     * `label:`, `is:unread`, `is:starred`, `has:attachment`, and words
     * anywhere. Junk and Trash are left out, as in Gmail.
     */
    func search(_ query: String, scope: String?) -> [MailThread] {
        let terms = query.lowercased().split(separator: " ").map(String.init)
        guard !terms.isEmpty else { return [] }
        let labels = Dictionary(mailboxes.flatMap(\.labels).map { ($0.id, $0.name.lowercased()) }) { a, _ in a }
        return inScope(scope)
            .filter { !$0.labels.contains("SPAM") && !$0.labels.contains("TRASH") }
            .filter { thread in terms.allSatisfy { Self.term($0, matches: thread, labels: labels) } }
            .sorted { $0.latest.date > $1.latest.date }
    }

    private static func term(_ term: String, matches thread: MailThread, labels: [String: String]) -> Bool {
        let people = { (list: [Person]) in list.map { "\($0.name) \($0.email)".lowercased() } }
        let (op, value) = term.contains(":")
            ? (String(term.prefix { $0 != ":" }), String(term.drop { $0 != ":" }.dropFirst()))
            : ("", term)
        switch op {
        case "from": return people(thread.messages.map(\.from)).contains { $0.contains(value) }
        case "to": return people(thread.messages.flatMap { $0.to + $0.cc }).contains { $0.contains(value) }
        case "subject": return thread.subject.lowercased().contains(value)
        case "label": return thread.labels.contains { $0.lowercased() == value || labels[$0] == value }
        case "is" where value == "unread": return thread.unread
        case "is" where value == "starred": return thread.starred
        case "has" where value == "attachment": return thread.hasAttachments
        default:
            let haystack = ([thread.subject] + thread.messages.flatMap { [$0.from.name, $0.from.email, $0.text] })
                .joined(separator: " ").lowercased()
            return haystack.contains(term)
        }
    }

    // ── What sync brings ─────────────────────────────────────────────────────

    func upsert(threads fresh: [MailThread]) {
        guard !fresh.isEmpty else { return }
        var index = Dictionary(uniqueKeysWithValues: threads.enumerated().map { ($1.id, $0) })
        for thread in fresh {
            if let i = index[thread.id] {
                if threads[i] != thread { threads[i] = thread }
            } else {
                index[thread.id] = threads.count
                threads.append(thread)
            }
        }
    }

    func remove(threadIDs: Set<String>) {
        guard !threadIDs.isEmpty else { return }
        threads.removeAll { threadIDs.contains($0.id) }
    }

    /** Drops a message shown before Gmail had it, and its thread if nothing else is left in it. */
    func remove(messageID: String) {
        for i in threads.indices { threads[i].messages.removeAll { $0.id == messageID } }
        threads.removeAll { $0.messages.isEmpty }
    }

    // ── Changing ─────────────────────────────────────────────────────────────

    /** A change to a thread, as Gmail takes it. */
    enum Change {
        case modify(add: [String], remove: [String])
        /** Gmail stars a message, not a thread: the latest. */
        case star(message: String)
        case trash, untrash, delete
    }

    private func edit(_ id: String, _ changes: [Change], _ change: (inout MailThread) -> Void) {
        guard let i = threads.firstIndex(where: { $0.id == id }) else { return }
        change(&threads[i])
        let thread = threads[i]
        for c in changes { sync?.apply(c, to: thread) }
    }

    func setRead(_ read: Bool, _ id: String) {
        let change = Change.modify(add: read ? [] : ["UNREAD"], remove: read ? ["UNREAD"] : [])
        edit(id, [change]) { t in for i in t.messages.indices { t.messages[i].unread = !read } }
    }

    func toggleStar(_ id: String) {
        guard let thread = thread(id) else { return }
        let starred = !thread.starred
        let latest = thread.sent.last ?? thread.latest
        edit(id, [starred ? .star(message: latest.id) : .modify(add: [], remove: ["STARRED"])]) { t in
            for i in t.messages.indices { t.messages[i].starred = starred && t.messages[i].id == latest.id }
        }
    }

    func archive(_ id: String) {
        edit(id, [.modify(add: [], remove: ["INBOX"])]) { $0.labels.remove("INBOX") }
    }

    func trash(_ id: String) {
        edit(id, [.trash]) { t in
            t.labels.subtract(["INBOX", "SPAM"])
            t.labels.insert("TRASH")
        }
    }

    func markSpam(_ id: String) {
        edit(id, [.modify(add: ["SPAM"], remove: ["INBOX"])]) { t in
            t.labels.subtract(["INBOX", "TRASH"])
            t.labels.insert("SPAM")
        }
    }

    /** Back to the inbox, out of Junk or Trash. */
    func moveToInbox(_ id: String) {
        guard let thread = thread(id) else { return }
        let changes: [Change] = thread.labels.contains("TRASH")
            ? [.untrash, .modify(add: ["INBOX"], remove: [])]
            : [.modify(add: ["INBOX"], remove: ["SPAM"])]
        edit(id, changes) { t in
            t.labels.subtract(["SPAM", "TRASH"])
            t.labels.insert("INBOX")
        }
    }

    func deleteForever(_ id: String) {
        guard let thread = thread(id) else { return }
        threads.removeAll { $0.id == id }
        sync?.apply(.delete, to: thread)
    }

    func toggleLabel(_ label: String, _ id: String) {
        guard let thread = thread(id) else { return }
        let on = !thread.labels.contains(label)
        edit(id, [.modify(add: on ? [label] : [], remove: on ? [] : [label])]) { t in
            if on { t.labels.insert(label) } else { t.labels.remove(label) }
        }
    }

    // ── Writing ──────────────────────────────────────────────────────────────

    /** Sends `draft`: into its thread when it's a reply, or as a new one. */
    func send(_ draft: Draft) async throws {
        try await write(draft, asDraft: false)
    }

    /** Keeps `draft` in Drafts (only when there's something in it). */
    func save(_ draft: Draft) async throws {
        guard !draft.isEmpty else { return await discard(draft) }
        try await write(draft, asDraft: true)
    }

    func discard(_ draft: Draft) async {
        guard let messageID = draft.messageID else { return }
        remove(messageID: messageID)
        await sync?.discard(draft)
    }

    /** Shows the message at once, then hands it to Gmail (which answers with its own copy). */
    private func write(_ draft: Draft, asDraft: Bool) async throws {
        guard let mailbox = mailbox(draft.from) else { return }
        let localID = UUID().uuidString
        let message = Message(
            id: localID,
            from: mailbox.me,
            to: Draft.people(draft.to),
            cc: Draft.people(draft.cc),
            date: .now,
            text: draft.body,
            html: nil,
            attachments: [],
            unread: false,
            starred: false,
            draft: asDraft,
            headers: [:]
        )
        // A draft picked back up is replaced by what it becomes.
        let threadID = draft.threadID ?? draft.messageID.flatMap { id in threads.first { $0.messages.contains { $0.id == id } }?.id }
        if let previous = draft.messageID {
            for i in threads.indices { threads[i].messages.removeAll { $0.id == previous } }
        }
        if let threadID, let i = threads.firstIndex(where: { $0.id == threadID }) {
            threads[i].messages.append(message)
            if !asDraft { threads[i].labels.insert("SENT") }
        } else {
            threads.append(MailThread(
                id: UUID().uuidString,
                mailbox: mailbox.email,
                subject: draft.subject.isEmpty ? "(no subject)" : draft.subject,
                labels: asDraft ? [] : ["SENT"],
                messages: [message]
            ))
        }
        threads.removeAll { $0.messages.isEmpty }
        guard let sync else { return }
        do {
            try await sync.write(draft, asDraft: asDraft)
        } catch {
            remove(messageID: localID)
            throw error
        }
        remove(messageID: localID)
    }
}
