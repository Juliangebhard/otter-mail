import SwiftUI

/** Where the user is: a mailbox (or all of them) and a folder in it. */
struct Place: Hashable {
    /** A mailbox's address; nil = all mailboxes. */
    var scope: String?
    var folder: Folder = .inbox
}

/**
 * The app's frame, ChatGPT's: the mail list, with the sidebar drawer under
 * it. A swipe in from the left edge slides the list aside.
 */
struct HomeView: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.colorScheme) private var colorScheme

    @State private var place = Place()
    @State private var path: [String] = []
    @State private var drawerOpen = false
    @State private var drag: CGFloat = 0
    @State private var draft: Draft?
    @State private var settingsOpen = false
    @State private var assistantOpen = false

    var body: some View {
        GeometryReader { geometry in
            let width = min(geometry.size.width - 64, 340)
            let offset = min(max((drawerOpen ? width : 0) + drag, 0), width)

            ZStack(alignment: .leading) {
                SidebarView(
                    place: $place,
                    onSelect: { select($0) },
                    onCompose: { compose() },
                    onSettings: { settingsOpen = true }
                )
                .frame(width: width)
                .opacity(offset / width)

                NavigationStack(path: $path) {
                    ThreadListView(
                        place: place,
                        onAssistant: { assistantOpen = true },
                        onCompose: { compose() },
                        onSettings: { settingsOpen = true },
                        onResume: { draft = $0 }
                    )
                    .navigationDestination(for: String.self) { id in
                        ThreadView(threadID: id, place: place, path: $path, draft: $draft)
                    }
                }
                .clipShape(.rect(cornerRadius: offset > 0 ? 44 : 0))
                .overlay {
                    // Open, the list dims; a tap or a drag closes the drawer.
                    if drawerOpen {
                        Color.black.opacity((colorScheme == .dark ? 0.3 : 0.08) * offset / width)
                            .clipShape(.rect(cornerRadius: 44))
                            .onTapGesture { setDrawer(open: false) }
                            .gesture(drawerGesture(width: width))
                    }
                }
                .offset(x: offset)
                .ignoresSafeArea()

                // Closed, only a swipe in from the left edge opens it, so swipes on the
                // rows stay theirs (read, archive, trash). Not in a conversation, where
                // that swipe goes back.
                if !drawerOpen && path.isEmpty {
                    Color.clear
                        .frame(width: 20)
                        .frame(maxHeight: .infinity)
                        .contentShape(.rect)
                        .gesture(drawerGesture(width: width))
                        .ignoresSafeArea()
                }
            }
            .background(palette.sidebar)
        }
        .onChange(of: store.shownMailboxes.map(\.email)) { _, shown in
            // The mailbox shown was turned off or removed: fall back to what's left.
            if let scope = place.scope, !shown.contains(scope) {
                place = Place(scope: store.offersCombined ? nil : shown.first)
            } else if place.scope == nil, !store.offersCombined {
                place.scope = shown.first
            }
        }
        .onAppear {
            if !store.offersCombined { place.scope = store.shownMailboxes.first?.email }
        }
        .onChange(of: session.opening, initial: true) { _, thread in
            // A notification was tapped: open its thread.
            guard let thread, store.thread(thread) != nil else { return }
            session.opening = nil
            setDrawer(open: false)
            path = [thread]
        }
        .sheet(item: $draft) { draft in
            ComposeView(draft: draft)
        }
        .sheet(isPresented: $assistantOpen) {
            NavigationStack {
                AssistantView(sheet: true, onSettings: {
                    assistantOpen = false
                    settingsOpen = true
                })
            }
        }
        .sheet(isPresented: $settingsOpen) {
            SettingsView()
        }
    }

    private func select(_ next: Place) {
        place = next
        path = []
        setDrawer(open: false)
    }

    private func compose(to: String = "") {
        let mailbox = place.scope.flatMap(store.mailbox) ?? store.shownMailboxes.first
        guard let mailbox else { return }
        setDrawer(open: false)
        draft = .new(from: mailbox, to: to)
    }

    private func setDrawer(open: Bool) {
        withAnimation(.smooth(duration: 0.32)) {
            drawerOpen = open
            drag = 0
        }
    }

    /** Horizontal drags slide the drawer, following the finger and settling by where and how fast it let go. */
    private func drawerGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in drag = value.translation.width }
            .onEnded { value in settle(width: width, predicted: value.predictedEndTranslation.width) }
    }

    /** Where the drawer settles once the finger lifts: by where it was headed. */
    private func settle(width: CGFloat, predicted: CGFloat) {
        let open = drag == 0 ? drawerOpen : (drawerOpen ? width : 0) + predicted > width / 2
        withAnimation(.interpolatingSpring(duration: 0.35, bounce: 0, initialVelocity: 0)) {
            drawerOpen = open
            drag = 0
        }
    }
}
