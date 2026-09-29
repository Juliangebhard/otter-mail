import SwiftUI
import WebKit

/**
 * An HTML message (newsletters, mostly) in WebKit, as tall as its content so
 * it scrolls with the conversation. It's shown as the sender designed it, on
 * a card; links open in the browser.
 */
struct HTMLBody: View {
    let html: String
    /** Images it shows inline (`cid:` references), and how to get their bytes. */
    var inline: [Attachment] = []
    var load: (Attachment) async -> Data? = { _ in nil }

    @State private var page = WebPage(navigationDecider: OpenLinksOutside())
    @State private var height: CGFloat = 200

    var body: some View {
        WebView(page)
            .scrollDisabled(true)
            .frame(height: height)
            .clipShape(.rect(cornerRadius: 14))
            .task(id: html) {
                do {
                    for try await event in page.load(html: Self.fitted(await withImages()), baseURL: URL(string: "about:blank")!) {
                        guard event == .finished else { continue }
                        if let measured = try await page.callJavaScript("return document.documentElement.scrollHeight") as? Double {
                            height = measured
                        }
                    }
                } catch {}
            }
    }

    /** The HTML with each `cid:` image it references swapped for the image itself. */
    private func withImages() async -> String {
        var html = html
        for image in inline {
            guard let cid = image.contentID, html.contains("cid:\(cid)"), let data = await load(image) else { continue }
            html = html.replacingOccurrences(of: "cid:\(cid)", with: "data:\(image.mimeType);base64,\(data.base64EncodedString())")
        }
        return html
    }

    /** Fits fixed-width mail (600px tables) to the phone. */
    private static func fitted(_ html: String) -> String {
        """
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          html, body { margin: 0; -webkit-text-size-adjust: 100%; }
          img { max-width: 100%; height: auto; }
          table { max-width: 100% !important; }
          table[width], td[width] { width: auto !important; }
        </style>
        \(html)
        """
    }

    private struct OpenLinksOutside: WebPage.NavigationDeciding {
        func decidePolicy(
            for action: WebPage.NavigationAction,
            preferences: inout WebPage.NavigationPreferences
        ) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, let url = action.request.url else { return .allow }
            await UIApplication.shared.open(url)
            return .cancel
        }
    }
}
