/**
 * mail-sync.ts
 *
 * Background sync engine that keeps the local SQLite cache (mail-store) in
 * step with each account's mail. What a sync run does is the provider's
 * (providers/: Gmail's full sync and history deltas); this engine decides
 * when runs happen and keeps their status.
 *
 * Two independent lanes per account:
 *  - sync: the provider's run (Gmail: history delta or full sync, labels,
 *    draft ids). Short once the mailbox is synced, so new mail shows up every
 *    tick and the account reads as synced as soon as it finishes.
 *  - downloads: full bodies for offline reading, newest first, at the lowest
 *    priority. It can take a long time on a big mailbox and never holds up
 *    the sync lane or the "Syncing…" status.
 *
 * Syncs run when the mailbox reports a change (Gmail pushes through the
 * relay, realtime.ts), on a timer, and when the user asks. The timer is only
 * a fallback for accounts that get pushes. Sync is fire-and-forget; the
 * renderer polls getSyncStatus() to show progress and refreshes its views
 * when `revision` says the cache changed.
 */

import { logger } from "../logger.js";
import { broadcast } from "../ipc.js";
import { mapPool } from "../pool.js";
import { findProvider, isSignedIn, providerFor, signedOutMessage } from "../providers/index.js";
import { SyncCancelled, type MailProvider } from "../providers/provider.js";
import { getAttachmentData, hasCachedAttachment } from "./attachment-cache.js";
import { listAccounts } from "./account-store.js";
import { platform } from "../platform.js";
import * as store from "./mail-store.js";
import { notifyNewMail, updateDockBadge } from "./notifier.js";
import type { SyncStatus } from "../types.js";

const statuses = new Map<string, SyncStatus>();
const running = new Set<string>();

function ensureStatus(accountId: string): SyncStatus {
  const existing = statuses.get(accountId);
  if (existing) return existing;
  const state = store.getSyncState(accountId);
  const status: SyncStatus = {
    accountId,
    syncing: false,
    phase: "idle",
    synced: 0,
    total: null,
    lastSyncAt: state.lastSyncAt,
    fullSyncDone: state.fullSyncDone,
    error: null,
    download: null,
    revision: 0,
  };
  statuses.set(accountId, status);
  return status;
}

function update(accountId: string, patch: Partial<SyncStatus>): void {
  Object.assign(ensureStatus(accountId), patch);
}

/** The cache changed in a way lists show: the renderer refetches on a new revision. */
function bumpRevision(accountId: string): void {
  const status = ensureStatus(accountId);
  status.revision += 1;
}

export function getSyncStatus(accountId: string): SyncStatus {
  const status = ensureStatus(accountId);
  return { ...status, download: status.download ? { ...status.download } : null };
}

const lastFinishedAt = new Map<string, number>();
// Read-path triggers (list handlers refetching) must not restart a sync right
// after one finished: completion invalidates the renderer's queries, whose
// refetch hits those handlers again — without a cooldown that loops forever.
const READ_TRIGGER_COOLDOWN_MS = 20_000;

// ── Failure backoff ──────────────────────────────────────────────────────
// A failing account (offline, revoked sign-in, Gmail rate limits) is retried
// on a growing delay instead of on every timer tick and list refetch. Asking
// explicitly (Sync button, menu, switching to the account) always runs.

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const failures = new Map<string, { count: number; retryAt: number }>();
/** A sync was requested while one ran: run once more when it ends. */
const rerun = new Set<string>();

