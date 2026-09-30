import { describe, expect, it, vi } from "vite-plus/test";

import worker from "./worker.ts";

/** The site's files: anything else is missing (the 404 page). */
const FILES = ["/", "/app", "/privacy/", "/changelog/"];

function serve(url: string, cookie?: string, accept?: string) {
  const fetch = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url);
    const file = FILES.includes(pathname) || pathname.startsWith("/changelog/images/");
    return new Response(file ? "asset" : "not found", { status: file ? 200 : 404 });
  });
  const env = { ASSETS: { fetch } as unknown as Fetcher };
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (accept) headers.set("accept", accept);
  const response = worker.fetch(new Request(url, { headers }), env);
  return { response, fetch };
}

describe("site domain migration", () => {
  it.each(["/", "/app?view=inbox", "/privacy/", "/assets/app.js?version=2", "/missing"])(
    "redirects the old domain's %s before serving assets",
    async (path) => {
      const { response, fetch } = serve(
        `https://mail.otterware.dev${path}`,
        "__Secure-better-auth.session_token=session",
      );
      const result = await response;
      expect(result.status).toBe(308);
      expect(result.headers.get("location")).toBe(`https://mail.otterware.app${path}`);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["https://mail.otterware.app", "http://localhost:8787"])(
    "keeps landing pages and signed-in app routing on %s",
    async (origin) => {
      const visitor = serve(`${origin}/`);
      expect((await visitor.response).status).toBe(200);
      expect(visitor.fetch.mock.calls[0][0].url).toBe(`${origin}/`);

      const signedIn = serve(`${origin}/`, "__Secure-better-auth.session_token=session");
      expect((await signedIn.response).status).toBe(200);
      expect(signedIn.fetch.mock.calls[0][0].url).toBe(`${origin}/app`);

      const privacy = serve(`${origin}/privacy/?source=footer`);
      expect((await privacy.response).status).toBe(200);
      expect(privacy.fetch.mock.calls[0][0].url).toBe(`${origin}/privacy/?source=footer`);
    },
  );
});

describe("changelog", () => {
  it.each(["/changelog/0.5.17/", "/changelog/0.5.17"])(
    "sends a release's old page %s to its note on the one page",
    async (path) => {
      const { response, fetch } = serve(`https://mail.otterware.app${path}`);
      const result = await response;
      expect(result.status).toBe(301);
      expect(result.headers.get("location")).toBe("https://mail.otterware.app/changelog/#0.5.17");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("serves the changelog and its images", async () => {
    for (const path of ["/changelog/", "/changelog/images/0.5.17-settings-search.webp"]) {
      const { response, fetch } = serve(`https://mail.otterware.app${path}`);
      expect((await response).status).toBe(200);
      expect(fetch).toHaveBeenCalled();
    }
  });
});

describe("the app's pages", () => {
  const html = "text/html,application/xhtml+xml,*/*;q=0.8";

  it.each(["/you@gmail.com/INBOX/18f3a2", "/all/inbox", "/settings/appearance?target=theme"])(
    "serves the app at %s, signed in or not",
    async (path) => {
      for (const cookie of ["__Secure-better-auth.session_token=session", undefined]) {
        const { response, fetch } = serve(`https://mail.otterware.app${path}`, cookie, html);
        expect((await response).status).toBe(200);
        expect(fetch.mock.calls.at(-1)![0].url).toBe("https://mail.otterware.app/app");
      }
    },
  );

  it("keeps a missing file missing", async () => {
    const { response, fetch } = serve(
      "https://mail.otterware.app/assets/gone.js",
      undefined,
      "*/*",
    );
    expect((await response).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
