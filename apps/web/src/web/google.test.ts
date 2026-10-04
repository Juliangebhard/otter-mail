import { afterEach, expect, it, vi } from "vite-plus/test";
import { webGoogleAuth } from "./google";

afterEach(() => vi.unstubAllGlobals());

it.each([undefined, "current-client"])(
  "preserves a stored Gmail grant and learns its issuing client (%s)",
  async (clientId) => {
    let saved = JSON.stringify({
      "mail@otter.example": {
        sealed: "original-sealed-grant",
        accessToken: "cached-access",
        expiresAt: Date.now() + 3_600_000,
        clientId,
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        accessToken: "refreshed-access",
        expiresIn: 3600,
        idToken: "fake-id-token",
        clientId: "legacy-client",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const auth = webGoogleAuth({
      relayUrl: "https://relay.test",
      page: {
        request: async () => {
          throw new Error("Not used");
        },
        effect: () => {},
        broadcast: () => {},
        onResume: () => () => {},
      },
      files: {
        read: async () => new TextEncoder().encode(saved),
        write: async (_path, data) => {
          saved = typeof data === "string" ? data : new TextDecoder().decode(data);
        },
        remove: async () => {},
        list: async () => [],
      },
    });
    await auth.load();
    expect(await auth.getAccessToken("mail@otter.example")).toBe("cached-access");
    expect(fetch).not.toHaveBeenCalled();
    expect(await auth.getClientId!("mail@otter.example")).toBe(clientId ?? "legacy-client");
    expect(fetch).toHaveBeenCalledTimes(clientId ? 0 : 1);
    if (!clientId) {
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        body: JSON.stringify({ sealed: "original-sealed-grant" }),
      });
      expect(JSON.parse(saved)["mail@otter.example"]).toMatchObject({
        sealed: "original-sealed-grant",
        clientId: "legacy-client",
      });
    }
  },
);
