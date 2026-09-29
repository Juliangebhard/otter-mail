import Foundation

/** A message being written: a new one, a reply, or a draft picked back up. */
struct Draft: Identifiable, Hashable {
    let id = UUID()
    /** The mailbox it's sent from. */
    var from: String
    var to = ""
    var cc = ""
    var subject = ""
    var body = ""
    /** Set for a reply: the thread it goes into. */
    var threadID: String?
    /** Set once kept in Drafts: the draft message it replaces. */
    var messageID: String?

    var isEmpty: Bool {
        [to, cc, subject, body].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    var canSend: Bool { !Self.people(to).isEmpty }

    /** A new message from `mailbox`, with its signature. */
    static func new(from mailbox: Mailbox, to: String = "") -> Draft {
        Draft(from: mailbox.email, to: to, body: signatureBlock(mailbox))
    }

    /** A reply to the thread's latest message (to everyone on it, for reply all). */
    static func reply(to thread: MailThread, in mailbox: Mailbox, all: Bool) -> Draft {
        let last = thread.sent.last ?? thread.latest
        let mine = last.from.isAddress(mailbox.email)
        var to = mine ? last.to : [last.from]
        var cc: [Person] = []
        if all {
            let others = (last.to + last.cc).filter { $0.email != mailbox.email && !to.contains($0) }
            if mine { to += others } else { cc = others }
        }
        return Draft(
            from: mailbox.email,
            to: to.map(format).joined(separator: ", "),
            cc: cc.map(format).joined(separator: ", "),
            subject: thread.subject.hasPrefix("Re:") ? thread.subject : "Re: \(thread.subject)",
            body: signatureBlock(mailbox) + quote(last),
            threadID: thread.id
        )
    }

    static func forward(_ thread: MailThread, in mailbox: Mailbox) -> Draft {
        let last = thread.sent.last ?? thread.latest
        let header = """
            ---------- Forwarded message ---------
            From: \(format(last.from))
            Date: \(last.date.formatted(date: .abbreviated, time: .shortened))
            Subject: \(thread.subject)
            """
        return Draft(
            from: mailbox.email,
            subject: thread.subject.hasPrefix("Fwd:") ? thread.subject : "Fwd: \(thread.subject)",
            body: signatureBlock(mailbox) + "\n\n\(header)\n\n\(last.text)"
        )
    }

    /** A draft kept in Drafts, to carry on writing. */
    static func resume(_ message: Message, in thread: MailThread) -> Draft {
        Draft(
            from: thread.mailbox,
            to: message.to.map(format).joined(separator: ", "),
            cc: message.cc.map(format).joined(separator: ", "),
            subject: thread.isDraft ? thread.subject : "",
            body: message.text,
            threadID: thread.isDraft ? nil : thread.id,
            messageID: message.id
        )
    }

    static func format(_ person: Person) -> String {
        person.name.isEmpty ? person.email : "\(person.name) <\(person.email)>"
    }

    /** "Ana <ana@x.com>, bo@y.com" → people (entries without an address are dropped). */
    static func people(_ list: String) -> [Person] {
        list.split(separator: ",").compactMap { entry in
            let entry = entry.trimmingCharacters(in: .whitespaces)
            if let open = entry.lastIndex(of: "<"), let close = entry.lastIndex(of: ">"), open < close {
                let email = String(entry[entry.index(after: open)..<close])
                let name = entry[..<open].trimmingCharacters(in: .whitespaces.union(["\""]))
                return email.contains("@") ? Person(name: name, email: email) : nil
            }
            return entry.contains("@") ? Person(name: "", email: entry) : nil
        }
    }

    private static func signatureBlock(_ mailbox: Mailbox) -> String {
        let signature = Signature.plainText(mailbox.signature)
        return signature.isEmpty ? "" : "\n\n\(signature)"
    }

    private static func quote(_ message: Message) -> String {
        let when = message.date.formatted(date: .abbreviated, time: .shortened)
        let quoted = message.text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { "> \($0)" }.joined(separator: "\n")
        return "\n\nOn \(when), \(message.from.label) wrote:\n\(quoted)"
    }
}
