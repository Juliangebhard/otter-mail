/**
 * The Otter Mail relay's HTTP API (infra/relay), shared by the Worker and the
 * apps. The relay knows who an Otter account is, which mailboxes it has
 * linked (Gmail, IMAP), the account's preferences, and when Gmail says one of
 * them changed. It never sees mail or keeps Gmail tokens or IMAP passwords.
 *
 * Otter accounts are better-auth's, under `/v1/auth` (the app uses
 * better-auth's client): `sign-in/social` with `{ provider: "google",
 * idToken: { token } }` answers with the session token in the
 * `set-auth-token` header; `sign-out`, `list-sessions`, `revoke-session` and
 * `delete-user` manage devices and the account.
 *
 * The routes below take `Authorization: Bearer <session token>` and answer
 * errors as `{ error: string }`.
 */

/** The person signed in to Otter Mail (they sign in with Google). */
export interface RelayUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

import type { ImapSettings, MailProviderKind } from "./mail.js";

/** A mailbox linked to an Otter account, with the profile shown in the app. */
export interface RelayAccount {
  email: string;
  provider: MailProviderKind;
  /** Where an IMAP mailbox lives (null for Gmail). Its password stays on each device. */
  imap: ImapSettings | null;
  name: string | null;
  picture: string | null;
  /** User-set overrides, as edited in Settings › Accounts. */
  displayName: string | null;
  color: string | null;
}

/**
 * The web app's Gmail sign-in popup (`/v1/gmail/authorize`) posts
 * `{ type: "otter:gmail-sign-in", result }` or `{ …, error }` to the app;
 * this error means the user said no on Google's consent screen.
 */
export const GMAIL_SIGN_IN_CANCELLED = "sign-in-cancelled";

/** `GET /v1/me` */
export interface MeResponse {
  user: RelayUser;
  /** The Pub/Sub topic to pass to Gmail's `users.watch`. */
  pushTopic: string;
}

/** `GET /v1/accounts` */
export interface ListAccountsResponse {
  accounts: RelayAccount[];
}

/**
 * `PUT /v1/accounts/:email`: link a mailbox or update its profile.
 * Linking a Gmail account needs `idToken`, a Google ID token for that address
 * proving the caller signed in to it; updating an already linked account
 * doesn't. Linking an IMAP mailbox needs `provider: "imap"` and `imap`; the
 * relay can't check the sign-in, which is fine: it sends nothing for IMAP
 * mailboxes but their settings back to the same Otter account (Gmail pushes
 * only go to Gmail links).
 *
 * Updates may leave `provider` out; given, it must be the link's (409
 * otherwise: switching a mailbox between Gmail and IMAP means unlinking it
 * first). An IMAP link's update may replace `imap`; `imap` on a Gmail
 * account is a 400.
 */
export interface PutAccountRequest {
  idToken?: string;
  /** Absent means Gmail. */
  provider?: MailProviderKind;
  imap?: ImapSettings;
  name?: string | null;
  picture?: string | null;
  displayName?: string | null;
  color?: string | null;
}

/**
 * The account's preferences, which follow it to every device: sections of
 * JSON (`settings`, `views`, `keybindings`, `assistant`, `ui`), each replaced
 * whole when a device changes it, plus the Hermes API key, kept encrypted.
 */
export type Preferences = Record<string, unknown>;

/** `GET /v1/preferences` */
export interface PreferencesResponse {
  preferences: Preferences;
  hermesKey: string | null;
}

/**
 * `PUT /v1/preferences`: replaces the sections given (the others stay), and
 * sets or clears the Hermes key when `hermesKey` is present.
 */
export interface PutPreferencesRequest {
  preferences?: Preferences;
  hermesKey?: string | null;
}

/**
 * `GET /v1/tunnel?host=…&port=…`: a TCP connection for the web app, which
 * can't open one itself (the Mac and iPhone apps connect directly). A
 * WebSocket upgrade, with the session like `/v1/events` (the cookie, or the
 * bearer token); from a browser, only the web app's origin may open it.
 *
 * - `port` is 143, 993, 465 or 587; `host` a DNS name or a public IPv4
 *   address (no IPv6 literals, private ranges or localhost). Otherwise 400,
 *   before the upgrade (401 without a session).
 * - The relay accepts the WebSocket at once, then connects. When the TCP
 *   connection is up it sends one text frame, `open`; nothing comes before it.
 *   If it can't connect, it closes with `TUNNEL_CLOSE.connectFailed` instead
 *   (the reason says why, e.g. a DNS failure or a refused connection).
 * - After `open`: binary frames only, both ways, each carrying raw bytes of
 *   the TCP stream (no header, no framing; frame boundaries mean nothing).
 *   Send after `open`. A text frame from the client closes the tunnel (1003).
 * - The relay opens the socket without TLS: the client does TLS itself inside
 *   the tunnel (from the first byte on 993/465, after STARTTLS on 143/587), so
 *   the relay carries ciphertext.
 * - Either side closing closes both: the server closing its end is a 1000
 *   close; the client closing the WebSocket closes the TCP connection. A
 *   connection that fails midway closes with `TUNNEL_CLOSE.lost`, one with no
 *   bytes either way for 30 minutes with `TUNNEL_CLOSE.idle` (re-IDLE sooner).
 */
export const TUNNEL_CLOSE = {
  /** Couldn't open the TCP connection. */
  connectFailed: 4502,
  /** The TCP connection failed after opening. */
  lost: 4500,
  /** 30 minutes without a byte either way. */
  idle: 4408,
} as const;

/**
 * Messages on the `GET /v1/events` WebSocket. Clients may send the text
 * `ping`; the relay answers `pong`.
 */
export type RelayEvent =
  /** Gmail changed this mailbox: sync it (`historyId` is Gmail's new cursor). */
  | { type: "mail"; email: string; historyId: string }
  /** The linked accounts changed (another device linked, unlinked or edited one). */
  | { type: "accounts" }
  /** The preferences changed on another device. */
  | { type: "preferences" };
