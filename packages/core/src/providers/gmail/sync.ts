/**
 * Gmail's part of a sync run (the engine around it is services/mail-sync.ts).
 * The first run does a full-mailbox metadata sync; later runs replay Gmail's
 * history feed for cheap incremental deltas. Labels and draft ids are kept
 * current alongside.
 */

import { logger } from "../../logger.js";
import * as store from "../../services/mail-store.js";
import type { GmailMessageSummary } from "../../types.js";
import { SyncCancelled, type SyncContext } from "../provider.js";
import {
  describeError,
  fetchMetadataForIds,
  getProfile,
  isHistoryExpiredError,
  listDraftIds,
  listHistory,
  listLabelNames,
  listLabels,
  listMessageIdsPage,
} from "./api.js";

export async function syncGmail(accountId: string, ctx: SyncContext): Promise<void> {
  const state = store.getSyncState(accountId);
  const incremental = state.fullSyncDone && state.historyId !== null;
  ctx.update({ phase: incremental ? "incremental" : "labels" });

  let mailChanged = true;
  if (incremental && state.historyId) {
    const delta = await incrementalSync(accountId, state.historyId, ctx);
    mailChanged = delta.changed;
    if (await refreshLabels(accountId, mailChanged, ctx)) ctx.bumpRevision();
    await ctx.newMail(delta.added);
    // Accounts fully synced before spam/trash were included need a one-time
    // backfill; new accounts get them in the full sync itself.
    if (store.getKv(`spamTrashBackfilled:${accountId}`) !== "1") {
      await backfillSpamTrash(accountId, ctx);
    }
  } else {
    // Labels first — the sidebar and message chips depend on them.
    if (await refreshLabels(accountId, true, ctx)) ctx.bumpRevision();
    await fullSync(accountId, ctx);
  }

  // Local-first drafts: know every draft's id, so opening one needs no
  // Gmail round trip.
  await learnDraftIds(accountId, mailChanged, ctx);
}

/** Drops a removed account's in-memory sync state. */
export function forgetGmailSync(accountId: string): void {
  labelRefresh.delete(accountId);
  draftCheckAt.delete(accountId);
}

// ── Labels ───────────────────────────────────────────────────────────────
// labels.get per label (names, colors, Gmail's counts) is ~30 requests per
// account — too much for every 30s tick. Each tick does one labels.list to
// catch labels created/renamed/deleted elsewhere; the per-label detail is
// re-read when mail changed (at most once a minute) and every 10 minutes.
// Between detail reads, applyHistoryChanges keeps counts current locally.

const LABEL_DETAIL_MIN_GAP_MS = 60_000;
const LABEL_DETAIL_MAX_AGE_MS = 10 * 60_000;
const labelRefresh = new Map<string, { refreshedAt: number; dirty: boolean }>();

/** Refreshes the cached labels when due. Returns whether they were rewritten. */
async function refreshLabels(
  accountId: string,
  mailChanged: boolean,
  ctx: SyncContext,
): Promise<boolean> {
  let state = labelRefresh.get(accountId);
  if (!state) {
    state = { refreshedAt: 0, dirty: true };
    labelRefresh.set(accountId, state);
  }
  if (mailChanged) state.dirty = true;
  const age = Date.now() - state.refreshedAt;
  let due = age > LABEL_DETAIL_MAX_AGE_MS || (state.dirty && age > LABEL_DETAIL_MIN_GAP_MS);
  if (!due) {
    const names = await listLabelNames(accountId);
    const cached = new Map(store.getLabels(accountId).map((l) => [l.id, l.name]));
    due = names.length !== cached.size || names.some((l) => cached.get(l.id) !== l.name);
  }
  if (!due) return false;
  const labels = await listLabels(accountId);
  ctx.assertActive();
  store.upsertLabels(accountId, labels);
  state.refreshedAt = Date.now();
  state.dirty = false;
  return true;
}

const META_CHUNK = 100;

/**
 * Whole-mailbox sync, newest first. Resumable: the Gmail page cursor and the
 * starting history id are kept in kv after every page, so a failure (rate
 * limits, sleep, quit) continues where it stopped instead of starting over.
 * Metadata is written every 100 messages so lists fill in steadily.
 *
 * First sync skips ids already cached. Refresh mode (after the history feed
 * expired) re-reads every message, and — when one run listed the whole
 * mailbox — deletes cached mail Gmail no longer has.
 */
