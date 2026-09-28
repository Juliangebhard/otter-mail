import Foundation
import Observation

/**
 * The user's choices, under the same keys and values as the other apps
 * (apps/web's synced-preferences.ts for `ui`, core's settings-store.ts for
 * `settings`), so they can follow the Otter account to every device.
 */
@Observable
final class Preferences {
    enum Scheme: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    enum Advance: String, CaseIterable, Identifiable {
        case next, previous, none
        var id: String { rawValue }
        var title: String {
            switch self {
            case .next: "Next message"
            case .previous: "Previous message"
            case .none: "Back to the list"
            }
        }
    }

    enum Notifications: String, CaseIterable, Identifiable {
        case off, inbox, all
        var id: String { rawValue }
        var title: String {
            switch self {
            case .off: "Off"
            case .inbox: "Inbox only"
            case .all: "All new mail"
            }
        }
    }

    /** How the mailboxes are arranged (apps/web/src/main/mailboxes.ts). */
    struct Arrangement: Codable, Equatable {
        /** Addresses in the user's order; mailboxes not listed follow, as added. */
        var order: [String] = []
        /** Addresses of turned-off mailboxes. */
        var off: [String] = []
        /** "All mailboxes" (the combined inbox) is offered. */
        var combined = true

        init() {}

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            order = try container.decodeIfPresent([String].self, forKey: .order) ?? []
            off = try container.decodeIfPresent([String].self, forKey: .off) ?? []
            combined = try container.decodeIfPresent(Bool.self, forKey: .combined) ?? true
        }
    }

    static let initialTheme = "codex"

    private let defaults: UserDefaults
    /** Told which section (`ui` or `settings`) the user changed, to sync it with the account. */
    @ObservationIgnored var onChange: (String) -> Void = { _ in }
    @ObservationIgnored private var applying = false

    var scheme: Scheme { didSet { ui("otter:theme-source", scheme.rawValue) } }
    var lightTheme: String { didSet { ui("otter:theme:light", lightTheme) } }
    var darkTheme: String { didSet { ui("otter:theme:dark", darkTheme) } }
    var advance: Advance { didSet { ui("gmail:advance-direction", advance.rawValue) } }
    var arrangement: Arrangement {
        didSet {
            guard arrangement != oldValue else { return }
            ui("mail:mailboxes", Self.json(arrangement))
        }
    }
    var notifications: Notifications { didSet { setting("notificationsMode", notifications.rawValue) } }
    /** BCP-47 codes, first = where translations go; empty = the system's languages. */
    var readLanguages: [String] { didSet { setting("readLanguages", readLanguages) } }
    var autoTranslate: Bool { didSet { setting("autoTranslate", autoTranslate) } }

    private func ui(_ key: String, _ value: String) {
        defaults.set(value, forKey: key)
        if !applying { onChange("ui") }
    }

    private func setting(_ key: String, _ value: Any) {
        defaults.set(value, forKey: "settings.\(key)")
        if !applying { onChange("settings") }
    }

    private static func json(_ arrangement: Arrangement) -> String {
        (try? JSONEncoder().encode(arrangement)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /** The `ui` section's keys this app has, as the other apps store them. */
    var uiSection: [String: String] {
        [
            "otter:theme-source": scheme.rawValue,
            "otter:theme:light": lightTheme,
            "otter:theme:dark": darkTheme,
            "gmail:advance-direction": advance.rawValue,
            "mail:mailboxes": Self.json(arrangement),
        ]
    }

    /** The `settings` section's keys this app has. */
    var settingsSection: [String: Any] {
        ["notificationsMode": notifications.rawValue, "readLanguages": readLanguages, "autoTranslate": autoTranslate]
    }

    /** Takes the account's choices (from another device), without echoing them back. */
    func apply(ui: [String: Any], settings: [String: Any]) {
        applying = true
        defer { applying = false }
        if let value = (ui["otter:theme-source"] as? String).flatMap(Scheme.init), value != scheme { scheme = value }
        if let value = ui["otter:theme:light"] as? String, Theme.named(value) != nil, value != lightTheme { lightTheme = value }
        if let value = ui["otter:theme:dark"] as? String, Theme.named(value) != nil, value != darkTheme { darkTheme = value }
        if let value = (ui["gmail:advance-direction"] as? String).flatMap(Advance.init), value != advance { advance = value }
        if let value = (ui["mail:mailboxes"] as? String)?.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(Arrangement.self, from: value), decoded != arrangement {
            arrangement = decoded
        }
        if let value = (settings["notificationsMode"] as? String).flatMap(Notifications.init), value != notifications {
            notifications = value
        }
        if let value = settings["readLanguages"] as? [String], value != readLanguages { readLanguages = value }
        if let value = settings["autoTranslate"] as? Bool, value != autoTranslate { autoTranslate = value }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        scheme = defaults.string(forKey: "otter:theme-source").flatMap(Scheme.init) ?? .system
        lightTheme = defaults.string(forKey: "otter:theme:light") ?? Self.initialTheme
        darkTheme = defaults.string(forKey: "otter:theme:dark") ?? Self.initialTheme
        advance = defaults.string(forKey: "gmail:advance-direction").flatMap(Advance.init) ?? .next
        arrangement = defaults.string(forKey: "mail:mailboxes")?.data(using: .utf8)
            .flatMap { try? JSONDecoder().decode(Arrangement.self, from: $0) } ?? Arrangement()
        notifications = defaults.string(forKey: "settings.notificationsMode").flatMap(Notifications.init) ?? .inbox
        readLanguages = defaults.stringArray(forKey: "settings.readLanguages") ?? []
        autoTranslate = defaults.bool(forKey: "settings.autoTranslate")
    }

    /** The languages the user reads, falling back to the system's. */
    var effectiveReadLanguages: [String] {
        readLanguages.isEmpty
            ? Locale.preferredLanguages.map { Locale.Language(identifier: $0).minimalIdentifier }
            : readLanguages
    }
}
