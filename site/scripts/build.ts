// Assembles the site in dist/: the landing pages (public/), the changelog
// (changelog/ at the repository root) and the web app (apps/web's build, its
// page as app.html). Run by `pnpm build` (and deploy).

import { execFileSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { writeChangelog } from "./changelog.ts";
import { withSiteLayout } from "./layout.ts";

const site = NodePath.resolve(import.meta.dirname, "..");
const web = NodePath.resolve(site, "../apps/web/dist");
const dist = NodePath.join(site, "dist");

execFileSync("pnpm", ["--filter", "@otter-mail/web", "build"], { cwd: site, stdio: "inherit" });

NodeFS.rmSync(dist, { recursive: true, force: true });
NodeFS.cpSync(NodePath.join(site, "public"), dist, { recursive: true });
// Every page wears the landing page's header and footer.
for (const name of NodeFS.readdirSync(dist, { recursive: true, encoding: "utf8" })) {
  if (!name.endsWith(".html")) continue;
  const page = NodePath.join(dist, name);
  NodeFS.writeFileSync(page, withSiteLayout(NodeFS.readFileSync(page, "utf8")));
}
NodeFS.cpSync(NodePath.join(web, "assets"), NodePath.join(dist, "assets"), { recursive: true });
NodeFS.cpSync(NodePath.join(web, "todoist-callback"), NodePath.join(dist, "todoist-callback"), {
  recursive: true,
});
NodeFS.copyFileSync(NodePath.join(web, "index.html"), NodePath.join(dist, "app.html"));
// Released notes only: the version main last released (the Release workflow records it).
const released = JSON.parse(
  NodeFS.readFileSync(NodePath.resolve(site, "../apps/desktop/package.json"), "utf8"),
) as { version: string };
writeChangelog(dist, released.version);
console.log("Site assembled in site/dist.");
