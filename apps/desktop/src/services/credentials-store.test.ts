import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { getCredentials } from "./credentials-store.js";

beforeEach(() => {
  vi.stubEnv("OTTER_MAIL_GOOGLE_CLIENT_ID", "current-client");
  vi.stubEnv("OTTER_MAIL_GOOGLE_CLIENT_SECRET", "current-secret");
  vi.stubEnv("OTTER_MAIL_GOOGLE_LEGACY_CLIENT_ID", "previous-client");
  vi.stubEnv("OTTER_MAIL_GOOGLE_LEGACY_CLIENT_SECRET", "previous-secret");
});
afterEach(() => vi.unstubAllEnvs());

it("uses the current client for sign-in and the original client for existing grants", async () => {
  expect(await getCredentials()).toEqual({
    clientId: "current-client",
    clientSecret: "current-secret",
  });
  expect(await getCredentials("previous-client")).toEqual({
    clientId: "previous-client",
    clientSecret: "previous-secret",
  });
  expect((await getCredentials(null)).clientId).toBe("previous-client");
  await expect(getCredentials("another-client")).rejects.toThrow("Sign in to this account again");
});
