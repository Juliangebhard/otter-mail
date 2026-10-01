// The changelog page (/changelog: every released note, the versions down the side) from
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
import { siteFooter, siteNav } from "./layout.ts";

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

/**
 * Writes dist/changelog/index.html: every released note (up to `current`) on
 * one page, newest first, with the versions down the side. Each note's anchor
 * is its version (/changelog/#0.5.17).
 */
export function writeChangelog(dist: string, current: string): void {
  const entries = releasedEntries(readChangelog(), current);
  const out = NodePath.join(dist, "changelog");
  NodeFS.mkdirSync(out, { recursive: true });
  NodeFS.cpSync(NodePath.join(notes, "images"), NodePath.join(out, "images"), {
    recursive: true,
  });

  const toc = entries
    .map(
      (e) =>
        `            <li><a href="#${e.version}"><span class="version">${escape(e.version)}</span> ${escape(e.title)}</a></li>`,
    )
    .join("\n");
  const notesHtml = entries
    .map(
      (e) => `          <article class="entry" id="${e.version}">
            <p class="meta"><a href="#${e.version}">${escape(e.version)}</a> · <time datetime="${e.date}">${formatChangelogDate(e.date)}</time></p>
            <h2>${escape(e.title)}</h2>
${markdown.parse(e.body.replace(/^## /gm, "### "))}
          </article>`,
    )
    .join("\n");

  NodeFS.writeFileSync(
    NodePath.join(out, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Changelog · Otter Mail</title>
    <meta name="description" content="What's new in Otter Mail, release by release." />
    <link rel="icon" href="/favicon.png" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body class="landing">
    <div class="wrap">
      ${siteNav()}
    </div>

    <main class="page changelog">
      <div class="wrap">
        <header>
          <h1>Changelog</h1>
          <p>What's new in Otter Mail, on the Mac and the web.</p>
        </header>
        <div class="changelog-layout">
          <nav class="toc" aria-label="Versions">
            <ol>
${toc}
            </ol>
          </nav>
          <div class="entries">
${notesHtml}
          </div>
        </div>
        ${siteFooter()}
      </div>
    </main>

    <script>
      // The side list follows the note being read: the last one whose top has
      // scrolled near the top of the window.
      (() => {
        const entries = [...document.querySelectorAll(".entry")];
        const links = [...document.querySelectorAll(".toc a")];
        const update = () => {
          // At the bottom of the page, the last note (it may never reach the top).
          const bottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
          const current = bottom
            ? entries.at(-1)
            : (entries.filter((e) => e.getBoundingClientRect().top < 120).pop() ?? entries[0]);
          for (const a of links) a.toggleAttribute("aria-current", a.hash === "#" + current?.id);
        };
        addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
        addEventListener("hashchange", update);
        update();
      })();
    </script>
  </body>
</html>
`,
  );
  console.log(`Changelog: ${entries.length} releases, up to ${current}.`);
}
