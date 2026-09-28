import BackgroundTasks
import SwiftUI
import UserNotifications

/**
 * Otter Mail for iPhone. The Mac and web apps are one TypeScript app
 * (apps/desktop, apps/web); this is its native sibling, with the same
 * Otter account, mailboxes, themes and settings.
 */
@main
struct OtterMailApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var preferences: Preferences
    @State private var session: Session

    static let refreshTask = "dev.otterware.mail.refresh"

    init() {
        let preferences = Preferences()
        _preferences = State(initialValue: preferences)
        _session = State(initialValue: Session(preferences: preferences))
    }

    var body: some Scene {
        WindowGroup {
            Themed {
                switch session.state {
                case .welcome: WelcomeView()
                case .demo, .signedIn: HomeView()
                }
            }
            .environment(preferences)
            .environment(session)
            .environment(session.store)
            .onAppear { delegate.session = session }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: Task { await session.refreshAccount() }
            case .background:
                session.disconnect()
                Task { await Self.scheduleRefresh() }
            default: break
            }
        }
        .backgroundTask(.appRefresh(Self.refreshTask)) {
            await Self.scheduleRefresh()
            await session.backgroundRefresh()
        }
    }

    /** Checks Gmail every so often while the app is away (iOS picks the moment). */
    private static func scheduleRefresh() async {
        let request = BGAppRefreshTaskRequest(identifier: refreshTask)
        request.earliestBeginDate = .now.addingTimeInterval(15 * 60)
        try? await BGTaskScheduler.shared.submitTaskRequest(request)
    }
}

/** Opens the thread a notification is about. */
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var session: Session?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let thread = response.notification.request.content.userInfo["thread"] as? String
        await MainActor.run { session?.opening = thread }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

/** Paints its content with the theme picked for the current appearance. */
struct Themed<Content: View>: View {
    @Environment(Preferences.self) private var preferences
    @ViewBuilder var content: Content

    var body: some View {
        ThemedContent(content: content)
            .preferredColorScheme(preferences.scheme.colorScheme)
    }

    private struct ThemedContent: View {
        @Environment(Preferences.self) private var preferences
        @Environment(\.colorScheme) private var colorScheme
        let content: Content

        var body: some View {
            let id = colorScheme == .dark ? preferences.darkTheme : preferences.lightTheme
            let palette = (Theme.named(id) ?? Theme.named(Preferences.initialTheme))?.palette(colorScheme)
            content
                .environment(\.palette, palette ?? EnvironmentValues().palette)
                .tint(palette?.action)
                // Switches wear the focus color, as on the desktop (a monochrome action would vanish).
                .toggleStyle(SwitchToggleStyle(tint: palette?.focus ?? .blue))
        }
    }
}

extension Preferences.Scheme {
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
