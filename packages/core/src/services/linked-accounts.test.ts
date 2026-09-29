import { describe, expect, it, vi } from "vite-plus/test";
import type { RelayAccount } from "@otter-mail/contracts/relay";

vi.mock("electron", () => ({ app: {}, safeStorage: {}, shell: {}, BrowserWindow: {} }));

const { accountFromRelay, linkRequest, planReconcile } = await import("./linked-accounts.ts");

const local = (
  email: string,
  extra: { signedIn?: boolean; displayName?: string; color?: string } = {},
) => ({
  email,
  signedIn: extra.signedIn ?? true,
  displayName: extra.displayName,
  color: extra.color,
});

const remote = (email: string, extra: Partial<RelayAccount> = {}): RelayAccount => ({
  email,
  provider: "gmail",
  imap: null,
  name: null,
  picture: null,
  displayName: null,
  color: null,
  ...extra,
});

const none = { link: [], unlink: [], add: [], remove: [], update: [] };

describe("planReconcile", () => {
  it("does nothing when both sides agree", () => {
    const plan = planReconcile([local("a@x.com")], [remote("a@x.com")], new Set(["a@x.com"]));
    expect(plan).toEqual(none);
  });

  it("first sign-in merges: links what's here, adds what's there", () => {
    const plan = planReconcile(
      [local("here@x.com"), local("both@x.com")],
      [remote("there@x.com"), remote("both@x.com")],
      new Set(),
    );
    expect(plan).toEqual({ ...none, link: ["here@x.com"], add: [remote("there@x.com")] });
  });

  it("can't link a signed-out account (no proof); leaves it alone", () => {
    const plan = planReconcile([local("out@x.com", { signedIn: false })], [], new Set());
    expect(plan).toEqual(none);
  });

  it("an account linked last time and now gone from the relay was removed elsewhere", () => {
    const plan = planReconcile(
      [local("a@x.com"), local("b@x.com")],
      [remote("a@x.com")],
      new Set(["a@x.com", "b@x.com"]),
    );
    expect(plan).toEqual({ ...none, remove: ["b@x.com"] });
  });

  it("an account linked last time and now gone from here was removed here", () => {
    const plan = planReconcile(
      [local("a@x.com")],
      [remote("a@x.com"), remote("b@x.com")],
      new Set(["a@x.com", "b@x.com"]),
    );
    expect(plan).toEqual({ ...none, unlink: ["b@x.com"] });
  });

  it("takes profile edits made elsewhere", () => {
    const edited = remote("a@x.com", { displayName: "Work", color: "#f00" });
    const plan = planReconcile([local("a@x.com")], [edited], new Set(["a@x.com"]));
    expect(plan).toEqual({ ...none, update: [edited] });

    const same = planReconcile(
      [local("a@x.com", { displayName: "Work", color: "#f00" })],
      [edited],
      new Set(["a@x.com"]),
    );
    expect(same).toEqual(none);
  });

  it("compares addresses without case", () => {
    const plan = planReconcile([local("Me@X.com")], [remote("me@x.com")], new Set());
    expect(plan).toEqual(none);
  });
});

const imapSettings = {
  username: "me@fastmail.com",
  imap: { host: "imap.fastmail.com", port: 993, security: "tls" as const },
  smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" as const },
};

describe("IMAP mailboxes", () => {
  it("adds one linked elsewhere, like Gmail", () => {
    const linked = remote("me@fastmail.com", { provider: "imap", imap: imapSettings });
    const plan = planReconcile([], [linked], new Set());
    expect(plan).toEqual({ ...none, add: [linked] });
  });

  it("arrives with its settings, signed out (no password here)", () => {
    const linked = remote("me@fastmail.com", {
      provider: "imap",
      imap: imapSettings,
      name: "Me",
      color: "#0a0",
    });
    expect(accountFromRelay(linked)).toEqual({
      id: "me@fastmail.com",
      email: "me@fastmail.com",
      name: "Me",
      provider: "imap",
      imap: imapSettings,
      signature: undefined,
      picture: undefined,
      displayName: undefined,
      color: "#0a0",
    });
  });

  it("a Gmail account from the relay stays a plain Gmail account", () => {
    const account = accountFromRelay(remote("a@gmail.com"));
    expect(account.provider).toBeUndefined();
    expect(account.imap).toBeUndefined();
  });

  it("links with its settings and no ID token", async () => {
    const idToken = vi.fn(async () => "token");
    const body = await linkRequest(
      {
        id: "me@fastmail.com",
        email: "me@fastmail.com",
        name: "Me",
        provider: "imap",
        imap: imapSettings,
        color: "#0a0",
      },
      idToken,
    );
    expect(body).toEqual({
      provider: "imap",
      imap: imapSettings,
      name: "Me",
      picture: null,
      displayName: null,
      color: "#0a0",
    });
    expect(idToken).not.toHaveBeenCalled();
  });

  it("Gmail still links with an ID token", async () => {
    const body = await linkRequest(
      { id: "a@gmail.com", email: "a@gmail.com", name: "A" },
      async (id) => `token-for-${id}`,
    );
    expect(body).toMatchObject({ idToken: "token-for-a@gmail.com", name: "A" });
    expect(body).not.toHaveProperty("provider");
  });
});
