import Foundation
import Testing
@testable import Otter_Mail

struct MessageListTests {
    @Test func appearancePreferencesRoundTripWithoutEchoingRemoteChanges() throws {
        let name = "MessageListTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let preferences = Preferences(defaults: defaults)
        #expect(preferences.messageListStyle == .classic)
        #expect(preferences.groupMessagesByDay && preferences.dimReadMessages)
        var changed: [String] = []
        preferences.onChange = { changed.append($0) }
        let remote = [
            "otter:message-list-style": "dividers",
            "otter:group-messages-by-day": "false",
            "otter:dim-read-messages": "false",
        ]
        preferences.apply(ui: remote, settings: [:])
        #expect(changed.isEmpty)
        let restored = Preferences(defaults: defaults)
        #expect(restored.messageListStyle == .dividers)
        #expect(!restored.groupMessagesByDay && !restored.dimReadMessages)
        for (key, value) in remote { #expect(restored.uiSection[key] == value) }
        preferences.dimReadMessages = true
        #expect(changed == ["ui"])
        #expect(preferences.uiSection["otter:dim-read-messages"] == "true")
        preferences.apply(ui: ["otter:message-list-style": "unknown", "otter:dim-read-messages": "invalid"], settings: [:])
        #expect(preferences.messageListStyle == .dividers && preferences.dimReadMessages)
    }

    @Test func groupsByLocalDayAcrossDaylightSavingTime() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let formatter = ISO8601DateFormatter()
        func thread(_ id: String, _ date: String, unread: Bool = false) throws -> MailThread {
            let message = Message(id: id, from: Person(name: "Sender", email: "a@example.com"),
                                  to: [], cc: [], date: try #require(formatter.date(from: date)),
                                  text: "", html: nil, attachments: [], unread: unread,
                                  starred: false, draft: false, headers: [:])
            return MailThread(id: id, mailbox: "me@example.com", subject: id, labels: [], messages: [message])
        }
        let groups = ThreadDay.group(try [
            thread("older", "2026-03-08T04:30:00Z"),
            thread("after", "2026-03-08T07:30:00Z", unread: true),
            thread("before", "2026-03-08T06:30:00Z"),
        ], calendar: calendar)
        #expect(groups.count == 2)
        #expect(groups[0].threads.map(\.id) == ["after", "before"])
        #expect(groups[0].unread == 1)
        #expect(groups[1].threads.map(\.id) == ["older"])
        #expect(ThreadDay.group([], calendar: calendar).isEmpty)
    }
}
