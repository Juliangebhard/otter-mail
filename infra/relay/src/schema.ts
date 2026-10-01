/**
 * The relay's D1 schema. `pnpm db:generate` turns changes here into a SQL
 * migration in migrations/; deploying applies it.
 *
 * `user`, `session`, `account` and `verification` are better-auth's tables
 * (its core schema, https://www.better-auth.com/docs/concepts/database);
 * the others are the relay's own.
 */

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ImapSettings, MailProviderKind } from "@otter-mail/contracts/mail";
import type { ProjectStatus } from "@otter-mail/contracts/projects";

const createdAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** Otter accounts. */
export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),
  image: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One per signed-in device. */
export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user").on(t.userId)],
);

/** The Google identity an Otter account signs in with. */
export const account = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Mailboxes (Gmail, IMAP) linked to an Otter account, with the profile the app shows. */
export const linkedAccounts = sqliteTable(
  "linked_accounts",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text().notNull(),
    provider: text().$type<MailProviderKind>().notNull().default("gmail"),
    /** JSON, for IMAP mailboxes: where the mailbox lives (never its password). */
    imap: text({ mode: "json" }).$type<ImapSettings>(),
    name: text(),
    picture: text(),
    displayName: text(),
    color: text(),
    linkedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.email] }),
    // Gmail push notifications look accounts up by address.
    index("linked_accounts_email").on(t.email),
  ],
);

/** Each Otter account's preferences (contracts' `Preferences`), synced to its devices. */
export const preferences = sqliteTable("preferences", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** JSON: section name → value. */
  data: text().notNull(),
  /** The Hermes API key, encrypted (only the relay can open it). */
  hermesKey: text(),
  updatedAt: updatedAt(),
});

/** Projects (contracts' projects.ts): their own fields; threads and links are rows of their own. */
export const projects = sqliteTable(
  "projects",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text().notNull(),
    name: text().notNull(),
    status: text().$type<ProjectStatus>().notNull(),
    notes: text().notNull().default(""),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    settledAt: integer({ mode: "timestamp_ms" }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

/** A conversation in a project: a mailbox's thread (never its subject: the relay doesn't see mail). */
export const projectThreads = sqliteTable(
  "project_threads",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    /** The mailbox, lowercased. */
    email: text().notNull(),
    threadId: text().notNull(),
    addedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.email, t.threadId] })],
);

export const projectLinks = sqliteTable(
  "project_links",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text().notNull(),
    id: text().notNull(),
    url: text().notNull(),
    title: text().notNull(),
    addedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId, t.id] })],
);

/** Tokens agents reach the relay's MCP server with (contracts' relay.ts): only their hash. */
export const agentTokens = sqliteTable(
  "agent_tokens",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** SHA-256 of the token, hex. */
    hash: text().notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: integer({ mode: "timestamp_ms" }),
  },
  (t) => [index("agent_tokens_user").on(t.userId)],
);
