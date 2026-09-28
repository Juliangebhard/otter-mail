import Foundation

/**
 * The mail the app shows, shaped like Gmail's: mailboxes (the Gmail accounts
 * on the Otter account), their labels, and threads of messages. Label ids
 * are Gmail's (`INBOX`, `STARRED`, …) or a user label's name.
 */

nonisolated struct Person: Hashable, Codable {
    var name: String
    var email: String

    /** The name, or the address when there's none. */
    var label: String { name.isEmpty ? email : name }
}

nonisolated struct Mailbox: Identifiable, Hashable, Codable {
    /** The Gmail address: the one thing every device agrees on. */
    var email: String
    var name: String
    /** Set in Settings › Mailboxes; shown in the sidebar and on rows. */
    var displayName: String
    var color: String
    /** Gmail's signature for the address, as HTML. */
    var signature: String
    var labels: [MailLabel]
    var picture: String? = nil
    /** Linked to the Otter account on another device, but not signed in to Google on this one. */
    var signedOut = false

    var id: String { email }
    var me: Person { Person(name: name, email: email) }
}

nonisolated struct MailLabel: Identifiable, Hashable, Codable {
    /** Gmail's label id ("Label_12"); the demo uses the name. */
    var id: String
    /** Gmail nests labels by "/" in the name. */
    var name: String
    var color: String?

    var leaf: String { name.split(separator: "/").last.map(String.init) ?? name }
    var depth: Int { name.split(separator: "/").count - 1 }
}

nonisolated struct Attachment: Hashable, Codable {
    /** Gmail's attachment id, to download it; nil in the demo. */
    var id: String? = nil
    var filename: String
    var mimeType: String
    var size: Int
}

nonisolated struct Message: Identifiable, Hashable, Codable {
    var id: String
    var from: Person
    var to: [Person]
    var cc: [Person]
    var date: Date
    var text: String
    var html: String?
    var attachments: [Attachment]
    var unread: Bool
    var starred: Bool
    var draft: Bool
    /** The ones replies and unsubscribing need: Message-ID, References, List-Unsubscribe. */
    var headers: [String: String]

    /** The first line of the text with its whitespace collapsed, as Gmail's snippet. */
    var snippet: String {
        text.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix(">") }
            .joined(separator: " ")
    }
}

nonisolated struct MailThread: Identifiable, Hashable, Codable {
    var id: String
    var mailbox: String
    var subject: String
    var labels: Set<String>
    var messages: [Message]

    var latest: Message { messages.last! }
    var unread: Bool { messages.contains(where: \.unread) }
    var starred: Bool { messages.contains(where: \.starred) }
    var hasAttachments: Bool { messages.contains { !$0.attachments.isEmpty } }
    var isDraft: Bool { messages.allSatisfy(\.draft) }
    var sent: [Message] { messages.filter { !$0.draft } }
}

/** The system folders of the sidebar, then the mailbox's labels (views-store.ts's built-ins). */
nonisolated enum Folder: Hashable {
    case inbox, starred, sent, drafts, important, allMail, junk, trash
    case label(id: String, name: String)

    static let system: [Folder] = [.inbox, .starred, .sent, .drafts, .important, .allMail, .junk, .trash]

    var title: String {
        switch self {
        case .inbox: "Inbox"
        case .starred: "Starred"
        case .sent: "Sent"
        case .drafts: "Drafts"
        case .important: "Important"
        case .allMail: "All Mail"
        case .junk: "Junk"
        case .trash: "Trash"
        case .label(_, let name): name.split(separator: "/").last.map(String.init) ?? name
        }
    }

    var symbol: String {
        switch self {
        case .inbox: "tray"
        case .starred: "star"
        case .sent: "paperplane"
        case .drafts: "doc"
        case .important: "flag"
        case .allMail: "archivebox"
        case .junk: "xmark.bin"
        case .trash: "trash"
        case .label: "tag"
        }
    }
}
