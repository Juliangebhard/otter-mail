import SwiftUI

/**
 * Settings › Agents, as on the desktop: Hermes on or off (off, the agent's
 * buttons go), and its connection and model (following the Otter account, key
 * included). The Mac's local agents don't run here, so they aren't shown.
 */
struct AgentSettings: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette

    @State private var url = ""
    @State private var key = ""
    @State private var connecting = false

    var body: some View {
        @Bindable var agent = session.agent
        SettingsForm {
            Section {
                Toggle(isOn: $agent.hermes.enabled) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Hermes")
                            Text(statusText).font(.subheadline).foregroundStyle(statusColor)
                        }
                    } icon: {
                        Image("AgentCursor")
                    }
                }
                if agent.isOn && agent.hasKey && !agent.hermes.baseUrl.isEmpty {
                    LabeledContent("Server") {
                        Text(URL(string: agent.hermes.baseUrl)?.host() ?? agent.hermes.baseUrl)
                            .foregroundStyle(palette.muted)
                    }
                    if !agent.models.isEmpty {
                        Picker("Model", selection: $agent.hermes.model) {
                            Text("Hermes' default").tag("")
                            ForEach(agent.models.filter { !$0.slug.isEmpty }) { model in
                                Text(model.subProvider.map { "\(model.name) · \($0)" } ?? model.name).tag(model.slug)
                            }
                        }
                    }
                    if let model = agent.model, model.reasoning {
                        Picker("Reasoning", selection: $agent.hermes.reasoningEffort) {
                            ForEach(AgentView.efforts(model), id: \.0) { Text($0.1).tag($0.0) }
                        }
                    }
                    if let model = agent.model, model.fast {
                        Toggle("Fast", isOn: Binding(
                            get: { agent.hermes.serviceTier == "priority" },
                            set: { agent.hermes.serviceTier = $0 ? "priority" : "default" }
                        ))
                    }
                    Button("Disconnect", role: .destructive) { agent.disconnect() }
                } else if agent.isOn {
                    TextField("https://hermes.example:8642", text: $url)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("API key", text: $key)
                    Button(connecting ? "Connecting…" : "Connect") {
                        connecting = true
                        Task {
                            await agent.connect(url: url, key: key)
                            connecting = false
                        }
                    }
                    .disabled(url.isEmpty || key.isEmpty || connecting)
                }
            } footer: {
                Text("Your agent server, reached from every device. Chats live on it, so they're the same here, on the Mac and on the web. The key follows your Otter account, sealed.")
            }
        }
        .navigationTitle("Agents")
        .toolbarTitleDisplayMode(.inline)
        .onAppear { url = session.agent.hermes.baseUrl }
        .task(id: session.agent.isOn) { await session.agent.check() }
    }

    private var statusText: String {
        guard session.agent.isOn else { return "Off" }
        return switch session.agent.status {
        case .notConfigured: "Not connected"
        case .checking: "Checking…"
        case .ready: "Connected"
        case .failed: "Not answering"
        }
    }

    private var statusColor: Color {
        switch session.agent.status {
        case .ready: palette.focus
        case .failed: palette.error
        default: palette.muted
        }
    }
}
