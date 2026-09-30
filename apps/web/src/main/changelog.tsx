import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  changelogImageName,
  compareVersions,
  formatChangelogDate,
  parseChangelogEntry,
  releasedEntries,
  type ChangelogEntry,
} from "@otter-mail/shared/changelog";
import { toast } from "./gmail/toast";
import { useUpdateState } from "./updates";

/**
 * The changelog in the app: the notes in changelog/ (repository root), bundled
 * at build time with their images, so What's new works offline. Each build
 * shows the versions up to its own, the one the updater reports (the Mac
 * app's real version; the web app's build).
 */

const notes = import.meta.glob<string>("../../../../changelog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const images = import.meta.glob<string>("../../../../changelog/images/*", {
  query: "?url",
  import: "default",
  eager: true,
});

const ENTRIES: ChangelogEntry[] = Object.entries(notes).map(([path, text]) =>
  parseChangelogEntry(path.split("/").pop()!.replace(/\.md$/, ""), text),
);

const imageUrl = (src: string | undefined) => {
  const name = src ? changelogImageName(src) : null;
  return name ? images[`../../../../changelog/images/${name}`] : src;
};

/** Released notes, newest first, and the version they run up to. */
export function useChangelog(): { entries: ChangelogEntry[]; current: string | null } {
  const current = useUpdateState()?.currentVersion ?? null;
  return { entries: current ? releasedEntries(ENTRIES, current) : [], current };
}

const SEEN_KEY = "otter:changelog:seen";

/**
 * Once after an update: a toast naming the new version, with What's new. A
 * first launch only notes the version (the setup and the tour cover it).
 */
export async function offerWhatsNew(open: () => void): Promise<void> {
  const current = (await window.desktopBridge.updates.getState()).currentVersion;
  const seen = localStorage.getItem(SEEN_KEY);
  localStorage.setItem(SEEN_KEY, current);
  if (!seen || compareVersions(current, seen) <= 0) return;
  const entry = ENTRIES.find((e) => e.version === current);
  if (!entry) return;
  console.log("[Changelog:offer]", { from: seen, to: current });
  toast.info(`Updated to Otter Mail ${current}`, {
    description: entry.title,
    timeout: 10_000,
    action: { label: "What's new", onClick: open },
  });
}

/** One release as the page shows it: version and title, date, then the note. */
export function ChangelogArticle({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 px-[17px]">
        <h2 className="text-lg font-medium tracking-[-0.01em] text-foreground">
          <span className="mr-1.5 font-normal tabular-nums text-muted-foreground">
            {entry.version}
          </span>
          {entry.title}
        </h2>
        <time dateTime={entry.date} className="text-[13px] text-muted-foreground">
          {formatChangelogDate(entry.date)}
        </time>
      </header>
      <div className="flex flex-col gap-3 px-[17px] text-sm leading-relaxed text-foreground/85 [&>p:first-child]:text-[15px] [&>p:first-child]:text-foreground">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            // An image on its own line is a figure; its alt text, the caption.
            p: ({ children, node }) => {
              const only = node?.children.length === 1 ? node.children[0] : undefined;
              if (only?.type === "element" && only.tagName === "img") return <>{children}</>;
              return <p>{children}</p>;
            },
            img: ({ src, alt }) => (
              <figure className="my-2 flex flex-col gap-2">
                <img
                  src={imageUrl(typeof src === "string" ? src : undefined)}
                  alt={alt ?? ""}
                  loading="lazy"
                  className="w-full rounded-xl border border-border/70"
                />
                {alt ? (
                  <figcaption className="text-center text-xs text-muted-foreground">
                    {alt}
                  </figcaption>
                ) : null}
              </figure>
            ),
            h2: ({ children }) => (
              <h3 className="mt-2 text-sm font-medium text-foreground">{children}</h3>
            ),
            ul: ({ children }) => (
              <ul className="-mt-1 flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground">
                {children}
              </ul>
            ),
            code: ({ children }) => (
              <code className="rounded bg-code px-1 py-0.5 font-mono text-[12px] text-code-foreground">
                {children}
              </code>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href) void window.desktopBridge.openExternal(href);
                }}
                className="text-foreground underline underline-offset-2 hover:opacity-80"
              >
                {children}
              </a>
            ),
          }}
        >
          {entry.body}
        </Markdown>
      </div>
    </article>
  );
}