async function fullSync(accountId: string, ctx: SyncContext): Promise<void> {
  const cursorKey = `fullSyncCursor:${accountId}`;
  const seedKey = `fullSyncSeed:${accountId}`;
  const refreshKey = `fullSyncRefresh:${accountId}`;
  const refresh = store.getKv(refreshKey) === "1";

  // The history cursor from BEFORE the first attempt, so the incremental pass
  // afterwards replays everything that changed while the full sync ran.
  let seedHistoryId = store.getKv(seedKey) || null;
  let total: number | null = null;
  try {
    const profile = await getProfile(accountId);
    total = profile.messagesTotal || null;
    if (!seedHistoryId) {
      seedHistoryId = profile.historyId || null;
      if (seedHistoryId) store.setKv(seedKey, seedHistoryId);
    }
  } catch {
    // keep going without a total; the seed is retried next run
  }

  let pageToken = store.getKv(cursorKey) || undefined;
  // Pruning is only safe when this run saw every id from page one.
  let listedFromStart = !pageToken;
  const seen = new Set<string>();
  let synced = store.countAllMessages(accountId);
  ctx.update({ phase: "full", synced, total });
  if (pageToken) logger.info("mail-sync", `full sync resuming for ${accountId} at ${synced}`);

  for (;;) {
    let page: Awaited<ReturnType<typeof listMessageIdsPage>>;
    try {
      page = await listMessageIdsPage(accountId, { pageToken, maxResults: 500 });
    } catch (err) {
      // A stale saved cursor: start the listing over (cached ids are skipped).
      if (pageToken && err instanceof Error && err.message.includes("Gmail API error: 400")) {
        store.setKv(cursorKey, "");
        pageToken = undefined;
        listedFromStart = true;
        seen.clear();
        continue;
      }
      throw err;
    }

    if (total === null && page.resultSizeEstimate) ctx.update({ total: page.resultSizeEstimate });

    for (const id of page.ids) seen.add(id);
    const fresh = refresh ? page.ids : store.filterUnknownIds(accountId, page.ids);
    for (let i = 0; i < fresh.length; i += META_CHUNK) {
      const summaries = await fetchMetadataForIds(accountId, fresh.slice(i, i + META_CHUNK));
      ctx.assertActive();
      store.upsertMessages(accountId, summaries);
      synced += summaries.length;
      ctx.update({ synced });
      ctx.bumpRevision();
    }

    pageToken = page.nextPageToken;
    store.setKv(cursorKey, pageToken ?? "");
    if (!pageToken) break;
  }

  if (refresh && listedFromStart) {
    ctx.assertActive();
    const gone = store.pruneMessagesNotIn(accountId, seen);
    if (gone > 0) {
      logger.info("mail-sync", `removed ${gone} messages deleted in Gmail`);
      ctx.bumpRevision();
    }
  }

  ctx.assertActive();
  store.setSyncState(accountId, { fullSyncDone: true, historyId: seedHistoryId });
  store.setKv(seedKey, "");
  store.setKv(refreshKey, "");
  store.setKv(`spamTrashBackfilled:${accountId}`, "1");
}

/** Draft ids are re-checked when mail changed, else at most this often. */
const DRAFT_CHECK_MAX_AGE_MS = 10 * 60_000;
const draftCheckAt = new Map<string, number>();

/**
 * One cheap drafts.list: records each cached draft's id (opening a draft then
 * needs no Gmail lookup) and removes stale local draft rows — every draft
 * edit mints a new message id, so older copies (and drafts sent or deleted
 * elsewhere) would otherwise linger in Drafts and its count. Runs when the
 * history feed reported changes (drafts show up there) or every 10 minutes.
 */
async function learnDraftIds(
  accountId: string,
  mailChanged: boolean,
  ctx: SyncContext,
): Promise<void> {
  if (!mailChanged && Date.now() - (draftCheckAt.get(accountId) ?? 0) < DRAFT_CHECK_MAX_AGE_MS) {
    return;
  }
  const local = store.getMessageIdsForLabel(accountId, "DRAFT");
  if (local.length === 0) return;
  try {
    const listedAt = Date.now();
    const drafts = await listDraftIds(accountId);
    ctx.assertActive();
    draftCheckAt.set(accountId, listedAt);
    for (const d of drafts) store.setDraftId(accountId, d.messageId, d.draftId);
    // Only prune against a complete list (listDraftIds stops at 500).
    if (drafts.length < 500) {
      // Rows saved around the listing (a composer autosaving right now) may be
      // newer than it — leave anything from the last minute alone.
      const current = new Set(drafts.map((d) => d.messageId));
      const stale = store
        .getMessageDates(accountId, local)
        .filter((m) => !current.has(m.id) && m.date < listedAt - 60_000)
        .map((m) => m.id);
      for (const id of stale) store.deleteMessage(accountId, id);
      if (stale.length > 0) {
        logger.info("mail-sync", `removed ${stale.length} stale draft rows`);
        ctx.bumpRevision();
      }
    }
  } catch (err) {
    if (err instanceof SyncCancelled) throw err;
    logger.info("mail-sync", `draft id refresh skipped: ${describeError(err)}`);
  }
}

