/**
 * Gmail sync's lanes, end to end inside core: startCore on a Node platform
 * (the Mac's: bodies kept for offline reading) against a pretend Gmail with a
 * history feed. What it locks in: new mail keeps coming while the first sync
 * fills a mailbox (the fill runs as a backfill beside the sync lane), each
 * message is fetched once (whole), a finished fill is corrected by replaying
 * the feed from where it began, and an expired feed is caught up from Gmail's
 * listings instead of re-reading every message.
 */

import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Platform, SqlDatabase } from "../../platform.ts";
import type { GmailAccount } from "../../types.ts";

const GMAIL = "gmail.googleapis.com";
const account: GmailAccount = { id: "me@gmail.test", email: "me@gmail.test", name: "Me" };

// ── The pretend Gmail ───────────────────────────────────────────────────────

type Mail = { id: string; threadId: string; labelIds: string[]; date: number; subject: string };
type Ref = { message: { id: string; threadId: string; labelIds: string[] } };
type HistoryEntry = {
  id: string;
  messagesAdded?: Ref[];
  messagesDeleted?: Ref[];
  labelsAdded?: (Ref & { labelIds: string[] })[];
  labelsRemoved?: (Ref & { labelIds: string[] })[];
};

const LABELS = ["INBOX", "UNREAD", "STARRED", "SENT", "SPAM", "TRASH", "DRAFT"];

let mail: Map<string, Mail>;
let historyId: number;
let history: HistoryEntry[];
/** History older than this is gone (Gmail keeps about a week). */
let historyFloor: number;
/** Message fetches, by id and format. */
let fetches: { id: string; format: string }[];
/** Listings of the whole mailbox (no label), by the page asked for. */
let listings: (string | null)[];
/** Gmail answers pages of at most this many ids. */
let pageSize: number;
/** Messages whose next fetch Gmail refuses (once). */
let refuse: Set<string>;
/** While set, the first fetch of each of `ids` answers as of the request, but only once `until` resolves. */
let hold: { ids: string[]; until: Promise<void> } | null;
const held = new Set<string>();

const ref = (m: Mail): Ref => ({
  message: { id: m.id, threadId: m.threadId, labelIds: [...m.labelIds] },
});

function deliver(id: string, labelIds: string[], date = Date.now()): Mail {
  const m: Mail = { id, threadId: id, labelIds, date, subject: `Subject ${id}` };
  mail.set(id, m);
  history.push({ id: String(++historyId), messagesAdded: [ref(m)] });
  return m;
}

function relabel(id: string, add: string[], remove: string[]): void {
  const m = mail.get(id)!;
  m.labelIds = [...m.labelIds.filter((l) => !remove.includes(l)), ...add];
  history.push({
    id: String(++historyId),
    ...(add.length ? { labelsAdded: [{ ...ref(m), labelIds: add }] } : {}),
    ...(remove.length ? { labelsRemoved: [{ ...ref(m), labelIds: remove }] } : {}),
  });
}

function remove(id: string): void {
  const m = mail.get(id)!;
  mail.delete(id);
  history.push({ id: String(++historyId), messagesDeleted: [ref(m)] });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const base64url = (text: string) => Buffer.from(text).toString("base64url");

async function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.host !== GMAIL) return json({ error: "not in this test" }, 404);
  const path = url.pathname.replace("/gmail/v1/users/me", "");

  if (path === "/profile") {
    return json({ historyId: String(historyId), messagesTotal: mail.size });
  }
  if (path === "/history") {
    const start = Number(url.searchParams.get("startHistoryId"));
    if (start < historyFloor)
      return json({ error: { message: "Requested entity was not found." } }, 404);
    return json({
      history: history.filter((h) => Number(h.id) > start),
      historyId: String(historyId),
    });
  }
  if (path === "/messages") {
    const labelIds = url.searchParams.getAll("labelIds");
    if (labelIds.length === 0) listings.push(url.searchParams.get("pageToken"));
    const all = [...mail.values()]
      .filter((m) => labelIds.every((l) => m.labelIds.includes(l)))
      .sort((a, b) => b.date - a.date);
    const size = Math.min(pageSize, Number(url.searchParams.get("maxResults") ?? 100));
    const offset = Number(url.searchParams.get("pageToken") ?? 0);
    const page = all.slice(offset, offset + size);
    return json({
      messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
      nextPageToken: offset + size < all.length ? String(offset + size) : undefined,
      resultSizeEstimate: all.length,
    });
  }
  const message = path.match(/^\/messages\/([^/]+)$/);
  if (message) {
    const id = message[1]!;
    const format = url.searchParams.get("format") ?? "full";
    fetches.push({ id, format });
    if (refuse.delete(id)) return json({ error: { message: "Not now." } }, 403);
    const m = mail.get(id);
    if (!m) return json({ error: { message: "Not Found" } }, 404);
    // Answered as the message is now, delivered later.
    const headers = [
      { name: "From", value: "Sender <sender@example.test>" },
      { name: "Subject", value: m.subject },
    ];
    const body = {
      id: m.id,
      threadId: m.threadId,
      labelIds: [...m.labelIds],
      internalDate: String(m.date),
      snippet: m.subject,
      payload:
        format === "full"
          ? { mimeType: "text/plain", headers, body: { data: base64url(`Body of ${m.id}`) } }
          : { headers },
    };
    if (hold?.ids.includes(id) && !held.has(id)) {
      held.add(id);
      await hold.until;
    }
    return json(body);
  }
  if (path === "/labels") {
    return json({ labels: LABELS.map((id) => ({ id, name: id, type: "system" })) });
  }
  const label = path.match(/^\/labels\/([^/]+)$/);
  if (label) return json({ id: label[1], messagesTotal: 0, messagesUnread: 0 });
  if (path === "/drafts") return json({ drafts: [] });
  if (path === "/settings/sendAs") return json({ sendAs: [] });
  return json({ error: { message: "not in this test" } }, 404);
}

