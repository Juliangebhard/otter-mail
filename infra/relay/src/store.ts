/**
 * Queries over the relay's own tables, linked_accounts and preferences
 * (schema.ts). Users and sessions belong to better-auth (auth.ts).
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { MailProviderKind } from "@otter-mail/contracts/mail";
import type { Preferences, RelayAccount } from "@otter-mail/contracts/relay";

import * as schema from "./schema.ts";

const { linkedAccounts, preferences } = schema;

export type Db = DrizzleD1Database<typeof schema>;

export const openDb = (d1: D1Database): Db => drizzle(d1, { schema, casing: "snake_case" });

const accountFields = {
  email: linkedAccounts.email,
  provider: linkedAccounts.provider,
  imap: linkedAccounts.imap,
  name: linkedAccounts.name,
  picture: linkedAccounts.picture,
  displayName: linkedAccounts.displayName,
  color: linkedAccounts.color,
};

export function listAccounts(db: Db, userId: string): Promise<RelayAccount[]> {
  return db
    .select(accountFields)
    .from(linkedAccounts)
    .where(eq(linkedAccounts.userId, userId))
    .orderBy(asc(linkedAccounts.linkedAt), asc(linkedAccounts.email));
}

/** The provider the account is linked with, or null when it isn't linked. */
export async function linkedProvider(
  db: Db,
  userId: string,
  email: string,
): Promise<MailProviderKind | null> {
  const [row] = await db
    .select({ provider: linkedAccounts.provider })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.email, email)));
  return row?.provider ?? null;
}

/** Fields to write (profile, provider, IMAP settings): a field left out keeps its value, `null` clears it. */
export type AccountPatch = Partial<Omit<RelayAccount, "email">>;

/** Links the account, or updates the fields present in `patch` if it's linked already. */
export async function putAccount(
  db: Db,
  userId: string,
  email: string,
  patch: AccountPatch,
): Promise<void> {
  const insert = db
    .insert(linkedAccounts)
    .values({ userId, email, ...patch, linkedAt: new Date() });
  await (Object.keys(patch).length > 0
    ? insert.onConflictDoUpdate({
        target: [linkedAccounts.userId, linkedAccounts.email],
        set: patch,
      })
    : insert.onConflictDoNothing());
}

/** Unlinks the account; false when it wasn't linked. */
export async function deleteAccount(db: Db, userId: string, email: string): Promise<boolean> {
  const removed = await db
    .delete(linkedAccounts)
    .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.email, email)))
    .returning({ email: linkedAccounts.email });
  return removed.length > 0;
}

/**
 * Everyone who linked this address as a Gmail account (normally one Otter
 * account). An IMAP mailbox at a Gmail address doesn't count: linking it
 * proved nothing.
 */
export async function usersWithGmail(db: Db, email: string): Promise<string[]> {
  const rows = await db
    .select({ userId: linkedAccounts.userId })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.email, email), eq(linkedAccounts.provider, "gmail")));
  return rows.map((row) => row.userId);
}

/** The account's preferences, and its Hermes key as stored (sealed). */
export async function getPreferences(
  db: Db,
  userId: string,
): Promise<{ data: Preferences; hermesKey: string | null }> {
  const row = await db.query.preferences.findFirst({ where: eq(preferences.userId, userId) });
  return {
    data: row ? (JSON.parse(row.data) as Preferences) : {},
    hermesKey: row?.hermesKey ?? null,
  };
}

/**
 * Replaces the given sections (the others stay) and, when given, the sealed
 * Hermes key, in one statement: devices writing at once can't lose each
 * other's sections. False (nothing written) when the result would exceed
 * `maxBytes`.
 */
export async function putPreferences(
  db: Db,
  userId: string,
  change: { sections: Preferences; hermesKey?: string | null },
  maxBytes: number,
): Promise<boolean> {
  const fresh = JSON.stringify(change.sections);
  if (fresh.length > maxBytes) return false;
  const merged = Object.entries(change.sections).reduce(
    (data, [name, value]) =>
      sql`json_set(${data}, ${`$."${name}"`}, json(${JSON.stringify(value)}))`,
    sql`${preferences.data}`,
  );
  const hermesKey = change.hermesKey === undefined ? {} : { hermesKey: change.hermesKey };
  const result = await db
    .insert(preferences)
    .values({ userId, data: fresh, ...hermesKey })
    .onConflictDoUpdate({
      target: preferences.userId,
      set: { data: merged, ...hermesKey, updatedAt: new Date() },
      setWhere: sql`length(${merged}) <= ${maxBytes}`,
    })
    .run();
  return result.meta.changes > 0;
}