async function backfillSpamTrash(accountId: string, ctx: SyncContext): Promise<void> {
  for (const labelId of ["SPAM", "TRASH"]) {
    let pageToken: string | undefined;
    do {
      const page = await listMessageIdsPage(accountId, { pageToken, labelIds: [labelId] });
      if (page.ids.length > 0) {
        const summaries = await fetchMetadataForIds(accountId, page.ids);
        ctx.assertActive();
        store.upsertMessages(accountId, summaries);
        ctx.bumpRevision();
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  store.setKv(`spamTrashBackfilled:${accountId}`, "1");
  logger.info("mail-sync", `spam/trash backfill done for ${accountId}`);
}

/**
 * Replays the history feed since `startHistoryId`. All pages are read before
 * anything is written, so a failure mid-feed leaves the cursor and cache
 * untouched and the next run replays the same delta. Returns the summaries of
 * newly added messages and whether anything changed.
 */
async function incrementalSync(
  accountId: string,
  startHistoryId: string,
  ctx: SyncContext,
): Promise<{ added: GmailMessageSummary[]; changed: boolean }> {
  ctx.update({ phase: "incremental", synced: 0 });

  const addedIds = new Set<string>();
  const ops: store.HistoryOp[] = [];
  let latestHistoryId = startHistoryId;
  let pageToken: string | undefined;

  try {
    do {
      const page = await listHistory(accountId, startHistoryId, pageToken);
      if (page.historyId) latestHistoryId = page.historyId;

      for (const entry of page.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          addedIds.add(added.message.id);
        }
        for (const deleted of entry.messagesDeleted ?? []) {
          ops.push({ kind: "deleted", id: deleted.message.id });
          addedIds.delete(deleted.message.id);
        }
        for (const change of entry.labelsAdded ?? []) {
          ops.push({ kind: "labelsAdded", id: change.message.id, labelIds: change.labelIds });
        }
        for (const change of entry.labelsRemoved ?? []) {
          ops.push({ kind: "labelsRemoved", id: change.message.id, labelIds: change.labelIds });
        }
      }

      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    // Gmail purges history older than ~1 week; fall back to a full resync.
    if (isHistoryExpiredError(err)) {
      // Changes made while we were away can't be replayed: re-read the whole
      // mailbox (labels/read state of cached mail too) and drop deleted mail.
      // Marked durable so a long refresh resumes across runs.
      logger.info("mail-sync", `history expired for ${accountId}; refreshing the mailbox`);
      store.setKv(`fullSyncRefresh:${accountId}`, "1");
      store.setKv(`fullSyncCursor:${accountId}`, "");
      store.setKv(`fullSyncSeed:${accountId}`, "");
      ctx.assertActive();
      store.setSyncState(accountId, { fullSyncDone: false });
      await fullSync(accountId, ctx);
      return { added: [], changed: true };
    }
    throw err;
  }

  ctx.assertActive();
  const { unknownIds } = store.applyHistoryChanges(accountId, ops);

  // New mail, plus mail the feed changed that the cache never got (an
  // earlier run missed it): both are fetched and stored with current labels.
  const ids = [...new Set([...addedIds, ...unknownIds])];
  let added: GmailMessageSummary[] = [];
  if (ids.length > 0) {
    const summaries = await fetchMetadataForIds(accountId, ids);
    ctx.assertActive();
    store.upsertMessages(accountId, summaries);
    store.recountLabels(
      accountId,
      summaries.flatMap((m) => m.labelIds),
    );
    added = summaries.filter((m) => addedIds.has(m.id));
    ctx.update({ synced: summaries.length });
  }

  const changed = ops.length > 0 || ids.length > 0;
  if (changed) ctx.bumpRevision();
  store.setSyncState(accountId, { historyId: latestHistoryId });
  return { added, changed };
}
