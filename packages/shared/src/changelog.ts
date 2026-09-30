/**
 * The changelog: one short note per Mac and web release, `changelog/<version>.md`
 * at the repository root (images beside it in `changelog/images/`). The site
 * shows it at /changelog, the app in Settings → What's new. Notes are written
 * before the release they describe, so each reader shows only the versions up
 * to its own. How to write one: the write-changelog skill (.agents/skills).
 */

export type ChangelogEntry = {
  version: string;
  /** A few words naming the release: "Onboarding", "A smarter ⌘K". */
  title: string;
  /** The release day, YYYY-MM-DD. */
  date: string;
  /** Markdown after the front matter: a lead line, images, then ## sections of bullets. */
  body: string;
};

/**
 * One note from its file: front matter (`title:`, `date:` between `---`
 * lines), then markdown. `version` comes from the file name.
 */
export function parseChangelogEntry(version: string, text: string): ChangelogEntry {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`changelog/${version}.md: missing front matter`);
  const fields = Object.fromEntries(
    match[1]!.split(/\r?\n/).flatMap((line) => {
      const at = line.indexOf(":");
      return at < 0 ? [] : [[line.slice(0, at).trim(), line.slice(at + 1).trim()]];
    }),
  );
  const title = fields.title?.replace(/^["']|["']$/g, "");
  const date = fields.date;
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? ""))
    throw new Error(`changelog/${version}.md: needs a title and a date (YYYY-MM-DD)`);
  return { version, title, date: date!, body: match[2]!.trim() };
}

/** Semver order of X.Y.Z versions: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Newest first, up to `current`: notes written ahead of a release wait for it. */
export function releasedEntries(entries: ChangelogEntry[], current: string): ChangelogEntry[] {
  return entries
    .filter((e) => compareVersions(e.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** "2026-09-30" → "September 30, 2026". */
export function formatChangelogDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** An image's path as written in a note (`images/onboarding.webp`) → its file name. */
export function changelogImageName(src: string): string | null {
  const match = /^(?:\.\/)?images\/([^/]+)$/.exec(src);
  return match ? match[1]! : null;
}

/** The site's changelog, or one release's page there. */
export const changelogUrl = (version?: string | null) =>
  `https://mail.otterware.app/changelog/${version ? `${version}/` : ""}`;
