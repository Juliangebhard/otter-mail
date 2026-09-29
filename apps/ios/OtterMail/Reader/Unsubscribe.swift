import SwiftUI

/**
 * Leaving a mailing list, from its List-Unsubscribe header (core's
 * unsubscribe.ts): one click when the sender supports it (RFC 8058), else
 * its page, else an email to its unsubscribe address.
 */
struct Unsubscribe {
    let web: URL?
    let mail: URL?
    let oneClick: Bool

    init?(_ headers: [String: String]) {
        guard let header = headers["List-Unsubscribe"] else { return nil }
        let links = header.split(separator: ",").compactMap { part in
            URL(string: part.trimmingCharacters(in: .whitespaces.union(["<", ">"])))
        }
        web = links.first { $0.scheme == "https" }
        mail = links.first { $0.scheme == "mailto" }
        oneClick = web != nil && headers["List-Unsubscribe-Post"]?.contains("One-Click") == true
        if web == nil && mail == nil { return nil }
    }

    func run(from mailbox: Mailbox, compose: (Draft) -> Void) async {
        if oneClick, let web {
            var request = URLRequest(url: web)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("List-Unsubscribe=One-Click".utf8)
            if let (_, response) = try? await URLSession.shared.data(for: request),
               (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0) {
                return
            }
        }
        if let web {
            await UIApplication.shared.open(web)
        } else if let mail, let components = URLComponents(url: mail, resolvingAgainstBaseURL: false) {
            var draft = Draft.new(from: mailbox, to: components.path)
            draft.subject = components.queryItems?.first { $0.name.lowercased() == "subject" }?.value ?? "Unsubscribe"
            draft.body = components.queryItems?.first { $0.name.lowercased() == "body" }?.value ?? draft.body
            compose(draft)
        }
    }
}
