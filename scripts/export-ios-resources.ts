/**
 * Hands the iPhone app (apps/ios) what it shares with the other apps, as
 * JSON in its bundle: the color themes (apps/web's theme palettes) and the
 * demo mailbox (apps/web's demo seed). Run it after changing either:
 *
 *   pnpm ios:resources
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ThemeDefinition } from "../apps/web/src/main/theme/theme-palettes.ts";

// The seed needs only core's base64 helper; the rest of core doesn't run on plain Node.
registerHooks({
  resolve: (specifier, context, next) =>
    next(specifier === "@otter-mail/core" ? "../packages/core/src/bytes.ts" : specifier, {
      ...context,
      parentURL: specifier === "@otter-mail/core" ? import.meta.url : context.parentURL,
    }),
});

const {
  BUILT_IN_THEMES,
  OTTER_DARK_THEME_COLORS,
  OTTER_LIGHT_THEME_COLORS,
  getThemeColorsForAppearance,
} = await import("../apps/web/src/main/theme/theme-palettes.ts");
const { DEMO_ACCOUNTS } = await import("../apps/web/src/web/demo/seed.ts");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/ios/OtterMail/Resources");
mkdirSync(out, { recursive: true });

// The stock palette, as apps/web/src/main/theme/apply-theme.ts defines it.
const otter: ThemeDefinition = {
  id: "otter",
  label: "Otter Code",
  appearance: "light",
  colors: OTTER_LIGHT_THEME_COLORS,
  variants: { light: OTTER_LIGHT_THEME_COLORS, dark: OTTER_DARK_THEME_COLORS },
};

const themes = [otter, ...BUILT_IN_THEMES].map((theme) => ({
  id: theme.id,
  label: theme.label,
  exact: theme.exact ?? false,
  monochrome: theme.monochrome ?? false,
  light: getThemeColorsForAppearance(theme, "light") ?? OTTER_LIGHT_THEME_COLORS,
  dark: getThemeColorsForAppearance(theme, "dark") ?? OTTER_DARK_THEME_COLORS,
}));

// Dates in the mail's text are fixed at export; the app places messages by `hoursAgo`.
const seededAt = Date.now();
const demo = DEMO_ACCOUNTS.map(({ threads, ...account }) => ({
  ...account,
  threads: threads(seededAt).map((thread) => ({
    ...thread,
    messages: thread.messages.map(({ attachments, ...message }) => ({
      ...message,
      attachments: (attachments ?? [])
        .filter((a) => !a.contentId)
        .map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.content.length })),
    })),
  })),
}));

const write = (name: string, value: unknown) => {
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Wrote apps/ios/OtterMail/Resources/${name}`);
};
write("Themes.json", themes);
write("DemoMailboxes.json", demo);
