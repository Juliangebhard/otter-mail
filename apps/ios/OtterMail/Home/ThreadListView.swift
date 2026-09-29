import SwiftUI

/**
 * A folder's threads, laid out like Otter Code's task list: who, what, and a
 * line of it. The bottom bar is iOS's own: the assistant, search and
 * compose (the sidebar is a swipe from the left).
 */
struct ThreadListView: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let place: Place
    let onAssistant: () -> Void
    let onCompose: () -> Void
    let onSettings: () -> Void
    let onResume: (Draft) -> Void

    @State private var query = ""
    /** What Gmail's search found for `query` (it knows mail that isn't loaded here). */
    @State private var found: (query: String, ids: [String]) = ("", [])

    var body: some View {
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        let threads = searching ? results : store.threads(in: place.folder, scope: place.scope)

        List {
            ForEach(threads) { thread in
                row(thread, combined: place.scope == nil)
            }

            if !searching, let sync = store.sync, sync.hasMore(place.folder, scope: place.scope) {
                // The folder's next page from Gmail, when the list gets here.
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .task(id: "\(place)-\(threads.count)") { await sync.loadMore(place.folder, scope: place.scope) }
            }

            if threads.isEmpty && !(store.sync?.hasMore(place.folder, scope: place.scope) ?? false) {
                ContentUnavailableView(
                    searching ? "No results" : "Nothing in \(place.folder.title)",
                    systemImage: searching ? "magnifyingglass" : place.folder.symbol,
                    description: Text(searching ? "Try other words, or from: and is:unread." : "")
                )
                .foregroundStyle(palette.muted)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .padding(.top, 80)
            }
        }
        .listStyle(.plain)
        .listSectionSeparator(.hidden, edges: .top)
        .scrollContentBackground(.hidden)
        .background(palette.canvas)
        .contentMargins(.bottom, 24, for: .scrollContent)
        .searchable(text: $query, prompt: "Search")
        .task(id: query) {
            guard let sync = store.sync, !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            let ids = await sync.search(query, scope: place.scope)
            found = (query, ids)
        }
        .refreshable {
            await store.sync?.syncAll()
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Header(title: searching ? "Search" : place.folder.title, scope: scopeName)
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .topBarTrailing) {
                Menu("More", systemImage: "ellipsis") {
                    Button("Mark all as read", systemImage: "envelope.open") {
                        for thread in threads where thread.unread { store.setRead(true, thread.id) }
                    }
                    .disabled(!threads.contains(where: \.unread))
                    Button("Settings", systemImage: "gearshape", action: onSettings)
                }
            }
            ToolbarItem(placement: .bottomBar) {
                Button("Assistant", systemImage: "sparkles", action: onAssistant)
            }
            ToolbarSpacer(.fixed, placement: .bottomBar)
            DefaultToolbarItem(kind: .search, placement: .bottomBar)
            ToolbarSpacer(.fixed, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button("New message", systemImage: "square.and.pencil", action: onCompose)
            }
        }
        .toolbarTitleDisplayMode(.inline)
    }

    /** Here first, then what Gmail found. */
    private var results: [MailThread] {
        let local = store.search(query, scope: place.scope)
        guard found.query == query else { return local }
        let known = Set(local.map(\.id))
        let remote = found.ids.filter { !known.contains($0) }.compactMap(store.thread)
        return (local + remote).sorted { $0.latest.date > $1.latest.date }
    }

    private var scopeName: String {
        place.scope.flatMap(store.mailbox)?.displayName ?? "All mailboxes"
    }

    private func row(_ thread: MailThread, combined: Bool) -> some View {
        Group {
            let content = ThreadRow(thread: thread, mailbox: combined ? store.mailbox(thread.mailbox) : nil)
            if thread.isDraft, let message = thread.messages.last {
                Button { onResume(.resume(message, in: thread)) } label: { content }
                    .buttonStyle(.plain)
            } else {
                NavigationLink(value: thread.id) { content }
                    .navigationLinkIndicatorVisibility(.hidden)
            }
        }
        .listRowBackground(
            // The theme's divider (the system's separators don't take its color in light mode).
            palette.canvas.overlay(alignment: .bottom) {
                palette.border.frame(height: 1).padding(.horizontal, 20)
            }
        )
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20))
        .swipeActions(edge: .leading) {
            Button(thread.unread ? "Read" : "Unread", systemImage: thread.unread ? "envelope.open" : "envelope.badge") {
                store.setRead(thread.unread, thread.id)
            }
            .tint(palette.focus)
        }
        .swipeActions(edge: .trailing) {
            if place.folder == .trash || place.folder == .junk {
                Button("Delete", systemImage: "trash", role: .destructive) { store.deleteForever(thread.id) }
                Button("Inbox", systemImage: "tray.and.arrow.down") { store.moveToInbox(thread.id) }
            } else {
                Button("Trash", systemImage: "trash", role: .destructive) { store.trash(thread.id) }
                if thread.labels.contains("INBOX") {
                    Button("Archive", systemImage: "archivebox") { store.archive(thread.id) }
                        .tint(.indigo)
                }
            }
        }
        .contextMenu {
            ThreadActions(thread: thread)
        }
    }

    /** "Inbox Personal": the folder, then where it is, quieter (Otter Code's wordmark). */
    private struct Header: View {
        @Environment(\.palette) private var palette
        let title: String
        let scope: String

        var body: some View {
            Text("\(Text(title).foregroundStyle(palette.text)) \(Text(scope).foregroundStyle(palette.muted))")
                .font(.system(size: 28, weight: .regular))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .fixedSize()
        }
    }
}

/** A thread's actions, for its context menu and the reader's menu. */
struct ThreadActions: View {
    @Environment(MailStore.self) private var store
    let thread: MailThread
    var onGone: () -> Void = {}

    var body: some View {
        Button(thread.unread ? "Mark as read" : "Mark as unread",
               systemImage: thread.unread ? "envelope.open" : "envelope.badge") {
            store.setRead(thread.unread, thread.id)
        }
        Button(thread.starred ? "Unstar" : "Star", systemImage: thread.starred ? "star.slash" : "star") {
            store.toggleStar(thread.id)
        }
        if let mailbox = store.mailbox(thread.mailbox), !mailbox.labels.isEmpty {
            Menu("Labels", systemImage: "tag") {
                ForEach(mailbox.labels) { label in
                    Toggle(label.name, isOn: Binding(
                        get: { thread.labels.contains(label.id) },
                        set: { _ in store.toggleLabel(label.id, thread.id) }
                    ))
                }
            }
            // A switch (the app's toggle style) can't sit in a menu; checkmarks can.
            .toggleStyle(.automatic)
        }
        Divider()
        if thread.labels.contains("INBOX") {
            Button("Archive", systemImage: "archivebox") { store.archive(thread.id); onGone() }
        }
        if thread.labels.contains("SPAM") || thread.labels.contains("TRASH") || !thread.labels.contains("INBOX") {
            Button("Move to Inbox", systemImage: "tray.and.arrow.down") { store.moveToInbox(thread.id); onGone() }
        }
        if !thread.labels.contains("SPAM") {
            Button("Report junk", systemImage: "xmark.bin") { store.markSpam(thread.id); onGone() }
        }
        if thread.labels.contains("TRASH") {
            Button("Delete forever", systemImage: "trash", role: .destructive) { store.deleteForever(thread.id); onGone() }
        } else {
            Button("Trash", systemImage: "trash", role: .destructive) { store.trash(thread.id); onGone() }
        }
    }
}