// ── Core on Node ────────────────────────────────────────────────────────────

let notified: string[];

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * Starts core fresh, signed in to the Gmail account, with `seed` run on the
 * cache first (what an earlier run left there).
 */
async function boot(seed?: (store: typeof import("../mail-store.ts")) => void) {
  vi.resetModules();
  const { setPlatform } = await import("../../platform.ts");
  const { startCore } = await import("../../index.ts");
  const mailSync = await import("../mail-sync.ts");
  const mailStore = await import("../mail-store.ts");

  const files = new Map<string, Uint8Array>([
    ["accounts.json", new TextEncoder().encode(JSON.stringify([account]))],
  ]);
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  const unused = () => {
    throw new Error("Not in this test.");
  };
  const platform: Platform = {
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    database: () => database,
    files: {
      read: async (path) => files.get(path) ?? null,
      write: async (path, data) => {
        files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
      },
      remove: async (path) => {
        files.delete(path);
      },
      list: async () => [],
    },
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    userFiles: { open: unused, save: unused, pick: unused },
    google: {
      load: async () => {},
      addAccount: unused,
      cancelSignIn: () => {},
      isSignedIn: (accountId) => accountId === account.id,
      getAccessToken: async () => "token",
      getIdToken: unused,
      removeTokens: async () => {},
    },
    connect: unused,
    relayUrl: "http://relay.test",
    relaySession: "bearer",
    broadcast: () => {},
    notify: ({ body }) => notified.push(body ?? ""),
    setUnreadCount: () => {},
    onResume: () => () => {},
    asyncContext: () => {
      let current: unknown;
      return {
        run: (value, fn) => {
          const before = current;
          current = value;
          try {
            return fn();
          } finally {
            current = before;
          }
        },
        get: () => current as never,
      };
    },
    offlineDownloads: true,
  };

  setPlatform(platform);
  seed?.(mailStore);
  await startCore(platform);
  mailSync.configureAutoSync(0);
  const status = () => mailSync.getSyncStatus(account.id);
  const labelsOf = (id: string) => mailStore.getAllMessageLabels(account.id).get(id);
  return { mailSync, mailStore, status, labelsOf };
}

