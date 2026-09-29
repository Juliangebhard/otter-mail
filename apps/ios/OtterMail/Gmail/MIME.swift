import Foundation

/** An RFC 5322 message to hand Gmail (`raw`): plain text and HTML, UTF-8, replies threaded. */
nonisolated enum MIME {
    static func message(
        from: Person,
        to: [Person],
        cc: [Person],
        subject: String,
        text: String,
        html: String,
        inReplyTo: String? = nil,
        references: String? = nil
    ) -> Data {
        let boundary = "otter-\(UUID().uuidString)"
        var headers = [
            "From: \(address(from))",
            "To: \(to.map(address).joined(separator: ", "))",
        ]
        if !cc.isEmpty { headers.append("Cc: \(cc.map(address).joined(separator: ", "))") }
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
        let message = headers.joined(separator: "\r\n") + "\r\n\r\n"
            + part("text/plain", text) + part("text/html", html) + "--\(boundary)--\r\n"
        return Data(message.utf8)
    }

    private static func address(_ person: Person) -> String {
        person.name.isEmpty ? person.email : "\(encoded(person.name, quoted: true)) <\(person.email)>"
    }

    /** RFC 2047 for anything not plain ASCII. */
    private static func encoded(_ text: String, quoted: Bool = false) -> String {
        if text.allSatisfy({ $0.isASCII }) {
            return quoted && text.contains(where: { ",;:<>@\"".contains($0) })
                ? "\"\(text.replacingOccurrences(of: "\"", with: "\\\""))\"" : text
        }
        return "=?UTF-8?B?\(Data(text.utf8).base64EncodedString())?="
    }
}
