/** Outlook's public-client OAuth flow: browser consent, a localhost callback,
 * and per-mailbox refresh tokens sealed by the desktop platform's secret store. */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { accountStore, platform, type MicrosoftAuth } from "@otter-mail/core";

import { requestMain } from "../main-link.js";

declare const __MICROSOFT_CLIENT_ID__: string;

const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPES = [
  "offline_access",
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
].join(" ");
const SECRET = (email: string) => `microsoft-tokens:${email.toLowerCase()}`;
const clientId = () =>
  process.env.OTTER_MAIL_MICROSOFT_CLIENT_ID?.trim() || __MICROSOFT_CLIENT_ID__;

type Tokens = { clientId: string; accessToken: string; refreshToken: string; expiresAt: number };
type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

const tokens = new Map<string, Tokens>();
const refreshing = new Map<string, Promise<string>>();

async function exchange(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), ...params }),
  });
  const result = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(
      `Microsoft sign-in failed: ${result.error_description || result.error || response.status}`,
    );
  }
  return result;
}

async function keep(email: string, response: TokenResponse, previous?: Tokens): Promise<void> {
  if (!response.access_token || !(response.refresh_token || previous?.refreshToken)) {
    throw new Error(
      "Microsoft did not return a refresh token. Sign in again and grant offline access.",
    );
  }
  const saved: Tokens = {
    clientId: clientId(),
    accessToken: response.access_token,
    refreshToken: response.refresh_token || previous!.refreshToken,
    expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000,
  };
  await platform().secrets.set(SECRET(email), JSON.stringify(saved));
  tokens.set(email.toLowerCase(), saved);
}

async function authorize(
  email: string,
): Promise<{ code: string; redirectUri: string; verifier: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  let resolveCallback!: (code: string) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<string>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/" || url.searchParams.get("state") !== state) {
      response.writeHead(400).end("Invalid sign-in callback.");
      return;
    }
    response
      .writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      })
      .end(
        "<!doctype html><title>Otter Mail</title><p>You can close this window and return to Otter Mail.</p>",
      );
    const code = url.searchParams.get("code");
    if (code) resolveCallback(code);
    else
      rejectCallback(
        new Error(url.searchParams.get("error_description") || "Microsoft sign-in was cancelled."),
      );
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "localhost", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not start Microsoft sign-in.");
    const redirectUri = `http://localhost:${address.port}`;
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: clientId(),
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      login_hint: email,
      prompt: "select_account",
    }).toString();
    await requestMain("openExternal", { url: url.toString() });
    const code = await Promise.race([
      callback,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Microsoft sign-in timed out.")), 300_000);
      }),
    ]);
    return { code, redirectUri, verifier };
  } finally {
    if (timeout) clearTimeout(timeout);
    server.close();
    server.closeAllConnections();
  }
}

export const microsoftAuth: MicrosoftAuth = {
  async load() {
    tokens.clear();
    for (const account of await accountStore.listAccounts()) {
      if (account.imap?.auth !== "microsoft") continue;
      try {
        const raw = await platform().secrets.get(SECRET(account.id));
        if (!raw) continue;
        const saved = JSON.parse(raw) as Tokens;
        if (saved.refreshToken && saved.clientId === clientId()) tokens.set(account.id, saved);
      } catch {
        /* An unreadable secret leaves this mailbox signed out. */
      }
    }
  },
  async signIn(email) {
    if (!clientId())
      throw new Error("Set OTTER_MAIL_MICROSOFT_CLIENT_ID to a Microsoft Entra public client ID.");
    const { code, redirectUri, verifier } = await authorize(email);
    const response = await exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: SCOPES,
    });
    await keep(email, response);
  },
  isSignedIn: (email) => tokens.has(email.toLowerCase()),
  async getAccessToken(email) {
    const id = email.toLowerCase();
    const saved = tokens.get(id);
    if (!saved) throw new Error(`Sign in to ${email} with Microsoft to sync it.`);
    if (saved.expiresAt > Date.now() + 120_000) return saved.accessToken;
    let pending = refreshing.get(id);
    if (!pending) {
      pending = (async () => {
        try {
          const response = await exchange({
            grant_type: "refresh_token",
            refresh_token: saved.refreshToken,
            scope: SCOPES,
          });
          await keep(id, response, saved);
          return response.access_token!;
        } catch (error) {
          if (/invalid_grant|expired|revoked/i.test(String(error)))
            await microsoftAuth.removeTokens(id);
          throw error;
        } finally {
          refreshing.delete(id);
        }
      })();
      refreshing.set(id, pending);
    }
    return pending;
  },
  async removeTokens(email) {
    const id = email.toLowerCase();
    tokens.delete(id);
    await platform().secrets.delete(SECRET(id));
  },
};
