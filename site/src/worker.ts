/**
 * mail.otterware.app: the landing page for visitors, the web app for anyone
 * signed in to Otter Mail (the relay's session cookie is shared with this
 * domain). Everything else is static: /app (the app itself), /privacy,
 * /terms, /changelog, and the app's assets; and any other page is one of the
 * app's own (/you@gmail.com/INBOX/…, /settings/…), so it gets the app.
 */

interface Env {
  ASSETS: Fetcher;
}

/** A release's old page, now its note on the one changelog page. */
const CHANGELOG_VERSION = /^\/changelog\/(\d+\.\d+\.\d+)\/?$/;

/** better-auth's session cookie (the __Secure- prefix over https). */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "mail.otterware.dev") {
      url.protocol = "https:";
      url.hostname = "mail.otterware.app";
      url.port = "";
      return Response.redirect(url.toString(), 308);
    }
    const version = CHANGELOG_VERSION.exec(url.pathname)?.[1];
    if (version) return Response.redirect(new URL(`/changelog/#${version}`, url).toString(), 301);
    const signedIn = SESSION_COOKIE.test(request.headers.get("cookie") ?? "");
    // "/app" serves app.html (with the app's relative asset paths still resolving from /).
    const page = url.pathname === "/" && signedIn ? new URL("/app", url) : url;
    const response = await env.ASSETS.fetch(new Request(page, request));
    // A browser opening one of the app's pages (it routes them itself; it
    // signs in first if need be). Missing files stay missing.
    if (response.status === 404 && request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/app", url), request));
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
