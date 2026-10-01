// The landing page's header and footer, so every page wears the same ones. Run by build.ts.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const landing = () =>
  NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../public/index.html"), "utf8");

function landingPart(pattern: RegExp, name: string): string {
  const part = pattern.exec(landing());
  if (!part) throw new Error(`site/public/index.html: no ${name}`);
  // Links to the landing page's own sections, made absolute.
  return part[0].replace(/href="#/g, 'href="/#');
}

/** The landing page's <nav>. */
export const siteNav = (): string => landingPart(/<nav class="nav">[\s\S]*?<\/nav>/, "<nav>");

/** The landing page's <footer>. */
export const siteFooter = (): string => landingPart(/<footer>[\s\S]*?<\/footer>/, "<footer>");

/** A page's empty <nav class="nav"></nav> and <footer></footer>, filled with the landing page's. */
export function withSiteLayout(html: string): string {
  return html
    .replace('<nav class="nav"></nav>', () => siteNav())
    .replace("<footer></footer>", () => siteFooter());
}
