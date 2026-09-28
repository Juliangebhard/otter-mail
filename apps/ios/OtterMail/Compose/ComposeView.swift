import SwiftUI

/**
 * Writing a message, the desktop's draft page on a sheet: the subject as the
 * headline, the body below, and Send as ChatGPT's round arrow. Closing asks
 * whether to keep it in Drafts.
 */
struct ComposeView: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State var draft: Draft
    @State private var showCc = false
    @State private var confirmClose = false
    @State private var sending = false
    @State private var error: String?
    /** Writing starts above the signature and the quote. */
    @State private var selection: TextSelection? = TextSelection(insertionPoint: "".startIndex)
    @FocusState private var focus: Field?

    private enum Field { case to, cc, subject, body }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    fields
                    TextField("Subject", text: $draft.subject, axis: .vertical)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(palette.text)
                        .focused($focus, equals: .subject)
                        .padding(.top, 20)
                        .padding(.bottom, 10)
                    TextField("Message", text: $draft.body, selection: $selection, axis: .vertical)
                        .font(.body)
                        .foregroundStyle(palette.text)
                        .lineSpacing(3)
                        .focused($focus, equals: .body)
                        .frame(maxWidth: .infinity, minHeight: 300, alignment: .topLeading)
                }
                .padding(.horizontal, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(palette.canvas)
            .navigationTitle(draft.threadID == nil ? "New message" : "Reply")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        if draft.isEmpty && draft.messageID == nil { dismiss() } else { confirmClose = true }
                    }
                    .confirmationDialog("Keep this message?", isPresented: $confirmClose) {
                        Button("Save to Drafts") {
                            let draft = draft
                            dismiss()
                            Task { try? await store.save(draft) }
                        }
                        Button("Delete Draft", role: .destructive) {
                            let draft = draft
                            dismiss()
                            Task { await store.discard(draft) }
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        sending = true
                        Task {
                            do {
                                try await store.send(draft)
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                            sending = false
                        }
                    } label: {
                        Image(systemName: "arrow.up").foregroundStyle(palette.actionText)
                    }
                    .accessibilityLabel("Send")
                    .buttonStyle(.glassProminent)
                    .disabled(!draft.canSend || sending)
                }
            }
            .onAppear {
                selection = TextSelection(insertionPoint: draft.body.startIndex)
                focus = draft.to.isEmpty ? .to : .body
            }
        }
        .interactiveDismissDisabled(!draft.isEmpty)
        .alert("Couldn't send", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
    }

    private var fields: some View {
        VStack(spacing: 0) {
            row("From") {
                let mailboxes = store.shownMailboxes
                if mailboxes.count > 1 {
                    Picker("From", selection: $draft.from) {
                        ForEach(mailboxes) { Text($0.email).tag($0.email) }
                    }
                    .labelsHidden()
                    .tint(palette.text)
                    .padding(.leading, -11)
                } else {
                    Text(draft.from).foregroundStyle(palette.text)
                }
                Spacer()
            }
            row("To") {
                TextField("", text: $draft.to)
                    .focused($focus, equals: .to)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !showCc && draft.cc.isEmpty {
                    Button("Cc") { showCc = true; focus = .cc }
                        .font(.subheadline)
                        .foregroundStyle(palette.muted)
                }
            }
            if showCc || !draft.cc.isEmpty {
                row("Cc") {
                    TextField("", text: $draft.cc)
                        .focused($focus, equals: .cc)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
        }
    }

    private func row(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(label)
                    .foregroundStyle(palette.muted)
                    .frame(width: 44, alignment: .leading)
                content()
            }
            .frame(minHeight: 46)
            Divider().overlay(palette.border)
        }
    }
}
