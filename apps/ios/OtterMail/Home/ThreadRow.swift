import SwiftUI

/**
 * One thread, three lines, as Otter Code lists tasks: who (with the mailbox's
 * mark in all mailboxes) and when, the subject, then a line of the latest
 * message with what's attached and how many there are.
 */
struct ThreadRow: View {
    @Environment(\.palette) private var palette
    let thread: MailThread
    /** Set in all mailboxes: whose mail it is. */
    let mailbox: Mailbox?

    var body: some View {
        let latest = thread.latest
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                SenderAvatar(person: latest.from, size: 22)
                Text(senders)
                    .font(.subheadline)
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                if let mailbox {
                    MailboxMark(mailbox: mailbox)
                }
                Spacer(minLength: 8)
                if thread.starred {
                    Image(systemName: "star.fill")
                        .font(.caption)
                        .foregroundStyle(palette.warning)
                }
                Text(RelativeTime.short(latest.date))
                    .font(.subheadline)
                    .foregroundStyle(thread.unread ? palette.focus : palette.muted)
                    .monospacedDigit()
            }

            Text(thread.subject)
                .font(.body.weight(thread.unread ? .semibold : .regular))
                .foregroundStyle(palette.text)
                .lineLimit(1)

            HStack(spacing: 8) {
                Text(thread.isDraft ? "Draft · \(latest.snippet)" : latest.snippet)
                    .font(.subheadline)
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if thread.hasAttachments {
                    Image(systemName: "paperclip")
                        .font(.caption)
                        .foregroundStyle(palette.muted)
                }
                if thread.messages.count > 1 {
                    Text("\(thread.messages.count)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(palette.muted)
                        .monospacedDigit()
                }
                if thread.unread {
                    Circle().fill(palette.focus).frame(width: 8, height: 8)
                }
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    /** "Maya, José, me": who wrote, in order. */
    private var senders: String {
        var names: [String] = []
        for message in thread.messages where !message.draft {
            let name = message.from.isAddress(thread.mailbox)
                ? "me"
                : message.from.label.split(separator: " ").first.map(String.init) ?? message.from.label
            if !names.contains(name) { names.append(name) }
        }
        if names.count == 1, names[0] != "me", let only = thread.messages.first(where: { !$0.draft }) {
            return only.from.label
        }
        return names.isEmpty ? "Draft" : names.joined(separator: ", ")
    }
}

/** A mailbox's mark: a rounded square in its color with its initial (Otter Code's project mark). */
struct MailboxMark: View {
    let mailbox: Mailbox
    var size: CGFloat = 16

    var body: some View {
        Text(mailbox.displayName.prefix(1).uppercased())
            .font(.system(size: size * 0.6, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color(hex: mailbox.color), in: .rect(cornerRadius: size * 0.28))
            .accessibilityLabel(mailbox.displayName)
    }
}

/** Initials on a color picked from the address, so each person keeps theirs. */
struct SenderAvatar: View {
    let person: Person
    var size: CGFloat = 36

    private static let colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899"]

    var body: some View {
        let hash = person.email.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xffff }
        Text(initials)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color(hex: Self.colors[hash % Self.colors.count]).gradient, in: .circle)
            .accessibilityHidden(true)
    }

    private var initials: String {
        let words = person.label.split(separator: " ").filter { $0.first?.isLetter ?? false }
        let letters = words.count > 1 ? [words.first!, words.last!].compactMap(\.first) : Array(person.label.prefix(1))
        return String(letters).uppercased()
    }
}

enum RelativeTime {
    /** "14:05" today, "Tue" this week, "12 Sep" this year, else "12/09/25". */
    static func short(_ date: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        if let days = calendar.dateComponents([.day], from: date, to: now).day, days < 6 {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            return date.formatted(.dateTime.day().month(.abbreviated))
        }
        return date.formatted(date: .numeric, time: .omitted)
    }
}
