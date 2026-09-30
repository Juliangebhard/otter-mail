import SwiftUI
import Testing
@testable import Otter_Mail

/** Themes made on the Mac or the web, as the phone reads them (CustomThemes). */
struct CustomThemesTests {
    private let dark = #"{"canvas":"oklch(0.226288 0.021374 280.487)","messageAction":"oklch(0.704871 0.186721 47.604 / 0.9)"}"#

    @Test func readsAThemeWithOnePalette() throws {
        let themes = CustomThemes.themes(#"[{"id":"tokyo-night","label":"Tokyo Night","appearance":"dark","colors":\#(dark)}]"#)
        let theme = try #require(themes.first)
        #expect(theme.label == "Tokyo Night")
        #expect(theme.modes == [.dark])
        #expect(theme.exact && theme.monochrome)
        #expect(same(theme.dark["canvas"]!, "#1a1b26"))
        // The phone ignores alpha; the color itself still reads.
        #expect(same(theme.dark["messageAction"]!, "#f97316"))
        // The appearance it lacks is the stock palette's, as on the web.
        #expect(theme.light == Theme.named("otter")?.light)
    }

    /** The same sRGB color, to the byte. */
    private func same(_ css: String, _ hex: String) -> Bool {
        let (a, b) = (RGB(css: css), RGB(css: hex))
        return [a.r - b.r, a.g - b.g, a.b - b.b].allSatisfy { abs($0) < 1 / 255 }
    }

    @Test func readsBothPalettes() throws {
        let raw = ##"[{"id":"pair","label":"Pair","appearance":"light","colors":{"canvas":"#ffffff"},"variants":{"dark":\##(dark)}}]"##
        let theme = try #require(CustomThemes.themes(raw).first)
        #expect(theme.modes == [.light, .dark])
        #expect(theme.light["canvas"] == "#ffffff")
    }

    @Test func dropsWhatDoesntHoldUp() {
        #expect(CustomThemes.themes(nil).isEmpty)
        #expect(CustomThemes.themes("nope").isEmpty)
        let raw = #"[{"id":"codex","label":"Taken","appearance":"dark","colors":{}},{"id":"x","label":"","appearance":"dark","colors":{}},{"id":"y","label":"Y","appearance":"dim","colors":{}},null]"#
        #expect(CustomThemes.themes(raw).isEmpty)
    }
}
