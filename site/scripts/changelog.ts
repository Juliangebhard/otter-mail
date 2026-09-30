// The changelog pages (/changelog: the index, and a page per release) from
// the notes in changelog/ at the repository root. Run by build.ts.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { Marked, type Tokens } from "marked";
import {
  changelogImageName,
  formatChangelogDate,
  parseChangelogEntry,
  releasedEntries,
  type ChangelogEntry,
} from "@otter-mail/shared/changelog";

const repo = NodePath.resolve(import.meta.dirname, "../..");
const notes = NodePath.join(repo, "changelog");

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Every note in changelog/, parsed (a malformed one throws). */
export function readChangelog(): ChangelogEntry[] {
  return NodeFS.readdirSync(notes)
    .filter((name) => /^\d+\.\d+\.\d+\.md$/.test(name))
    .map((name) =>
      parseChangelogEntry(
        name.slice(0, -3),
        NodeFS.readFileSync(NodePath.join(notes, name), "utf8"),
      ),
    );
}

/** An image on its own line becomes a figure, its alt text the caption. */
const figure = (image: Tokens.Image) => {
  const name = changelogImageName(image.href);
  const src = name ? `/changelog/images/${name}` : image.href;
  return `<figure><img src="${escape(src)}" alt="${escape(image.text)}" loading="lazy" /><figcaption>${escape(image.text)}</figcaption></figure>\n`;
};

const markdown = new Marked({
  renderer: {
    paragraph({ tokens }) {
      const only = tokens.length === 1 ? tokens[0] : undefined;
      if (only?.type === "image") return figure(only as Tokens.Image);
      return `<p>${this.parser.parseInline(tokens)}</p>\n`;
    },
  },
});

const page = (title: string, body: string, description: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}" />
    <link rel="icon" href="/favicon.png" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="changelog">
${body}
      <footer>
        <a href="/">Otter Mail</a><a href="/changelog/">Changelog</a><a href="/privacy/">Privacy</a
        ><a href="https://github.com/otterware-app">Otterware</a>
      </footer>
    </main>
  </body>
</html>
`;

const heading = (e: ChangelogEntry) =>
  `<span class="version">${escape(e.version)}</span> ${escape(e.title)}`;

/** Writes dist/changelog: released notes only (up to `current`), newest first. */
export function writeChangelog(dist: string, current: string): void {
  const entries = releasedEntries(readChangelog(), current);
  const out = NodePath.join(dist, "changelog");
  NodeFS.mkdirSync(out, { recursive: true });
  NodeFS.cpSync(NodePath.join(notes, "images"), NodePath.join(out, "images"), {
    recursive: true,
  });

  const index = entries
    .map(
      (e) => `        <li>
          <a href="/changelog/${e.version}/">
            <span class="name">${heading(e)}</span>
            <time datetime="${e.date}">${formatChangelogDate(e.date)}</time>
          </a>
        </li>`,
    )
    .join("\n");
  NodeFS.writeFileSync(
    NodePath.join(out, "index.html"),
    page(
      "Changelog · Otter Mail",
      `      <h1>Changelog</h1>
      <p class="updated">What's new in Otter Mail, on the Mac and the web.</p>
      <ol class="releases">
${index}
      </ol>`,
      "What's new in Otter Mail, release by release.",
    ),
  );

  entries.forEach((e, i) => {
    const newer = entries[i - 1];
    const older = entries[i + 1];
    const link = (to: ChangelogEntry | undefined, text: (e: ChangelogEntry) => string) =>
      to ? `<a href="/changelog/${to.version}/">${text(to)}</a>` : "<span></span>";
    const dir = NodePath.join(out, e.version);
    NodeFS.mkdirSync(dir, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(dir, "index.html"),
      page(
        `${e.version}: ${e.title} · Otter Mail`,
        `      <a class="back" href="/changelog/">← Changelog</a>
      <h1>${escape(e.version)}: ${escape(e.title)}</h1>
      <p class="updated"><time datetime="${e.date}">${formatChangelogDate(e.date)}</time></p>
      <article>
${markdown.parse(e.body)}
      </article>
      <nav class="pager">${link(older, (o) => `← ${heading(o)}`)}${link(newer, (n) => `${heading(n)} →`)}</nav>`,
        e.body.split("\n")[0] ?? e.title,
      ),
    );
  });
  console.log(`Changelog: ${entries.length} releases, up to ${current}.`);
}
