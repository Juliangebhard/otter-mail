import { afterEach, expect, it, vi } from "vite-plus/test";

const opened = vi.hoisted(() => vi.fn());
const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock("../main-link.js", () => ({ requestMain: opened }));
vi.mock("@otter-mail/core", () => ({
  accountStore: { listAccounts: async () => [] },
  platform: () => ({
    secrets: {
      get: async (key: string) => secrets.get(key) ?? null,
      set: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      delete: async (key: string) => {
        secrets.delete(key);
      },
    },
  }),
}));

import { microsoftAuth } from "./microsoft-oauth.js";

const realFetch = fetch;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  opened.mockReset();
  await microsoftAuth.removeTokens("me@outlook.com");
  secrets.clear();
});

it("checks the loopback state, stores tokens locally, and refreshes an expiring access token", async () => {
  vi.stubEnv("OTTER_MAIL_MICROSOFT_CLIENT_ID", "public-client-id");
  const requests: URLSearchParams[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://login.microsoftonline.com/")) {
      const body = new URLSearchParams(init?.body as string);
      requests.push(body);
      return Response.json({
        access_token: requests.length === 1 ? "first-access" : "fresh-access",
        refresh_token: requests.length === 1 ? "first-refresh" : "fresh-refresh",
        expires_in: requests.length === 1 ? 60 : 3600,
      });
    }
    return realFetch(input, init);
  });
  opened.mockImplementationOnce(async (_kind: string, { url }: { url: string }) => {
    const consent = new URL(url);
    expect(consent.origin).toBe("https://login.microsoftonline.com");
    expect(consent.searchParams.get("scope")).toContain("IMAP.AccessAsUser.All");
    expect(consent.searchParams.get("scope")).toContain("SMTP.Send");
    expect(consent.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = consent.searchParams.get("redirect_uri")!;
    expect((await realFetch(`${callback}?state=wrong&code=bad`)).status).toBe(400);
    expect(
      (await realFetch(`${callback}?state=${consent.searchParams.get("state")}&code=good`)).status,
    ).toBe(200);
  });

  await microsoftAuth.signIn("me@outlook.com");
  expect(microsoftAuth.isSignedIn("me@outlook.com")).toBe(true);
  expect(JSON.parse(secrets.get("microsoft-tokens:me@outlook.com")!)).toMatchObject({
    clientId: "public-client-id",
    refreshToken: "first-refresh",
  });
  expect(await microsoftAuth.getAccessToken("me@outlook.com")).toBe("fresh-access");
  expect(requests.map((body) => body.get("grant_type"))).toEqual([
    "authorization_code",
    "refresh_token",
  ]);
  expect(requests[1]!.get("refresh_token")).toBe("first-refresh");
});
