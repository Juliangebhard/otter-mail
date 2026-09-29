import NaturalLanguage
import QuickLook
import SwiftUI
@preconcurrency import Translation

/**
 * One message of a conversation. Folded, it's who and a line of it; open,
 * the whole message, translated when it's in a language the user doesn't
 * read and Settings › Translate automatically is on (Apple's on-device
 * Translation, as on the Mac).
 */
struct MessageView: View {
    @Environment(Preferences.self) private var preferences
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let message: Message
    let mailbox: Mailbox
    let open: Bool
    let onTap: () -> Void

    @State private var showTranslation = false
    @State private var translated: String?
    @State private var showOriginal = false
    @State private var translation: TranslationSession.Configuration?
    @State private var preview: URL?
    @State private var showQuote = false
    @State private var opening: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
                .contentShape(.rect)
                .onTapGesture(perform: onTap)

            if open {
                if let translated, !showOriginal {
                    Text(translated).bodyText(palette)
                } else if let html = message.html {
                    HTMLBody(html: html, inline: message.inline ?? []) { image in
                        await store.sync?.inlineImage(image, of: message, in: mailbox.email)
                    }
                } else {
                    let (body, quote) = Quote.split(message.text)
                    Text(showQuote ? message.text : body).bodyText(palette)
                    if quote != nil && !showQuote {
                        Button("Show quoted text", systemImage: "ellipsis") { showQuote = true }
                            .labelStyle(.iconOnly)
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(palette.muted)
                            .frame(width: 36, height: 22)
                            .background(palette.surface, in: .capsule)
                            .overlay(Capsule().strokeBorder(palette.border))
                    }
                }

                if translated != nil {
                    Button(showOriginal ? "Show translation" : "Translated · Show original") {
                        showOriginal.toggle()
                    }
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                }

                if !message.attachments.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(message.attachments, id: \.filename) { attachment in
                                Button { open(attachment) } label: {
                                    AttachmentChip(attachment: attachment, loading: opening == attachment.filename)
                                }
                                .buttonStyle(.plain)
                                .disabled(attachment.id == nil)
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
        .quickLookPreview($preview)
        .translationPresentation(isPresented: $showTranslation, text: message.text)
        .translationTask(translation) { session in
            translated = try? await session.translate(message.text).targetText
        }
        .task(id: open && preferences.autoTranslate) {
            guard open, preferences.autoTranslate, message.html == nil, translated == nil else { return }
            let recognizer = NLLanguageRecognizer()
            recognizer.processString(message.text)
            guard let language = recognizer.dominantLanguage?.rawValue else { return }
            let read = preferences.effectiveReadLanguages
            guard !read.contains(where: { $0.hasPrefix(language) }), let target = read.first else { return }
            translation = .init(source: Locale.Language(identifier: language), target: Locale.Language(identifier: target))
        }
        .contextMenu {
            Button("Translate", systemImage: "translate") { showTranslation = true }
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.text }
        }
    }

    /** Downloads the file from Gmail and shows it in Quick Look. */
    private func open(_ attachment: Attachment) {
        guard let sync = store.sync, opening == nil else { return }
        opening = attachment.filename
        Task {
            preview = try? await sync.attachment(attachment, of: message, in: mailbox.email)
            opening = nil
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            SenderAvatar(person: message.from, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(message.from.email == mailbox.email ? "Me" : message.from.label)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(palette.text)
                        .lineLimit(1)
                    if message.draft {
                        Text("Draft")
                            .font(.subheadline)
                            .foregroundStyle(palette.error)
                    }
                    Spacer()
                    Text(RelativeTime.short(message.date))
                        .font(.subheadline)
                        .foregroundStyle(palette.muted)
                }
                Text(open ? recipients : message.snippet)
                    .font(.subheadline)
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
        }
    }

    private var recipients: String {
        let name = { (p: Person) in p.email == mailbox.email ? "me" : p.label }
        let to = "to " + message.to.map(name).joined(separator: ", ")
        return message.cc.isEmpty ? to : "\(to), cc \(message.cc.map(name).joined(separator: ", "))"
    }
}

/** A file on a message: its kind, name and size, compact (the desktop's attachment chip). */
struct AttachmentChip: View {
    @Environment(\.palette) private var palette
    let attachment: Attachment
    var loading = false

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if loading { ProgressView() } else { Image(systemName: symbol) }
            }
            .font(.system(size: 18))
            .foregroundStyle(palette.muted)
            .frame(width: 32, height: 32)
            .background(palette.surface, in: .rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 1) {
                Text(attachment.filename)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(palette.text)
                    .lineLimit(1)
                Text(ByteCountFormatStyle().format(Int64(attachment.size)))
                    .font(.caption)
                    .foregroundStyle(palette.muted)
            }
        }
        .padding(6)
        .padding(.trailing, 8)
        .frame(maxWidth: 240, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border))
    }

    private var symbol: String {
        switch attachment.mimeType {
        case let type where type.hasPrefix("image/"): "photo"
        case "application/pdf": "doc.richtext"
        case "text/calendar": "calendar"
        case "text/csv": "tablecells"
        default: "doc"
        }
    }
}

private extension Text {
    func bodyText(_ palette: Palette) -> some View {
        font(.body)
            .foregroundStyle(palette.text)
            .lineSpacing(3)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
