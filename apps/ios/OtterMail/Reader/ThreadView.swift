import SwiftUI

/**
 * A conversation: its subject as the headline, then each message, earlier
 * read ones folded to a line. Reply sits at the bottom like ChatGPT's
 * composer; archiving moves on as Settings › After archive says.
 */
struct ThreadView: View {
    @Environment(MailStore.self) private var store
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette

    let threadID: String
    let place: Place
    @Binding var path: [String]
    @Binding var draft: Draft?

    /** The list as it was when this opened, to know what's next once this one leaves it. */
    @State private var siblings: [String] = []
    @State private var expanded: Set<String> = []

    var body: some View {
        if let thread = store.thread(threadID), let mailbox = store.mailbox(thread.mailbox) {
            content(thread, mailbox)
        } else {
            ContentUnavailableView("Deleted", systemImage: "trash")
        }
    }

    private func content(_ thread: MailThread, _ mailbox: Mailbox) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(thread.subject)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(palette.text)
                    .textSelection(.enabled)
                    .padding(.bottom, 10)

                labels(thread, mailbox)
                    .padding(.bottom, 18)

                ForEach(thread.messages) { message in
                    let open = message.id == thread.messages.last?.id || message.unread || expanded.contains(message.id)
                    MessageView(message: message, mailbox: mailbox, open: open) {
                        if message.draft {
                            draft = .resume(message, in: thread)
                        } else if !open {
                            withAnimation(.snappy) { _ = expanded.insert(message.id) }
                        }
                    }
                    if message.id != thread.messages.last?.id {
                        Divider().overlay(palette.border).padding(.vertical, 14)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .scrollContentBackground(.hidden)
        .background(palette.canvas)
        .contentMargins(.bottom, 24, for: .scrollContent)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(thread.starred ? "Unstar" : "Star", systemImage: thread.starred ? "star.fill" : "star") {
                    store.toggleStar(thread.id)
                }
                .tint(thread.starred ? palette.warning : nil)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("More", systemImage: "ellipsis") {
                    Button("Reply all", systemImage: "arrowshape.turn.up.left.2") {
                        draft = .reply(to: thread, in: mailbox, all: true)
                    }
                    Button("Forward", systemImage: "arrowshape.turn.up.right") {
                        draft = .forward(thread, in: mailbox)
                    }
                    if let unsubscribe = Unsubscribe(thread.sent.last?.headers ?? [:]) {
                        Button("Unsubscribe", systemImage: "hand.raised") {
                            Task { await unsubscribe.run(from: mailbox, compose: { draft = $0 }) }
                        }
                    }
                    Divider()
                    ThreadActions(thread: thread, onGone: { leave(thread) })
                }
            }
        }
        .safeAreaBar(edge: .bottom) {
            replyBar(thread, mailbox)
        }
        .toolbarTitleDisplayMode(.inline)
        .onAppear {
            if siblings.isEmpty { siblings = store.threads(in: place.folder, scope: place.scope).map(\.id) }
            if thread.unread { store.setRead(true, thread.id) }
        }
    }

    @ViewBuilder
    private func labels(_ thread: MailThread, _ mailbox: Mailbox) -> some View {
        let userLabels = mailbox.labels.filter { thread.labels.contains($0.id) }
        HStack(spacing: 6) {
            MailboxMark(mailbox: mailbox, size: 18)
            Text(mailbox.displayName)
                .font(.subheadline)
                .foregroundStyle(palette.muted)
            ForEach(userLabels) { label in
                Text(label.leaf)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(palette.text)
                    .padding(.horizontal, 8)
                    .frame(height: 22)
                    .background((label.color.map(Color.init(hex:)) ?? palette.muted).opacity(0.22), in: .capsule)
            }
        }
    }

    /** Archive (or Trash), and Reply as ChatGPT's composer: a glass field at the bottom. */
    private func replyBar(_ thread: MailThread, _ mailbox: Mailbox) -> some View {
        let inInbox = thread.labels.contains("INBOX")
        return HStack(spacing: 10) {
            Button(inInbox ? "Archive" : "Trash", systemImage: inInbox ? "archivebox" : "trash") {
                if inInbox { store.archive(thread.id) } else { store.trash(thread.id) }
                leave(thread)
            }
            .labelStyle(.iconOnly)
            .font(.system(size: 19))
            .foregroundStyle(palette.text)
            .frame(width: 52, height: 52)
            .glassEffect(.regular.interactive(), in: .circle)

            Button {
                draft = .reply(to: thread, in: mailbox, all: false)
            } label: {
                HStack {
                    Text("Reply to \(replyName(thread, mailbox))")
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                    Spacer()
                    Image(systemName: "arrowshape.turn.up.left")
                        .foregroundStyle(palette.text)
                }
                .padding(.horizontal, 20)
                .frame(height: 52)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private func replyName(_ thread: MailThread, _ mailbox: Mailbox) -> String {
        let last = thread.sent.last ?? thread.latest
        let person = last.from.email == mailbox.email ? last.to.first ?? last.from : last.from
        return person.label.split(separator: " ").first.map(String.init) ?? person.label
    }

    /** After archive, trash or a move: the next or previous thread, or back to the list. */
    private func leave(_ thread: MailThread) {
        let remaining = Set(store.threads(in: place.folder, scope: place.scope).map(\.id))
        let index = siblings.firstIndex(of: thread.id) ?? 0
        let after = siblings[(index + 1)...].first(where: remaining.contains)
        let before = siblings[..<index].last(where: remaining.contains)
        let next: String? = switch preferences.advance {
        case .next: after ?? before
        case .previous: before ?? after
        case .none: nil
        }
        if let next {
            path = [next]
        } else {
            path = []
        }
    }
}