function recordFailure(accountId: string): void {
  const count = (failures.get(accountId)?.count ?? 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
  failures.set(accountId, { count, retryAt: Date.now() + delay });
}

// ── Push ─────────────────────────────────────────────────────────────────
// Accounts whose changes are pushed (Gmail's, through the relay; the Otter
// account keeps this current) sync on each push; the timer only checks on
// them every few minutes, in case a push got lost.

const PUSHED_POLL_MS = 5 * 60_000;
let pushedAccounts: ReadonlySet<string> = new Set();

export function setPushedAccounts(accountIds: Iterable<string>): void {
  pushedAccounts = new Set(accountIds);
}

/**
 * Kick off a background sync for one account (no-op if one is already running).
 * `force` skips the post-sync cooldown (launch, timer, push, user); non-forced
 * calls are read-path triggers. `trigger: "timer" | "push"` still respects
 * failure backoff, which only an explicit request (`force` without a trigger)
 * skips. A push or explicit request arriving mid-run runs once more after it.
 */
/**
 * Mailboxes turned off in Settings → Mailboxes (the renderer's synced UI
 * preference `mail:mailboxes`, which names them by address, as account ids
 * do): left unsynced, so they cost no mail traffic and raise no
 * notifications. Turning one back on syncs it at once.
 */
let turnedOff = new Set<string>();

export function followMailboxArrangement(value: string | undefined): void {
  let off: string[] = [];
  try {
    const parsed = (JSON.parse(value ?? "{}") as { off?: unknown }).off;
    if (Array.isArray(parsed)) off = parsed.filter((e): e is string => typeof e === "string");
  } catch {
    // Unreadable: treat every mailbox as on.
  }
  const was = turnedOff;
  turnedOff = new Set(off);
  for (const id of was) if (!turnedOff.has(id)) syncAccount(id, { force: true });
}

export function syncAccount(
  accountId: string,
  opts?: { force?: boolean; trigger?: "timer" | "push" },
): void {
  const explicit = opts?.force === true && opts.trigger === undefined;
  if (running.has(accountId)) {
    if (explicit || opts?.trigger === "push") rerun.add(accountId);
    return;
  }
  // Re-added after removal: the old run has ended (not running), start fresh.
  removed.delete(accountId);
  if (turnedOff.has(accountId)) return;
  // Nothing to sync with until the account signs in again (Settings → Accounts).
  if (!isSignedIn(accountId)) {
    update(accountId, { syncing: false, error: signedOutMessage(accountId) });
    return;
  }
  if (!explicit && Date.now() < (failures.get(accountId)?.retryAt ?? 0)) return;
  if (
    opts?.trigger === "timer" &&
    pushedAccounts.has(accountId) &&
    Date.now() - (lastFinishedAt.get(accountId) ?? 0) < PUSHED_POLL_MS
  ) {
    return;
  }
  if (
    !opts?.force &&
    Date.now() - (lastFinishedAt.get(accountId) ?? 0) < READ_TRIGGER_COOLDOWN_MS
  ) {
    return;
  }
  running.add(accountId);
  // Wake the renderer's idle status polls so even short syncs show up.
  broadcast("gmail:sync-started");
  void runSync(accountId).finally(() => {
    running.delete(accountId);
    lastFinishedAt.set(accountId, Date.now());
    if (rerun.delete(accountId) && !removed.has(accountId)) {
      syncAccount(accountId, { force: true });
    }
  });
}

/** Sync every connected account — launch, menu, and the auto timer force it. */
export async function syncAllAccounts(opts?: {
  force?: boolean;
  trigger?: "timer" | "push";
}): Promise<void> {
  try {
    const accounts = await listAccounts();
    for (const account of accounts) syncAccount(account.id, opts);
  } catch (err) {
    logger.error("mail-sync", `syncAllAccounts failed: ${String(err)}`);
  }
}

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

/** (Re)start the periodic pull-sync timer; 0 disables it. */
export function configureAutoSync(intervalSeconds: number): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (intervalSeconds > 0) {
    autoSyncTimer = setInterval(
      () => void syncAllAccounts({ force: true, trigger: "timer" }),
      intervalSeconds * 1000,
    );
  }
  logger.info(
    "mail-sync",
    `auto-sync ${intervalSeconds > 0 ? `every ${intervalSeconds}s` : "disabled"}`,
  );
}

// ── Account removal ───────────────────────────────────────────────────────
// A sync already in flight for a removed account must not write its mail
// back into the cache: every write point checks `assertActive`, which aborts
// the run with a SyncCancelled.

const removed = new Set<string>();

function assertActive(accountId: string): void {
  if (removed.has(accountId)) throw new SyncCancelled(accountId);
}

/** Stops syncing a removed account and drops its in-memory sync state. */
export function forgetAccount(accountId: string): void {
  removed.add(accountId);
  statuses.delete(accountId);
  lastFinishedAt.delete(accountId);
  failures.delete(accountId);
  rerun.delete(accountId);
}

