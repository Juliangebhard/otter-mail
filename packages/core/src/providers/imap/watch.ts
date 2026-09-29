/**
 * Live mail for IMAP: IDLE on INBOX, on a connection of its own. What the
 * server reports (new mail, expunges, flag changes) calls `onChange`, a
 * second's worth at a time; so does every (re)connect, to catch up on what
 * happened meanwhile. IDLE is renewed every 25 minutes (servers drop it
 * after 30); a dropped connection is retried with backoff. Servers without
 * IDLE are left to the sync timer.
 */

import { logger } from "../../logger.js";
import type { IdleSession, ImapClient } from "../../protocols/index.js";
import { openImap } from "./connection.js";

const RENEW_MS = 25 * 60_000;
const DEBOUNCE_MS = 1_000;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export function watchInbox(accountId: string, onChange: () => void): () => void {
  const stopped = new AbortController();
  let client: ImapClient | null = null;
  let session: IdleSession | null = null;
  let wake: (() => void) | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const changed = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!stopped.signal.aborted) onChange();
    }, DEBOUNCE_MS);
  };

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const run = async () => {
    for (let attempt = 0; !stopped.signal.aborted; attempt++) {
      try {
        client = await openImap(accountId);
        if (!client.has("IDLE")) {
          logger.info("imap-watch", `${accountId}'s server can't IDLE; syncing on the timer`);
          await client.logout();
          return;
        }
        await client.select("INBOX");
        attempt = 0;
        changed();
        while (!stopped.signal.aborted) {
          session = await client.idle(changed);
          const renew = setTimeout(() => void session?.stop(), RENEW_MS);
          try {
            await session.done;
          } finally {
            clearTimeout(renew);
          }
        }
      } catch (err) {
        if (stopped.signal.aborted) break;
        const delay = Math.min(RETRY_MIN_MS * 2 ** attempt, RETRY_MAX_MS);
        logger.info(
          "imap-watch",
          `IDLE for ${accountId} dropped (${String(err)}); again in ${delay / 1000}s`,
        );
        client?.close();
        await pause(delay);
      }
    }
    // Stopped while connecting: that connection goes too.
    await client?.logout();
  };
  void run();

  return () => {
    stopped.abort();
    clearTimeout(debounce);
    wake?.();
    const idling = session;
    const open = client;
    void (async () => {
      await idling?.stop();
      await open?.logout();
    })();
  };
}
