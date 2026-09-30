import { describe, expect, it, vi } from "vite-plus/test";

import worker from "./worker.ts";

function serve(url: string, cookie?: string) {
  const fetch = vi.fn(async (_request: Request) => new Response("asset"));
  const env = { ASSETS: { fetch } as unknown as Fetcher };
  const response = worker.fetch(
    new Request(url, { headers: cookie ? { cookie } : undefined }),
    env,
  );
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