/** A short, readable reason for the status line. */
function describeSyncError(accountId: string, err: unknown): string {
  const provider = findProvider(accountId);
  if (provider) return provider.describeError(err);
  const text = String(err);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** A sync run is background work: it only spends quota the user isn't using. */
function runSync(accountId: string): Promise<void> {
  const provider = providerFor(accountId);
  return provider.background("sync", () => runSyncNow(accountId, provider));
}

async function runSyncNow(accountId: string, provider: MailProvider): Promise<void> {
  const { lastSyncAt } = store.getSyncState(accountId);
  // Stamped as the run's START: mail arriving while the run is busy is newer
  // than this and still gets notified next time.
  const startedAt = Date.now();
  update(accountId, { syncing: true, error: null, synced: 0, total: null });

  try {
    await provider.sync(accountId, {
      update: (patch) => update(accountId, patch),
      bumpRevision: () => bumpRevision(accountId),
      assertActive: () => assertActive(accountId),
      newMail: (messages) => notifyNewMail(accountId, messages, lastSyncAt),
    });

    assertActive(accountId);
    store.setSyncState(accountId, { lastSyncAt: startedAt });
    failures.delete(accountId);
    update(accountId, {
      syncing: false,
      phase: "idle",
      lastSyncAt: startedAt,
      fullSyncDone: store.getSyncState(accountId).fullSyncDone,
    });
  } catch (err) {
    if (err instanceof SyncCancelled) {
      logger.info("mail-sync", err.message);
      return;
    }
    recordFailure(accountId);
    logger.error("mail-sync", `sync failed for ${accountId}: ${describeSyncError(accountId, err)}`);
    update(accountId, { syncing: false, phase: "idle", error: describeSyncError(accountId, err) });
  }

  updateDockBadge();
  // Offline bodies download in their own lane, after the mailbox is current.
  startDownloads(accountId, provider);
}

const PREFETCH_MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Cache the attachment bytes of every draft (drafts are few and editing one
 * re-uploads its files, so they must be in memory before the composer can
 * save). Other mail keeps fetching attachments lazily — getAttachmentData
 * write-through means anything opened once is cached from then on.
 */
async function prefetchDraftAttachments(accountId: string, provider: MailProvider): Promise<void> {
  for (const id of store.getMessageIdsForLabel(accountId, "DRAFT")) {
    assertActive(accountId);
    try {
      let detail = store.getMessageDetail(accountId, id);
      if (!detail) {
        detail = await provider.getMessage(accountId, id);
        assertActive(accountId);
        store.upsertMessageDetail(accountId, detail);
      }
      for (const att of detail.attachments) {
        if (att.size > PREFETCH_MAX_FILE_BYTES) continue;
        if (await hasCachedAttachment(accountId, id, att.id)) continue;
        await getAttachmentData(accountId, id, att.id);
      }
    } catch (err) {
      if (err instanceof SyncCancelled) throw err;
      logger.info(
        "mail-sync",
        `draft attachment prefetch skipped ${id}: ${describeSyncError(accountId, err)}`,
      );
    }
  }
}

// ── Offline downloads ────────────────────────────────────────────────────
// Full bodies for every message, newest first, so the whole mailbox reads
// offline. Runs as prefetch work (after the user and sync in the quota
// queue), in its own lane: a big backlog takes a while and must not keep the
// account "syncing" or delay new mail. A pass stops when the server pushes
// back (rate limit, offline) and the next sync starts a new one.

const downloading = new Set<string>();
const DOWNLOAD_CHUNK = 60;
const DOWNLOAD_CONCURRENCY = 6;

function startDownloads(accountId: string, provider: MailProvider): void {
  if (downloading.has(accountId) || removed.has(accountId)) return;
  downloading.add(accountId);
  void provider
    .background("prefetch", () => downloadBodies(accountId, provider))
    .catch((err: unknown) => {
      if (err instanceof SyncCancelled) return;
      logger.info(
        "mail-sync",
        `offline download paused for ${accountId}: ${describeSyncError(accountId, err)}`,
      );
    })
    .finally(() => {
      downloading.delete(accountId);
      if (statuses.has(accountId)) update(accountId, { download: null });
    });
}

async function downloadBodies(accountId: string, provider: MailProvider): Promise<void> {
  // A browser's storage is too small (and too easily evicted) for every body.
  const total = platform().offlineDownloads ? store.countUndownloaded(accountId) : 0;
  if (total > 0) {
    let done = 0;
    const attempted = new Set<string>();
    update(accountId, { download: { done, total } });
    for (;;) {
      assertActive(accountId);
      if (provider.isCoolingDown?.(accountId)) break;
      const ids = store
        .getUndownloadedMessageIds(accountId, DOWNLOAD_CHUNK)
        .filter((id) => !attempted.has(id));
      if (ids.length === 0) break;
      let pushedBack = false;
      await mapPool(ids, DOWNLOAD_CONCURRENCY, async (id) => {
        if (pushedBack || removed.has(accountId)) return;
        attempted.add(id);
        try {
          const detail = await provider.getMessage(accountId, id);
          assertActive(accountId);
          store.upsertMessageDetail(accountId, detail);
        } catch (err) {
          if (err instanceof SyncCancelled) throw err;
          const kind = provider.errorKind(err);
          if (kind === "rateLimit" || kind === "network") {
            // Not the message's fault: leave it queued and end this pass.
            attempted.delete(id);
            pushedBack = true;
          } else if (kind === "notFound") {
            // Deleted on the server since it was listed (sync may have dropped it already).
            if (store.deleteMessage(accountId, id)) bumpRevision(accountId);
          } else {
            logger.info(
              "mail-sync",
              `body fetch failed for ${id}: ${describeSyncError(accountId, err)}`,
            );
            store.markBodyFetchFailed(accountId, id);
          }
        }
        done += 1;
        update(accountId, { download: { done: Math.min(done, total), total } });
      });
      if (pushedBack) break;
    }
  }

  // Drafts' attachment bytes must be in memory before the composer can save.
  await prefetchDraftAttachments(accountId, provider);
}
