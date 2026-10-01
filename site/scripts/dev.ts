// The site for development, without building the web app: the pages in public/
// as they are on disk (each with the landing page's header and footer, as the build
// gives them) and the changelog, rebuilt at each visit. A reload shows an edit.
// `pnpm dev:site` (it restarts when these scripts change); the web app itself is `pnpm dev`.

import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { writeChangelog } from "./changelog.ts";
import { withSiteLayout } from "./layout.ts";

const site = NodePath.resolve(import.meta.dirname, "..");
const pub = NodePath.join(site, "public");
const changelog = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-mail-site-"));
const port = Number(process.env.PORT ?? 4321);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/** The file for a path: a page's index.html, or the file itself. */
function find(root: string, pathname: string): string | null {
  const path = NodePath.join(root, decodeURIComponent(pathname));
  if (!path.startsWith(root)) return null;
  const file = pathname.endsWith("/") ? NodePath.join(path, "index.html") : path;
  return NodeFS.existsSync(file) && NodeFS.statSync(file).isFile() ? file : null;
}

NodeHttp.createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  // Pages without their trailing slash, as Cloudflare serves them.
  if (!NodePath.extname(pathname) && !pathname.endsWith("/")) {
    response.writeHead(307, { location: `${pathname}/` }).end();
    return;
  }
  let root = pub;
  if (pathname.startsWith("/changelog/")) {
    const released = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(site, "../apps/desktop/package.json"), "utf8"),
    ) as { version: string };
    writeChangelog(changelog, released.version);
    root = changelog;
  }
  const file = find(root, pathname) ?? NodePath.join(pub, "404.html");
  const type = TYPES[NodePath.extname(file)] ?? "application/octet-stream";
  const body = type.startsWith("text/html")
    ? withSiteLayout(NodeFS.readFileSync(file, "utf8"))
    : NodeFS.readFileSync(file);
  response
    .writeHead(file.endsWith("404.html") && pathname !== "/404.html" ? 404 : 200, {
      "content-type": type,
      "cache-control": "no-store",
    })
    .end(body);
}).listen(port, () => console.log(`[site] http://localhost:${port}`));
