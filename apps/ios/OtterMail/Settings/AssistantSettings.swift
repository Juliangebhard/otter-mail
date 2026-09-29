import SwiftUI

/**
 * Settings › Assistant, as on the desktop: Hermes' connection and model
 * (following the Otter account, key included), and the Mac's local agents,
 * listed but off here.
 */
struct AssistantSettings: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette

    @State private var url = ""
    @State private var key = ""
    @State private var connecting = false

    var body: some View {
        @Bindable var assistant = session.assistant
        SettingsForm {
            Section {
                LabeledContent {
                    Text(statusText).foregroundStyle(statusColor)
                } label: {
                    Label("Hermes", systemImage: "sparkles")
                }
                if assistant.hasKey && !assistant.hermes.baseUrl.isEmpty {
                    LabeledContent("Server") {
                        Text(URL(string: assistant.hermes.baseUrl)?.host() ?? assistant.hermes.baseUrl)
                            .foregroundStyle(palette.muted)
                    }
                    if !assistant.models.isEmpty {
                        Picker("Model", selection: $assistant.hermes.model) {
                            Text("Hermes' default").tag("")
                            ForEach(assistant.models.filter { !$0.slug.isEmpty }) { model in
                                Text(model.subProvider.map { "\(model.name) · \($0)" } ?? model.name).tag(model.slug)
                            }
                        }
                    }
                    if let model = assistant.model, model.reasoning {
                        Picker("Reasoning", selection: $assistant.hermes.reasoningEffort) {
                            ForEach(AssistantView.efforts(model), id: \.0) { Text($0.1).tag($0.0) }
                        }
                    }
                    if let model = assistant.model, model.fast {
                        Toggle("Fast", isOn: Binding(
                            get: { assistant.hermes.serviceTier == "priority" },
                            set: { assistant.hermes.serviceTier = $0 ? "priority" : "default" }
                        ))
                    }
                    Button("Disconnect", role: .destructive) { assistant.disconnect() }
                } else {
                    TextField("https://hermes.example:8642", text: $url)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("API key", text: $key)
                    Button(connecting ? "Connecting…" : "Connect") {
                        connecting = true
                        Task {
                            await assistant.connect(url: url, key: key)
                            connecting = false
                        }
                    }
                    .disabled(url.isEmpty || key.isEmpty || connecting)
                }
            } header: {
                Text("Hermes")
            } footer: {
                Text("Your agent server, reached from every device. Chats live on it, so they're the same here, on the Mac and on the web. The key follows your Otter account, sealed.")
            }

            Section {
                macOnly("Codex", "chevron.left.forwardslash.chevron.right")
                macOnly("Claude", "asterisk")
            } header: {
                Text("On your Mac")
            } footer: {
                Text("Codex and Claude run on your Mac, where their command-line tools are. Use them in the Mac app.")
            }
        }
        .navigationTitle("Assistant")
        .toolbarTitleDisplayMode(.inline)
        .onAppear { url = session.assistant.hermes.baseUrl }
        .task { await session.assistant.check() }
    }

    private func macOnly(_ name: String, _ symbol: String) -> some View {
        LabeledContent {
            Text("Mac app").foregroundStyle(palette.muted)
        } label: {
            Label(name, systemImage: symbol)
        }
    }

    private var statusText: String {
        switch session.assistant.status {
        case .notConfigured: "Not connected"
        case .checking: "Checking…"
        case .ready: "Connected"
        case .failed: "Not answering"
        }
    }

    private var statusColor: Color {
        switch session.assistant.status {
        case .ready: palette.focus
        case .failed: palette.error
        default: palette.muted
        }
    }
}