beforeEach(() => {
  mail = new Map();
  historyId = 100;
  history = [];
  historyFloor = 0;
  fetches = [];
  listings = [];
  pageSize = 500;
  refuse = new Set();
  hold = null;
  held.clear();
  notified = [];
  vi.stubGlobal("fetch", fakeFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Gmail sync", () => {
  it("brings new mail while the first sync is still filling the mailbox", async () => {
    for (let i = 1; i <= 8; i++) deliver(`old${i}`, ["INBOX"], Date.now() - i * 60_000);
    let release!: () => void;
    hold = { ids: [...mail.keys()], until: new Promise((resolve) => (release = resolve)) };

    const { mailSync, mailStore, status } = await boot();
    await until(() => fetches.length > 0, "the fill to start");
    expect(status()).toMatchObject({ syncing: true, phase: "full", fullSyncDone: false });

    // Mail arrives mid-fill, a few times; each push syncs it in at once, and
    // the fill carries on where it is: not listed again, its progress kept.
    const progress = status().total;
    for (const id of ["new1", "new2", "new3"]) {
      deliver(id, ["INBOX", "UNREAD"]);
      mailSync.syncAccount(account.id, { force: true, trigger: "push" });
      await until(() => mailStore.getMessageDetail(account.id, id) !== null, `mail ${id}`);
      expect(status()).toMatchObject({ syncing: true, phase: "full", total: progress });
    }
    expect(notified).toEqual(["Subject new1", "Subject new2", "Subject new3"]);

    release();
    await until(() => status().fullSyncDone && !status().syncing, "the fill to finish");
    await until(() => status().download === null, "the downloads to finish");
    expect(listings).toEqual([null]);
    expect(mailStore.countAllMessages(account.id)).toBe(11);
    // Every message fetched once, whole: no metadata pass, no body pass after it.
    expect(fetches.every((f) => f.format === "full")).toBe(true);
    expect(new Set(fetches.map((f) => f.id)).size).toBe(fetches.length);
    expect(mailStore.getMessageDetail(account.id, "old8")?.bodyText).toBe("Body of old8");
  });

  it("picks a stopped first sync up where it was when new mail comes in, not from the start", async () => {
    for (let i = 1; i <= 7; i++) deliver(`old${i}`, ["INBOX"], Date.now() - i * 60_000);
    pageSize = 3;
    // The second page fails: the fill stops there, the first page kept.
    refuse.add("old5");

    const { mailSync, mailStore, status } = await boot();
    await until(() => status().error !== null && !status().syncing, "the fill to stop");
    expect(listings).toEqual([null, "3"]);
    expect(mailStore.countAllMessages(account.id)).toBe(3);

    // New mail comes in: synced at once, while the fill waits out its retry delay.
    deliver("new", ["INBOX", "UNREAD"]);
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    await until(() => mailStore.getMessageDetail(account.id, "new") !== null, "the new mail");
    expect(listings).toEqual([null, "3"]);

    // Later mail finds the delay over: the fill goes on from the second page.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 });
    deliver("later", ["INBOX", "UNREAD"]);
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    await until(() => status().fullSyncDone && !status().syncing, "the fill to finish");
    expect(listings).toEqual([null, "3", "3", "6"]);
    expect(mailStore.countAllMessages(account.id)).toBe(9);
    // The first page was never fetched again.
    expect(fetches.filter((f) => f.id === "old1")).toHaveLength(1);
  });

  it("replays what changed during the first sync over what it wrote", async () => {
    deliver("a", ["INBOX", "UNREAD"], Date.now() - 60_000);
    deliver("b", ["INBOX"], Date.now() - 120_000);
    deliver("c", ["INBOX"], Date.now() - 180_000);
    let release!: () => void;
    hold = { ids: ["a", "b", "c"], until: new Promise((resolve) => (release = resolve)) };

    const { mailSync, mailStore, status, labelsOf } = await boot();
    // The fill has all three in flight, as they were.
    await until(() => held.size === 3, "the fill's fetches");

    // Changed in Gmail meanwhile, and synced in: the feed moves past it.
    relabel("a", [], ["UNREAD"]);
    remove("b");
    relabel("c", ["STARRED"], []);
    mailSync.syncAccount(account.id, { force: true, trigger: "push" });
    await until(
      () => mailStore.getSyncState(account.id).historyId === String(historyId),
      "the push",
    );

    // Then the fill's older copies land.
    release();
    await until(() => status().fullSyncDone && !status().syncing, "the fill and its replay");
    await until(() => labelsOf("b") === undefined, "the replay");
    expect(labelsOf("a")).toEqual(["INBOX"]);
    expect(labelsOf("c")?.sort()).toEqual(["INBOX", "STARRED"]);
    expect(mailStore.countAllMessages(account.id)).toBe(2);
  });

  it("catches up an expired history feed from Gmail's listings, fetching only what's missing", async () => {
    const earlier = Date.now() - 3_600_000;
    const cached = [
      { id: "read", labelIds: ["INBOX", "UNREAD"] },
      { id: "archived", labelIds: ["INBOX"] },
      { id: "deleted", labelIds: ["INBOX"] },
    ];
    // In Gmail now: one read, one archived and starred, one deleted, one new.
    deliver("read", ["INBOX"], earlier);
    deliver("archived", ["STARRED"], earlier - 1);
    deliver("fresh", ["INBOX", "UNREAD"]);
    historyFloor = historyId;

    const { mailStore, status, labelsOf } = await boot((store) => {
      store.upsertMessageDetails(
        account.id,
        cached.map((m, i) => ({
          id: m.id,
          threadId: m.id,
          fromName: "Sender",
          fromEmail: "sender@example.test",
          to: "",
          subject: `Subject ${m.id}`,
          snippet: "",
          date: earlier - i,
          unread: m.labelIds.includes("UNREAD"),
          starred: false,
          labelIds: m.labelIds,
          hasAttachments: false,
          bodyHtml: null,
          bodyText: `Body of ${m.id}`,
          attachments: [],
        })),
      );
      store.setSyncState(account.id, { fullSyncDone: true, historyId: "50" });
      store.setKv(`spamTrashBackfilled:${account.id}`, "1");
    });

    await until(() => labelsOf("fresh") !== undefined, "the missing mail");
    await until(() => !status().syncing, "the refresh to finish");
    expect(labelsOf("read")).toEqual(["INBOX"]);
    expect(labelsOf("archived")).toEqual(["STARRED"]);
    expect(labelsOf("deleted")).toBeUndefined();
    expect(mailStore.getMessageDetail(account.id, "read")?.unread).toBe(false);
    // Only the message the cache lacked was read; the rest came from listings.
    expect(fetches.map((f) => f.id)).toEqual(["fresh"]);
    // The feed runs from now on.
    expect(mailStore.getSyncState(account.id).historyId).toBe(String(historyId));
  });
});
