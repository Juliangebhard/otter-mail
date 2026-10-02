import Foundation

/**
 * An RFC 5322 message to hand Gmail (`raw`) or an SMTP server: plain text and
 * HTML, UTF-8, replies threaded. `stamped` adds the Date and Message-ID that
 * Gmail would add itself (an IMAP copy keeps the message as written).
 */
nonisolated enum MIME {
    struct File {
        var filename: String
        var mimeType: String
        var data: Data
    }

    static func message(
        from: Person,
        to: [Person],
        cc: [Person],
        bcc: [Person] = [],
        files: [File] = [],
        subject: String,
        text: String,
        html: String,
        inReplyTo: String? = nil,
        references: String? = nil,
        stamped: Bool = false
    ) -> Data {
        let boundary = "otter-\(UUID().uuidString)"
        var headers = [
            "From: \(address(from))",
            "To: \(to.map(address).joined(separator: ", "))",
        ]
        if !cc.isEmpty { headers.append("Cc: \(cc.map(address).joined(separator: ", "))") }
        if !bcc.isEmpty { headers.append("Bcc: \(bcc.map(address).joined(separator: ", "))") }
        if stamped {
            headers.append("Date: \(rfc5322Date.string(from: .now))")
            let domain = from.email.split(separator: "@").last.map(String.init) ?? "otterware.app"
            headers.append("Message-ID: <\(UUID().uuidString.lowercased())@\(domain)>")
        }
        headers.append("Subject: \(encoded(subject))")
        if let inReplyTo {
            headers.append("In-Reply-To: \(inReplyTo)")
            headers.append("References: \([references, inReplyTo].compactMap { $0 }.joined(separator: " "))")
        }
        headers += [
            "MIME-Version: 1.0",
            "Content-Type: multipart/alternative; boundary=\"\(boundary)\"",
        ]
        let part = { (type: String, body: String) in
            [
                "--\(boundary)",
                "Content-Type: \(type); charset=\"UTF-8\"",
                "Content-Transfer-Encoding: base64",
                "",
                Data(body.utf8).base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed]),
                "",
            ].joined(separator: "\r\n")
        }
        let body = part("text/plain", text) + part("text/html", html) + "--\(boundary)--\r\n"
        guard !files.isEmpty else { return Data((headers.joined(separator: "\r\n") + "\r\n\r\n" + body).utf8) }
        let mixed = "otter-mixed-\(UUID().uuidString)"
        headers[headers.count - 1] = "Content-Type: multipart/mixed; boundary=\"\(mixed)\""
        var message = headers.joined(separator: "\r\n") + "\r\n\r\n--\(mixed)\r\n"
            + "Content-Type: multipart/alternative; boundary=\"\(boundary)\"\r\n\r\n" + body
        for file in files {
            let filename = file.filename.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "attachment"
            let type = file.mimeType.contains(where: { $0.isWhitespace }) ? "application/octet-stream" : file.mimeType
            message += "--\(mixed)\r\nContent-Type: \(type)\r\n"
                + "Content-Disposition: attachment; filename*=UTF-8''\(filename)\r\nContent-Transfer-Encoding: base64\r\n\r\n"
                + file.data.base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed]) + "\r\n"
        }
        message += "--\(mixed)--\r\n"
        return Data(message.utf8)
    }

    private static let rfc5322Date = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        return formatter
    }()

    private static func address(_ person: Person) -> String {
        let email = person.email.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        return person.name.isEmpty ? email : "\(encoded(person.name, quoted: true)) <\(email)>"
    }

    /** RFC 2047 for anything not plain ASCII. */
    private static func encoded(_ text: String, quoted: Bool = false) -> String {
        let text = text.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        if text.allSatisfy({ $0.isASCII }) {
            return quoted && text.contains(where: { ",;:<>@\"".contains($0) })
                ? "\"\(text.replacingOccurrences(of: "\"", with: "\\\""))\"" : text
        }
        return "=?UTF-8?B?\(Data(text.utf8).base64EncodedString())?="
    }
}
