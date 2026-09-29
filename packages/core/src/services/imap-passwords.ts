/**
 * IMAP passwords, one per mailbox, in the platform's secrets under
 * `imap-password:<accountId>`. Never synced: each device asks once. Kept in
 * memory too, so "is this mailbox signed in?" answers without waiting.
 */

import { platform } from "../platform.js";
import { listAccounts } from "./account-store.js";

const passwords = new Map<string, string>();

const secretName = (accountId: string) => `imap-password:${accountId}`;

/** Reads every IMAP mailbox's password; call once at startup. */
export async function loadImapPasswords(): Promise<void> {
  passwords.clear();
  for (const account of await listAccounts()) {
    if (account.provider !== "imap") continue;
    const password = await platform()
      .secrets.get(secretName(account.id))
      .catch(() => null);
    if (password) passwords.set(account.id, password);
  }
}

export function getImapPassword(accountId: string): string | null {
  return passwords.get(accountId) ?? null;
}

export function hasImapPassword(accountId: string): boolean {
  return passwords.has(accountId);
}

export async function setImapPassword(accountId: string, password: string): Promise<void> {
  await platform().secrets.set(secretName(accountId), password);
  passwords.set(accountId, password);
}

export async function deleteImapPassword(accountId: string): Promise<void> {
  passwords.delete(accountId);
  await platform().secrets.delete(secretName(accountId));
}
