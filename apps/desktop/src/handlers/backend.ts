/**
 * The Mac-only channels the mail backend serves itself (backend.ts), as core
 * handlers: the menu-bar popover's mini inbox, read from the local mail cache
 * (the popover doesn't sync on its own; it reflects what sync already wrote),
 * syncing every mailbox, an attachment's bytes for main to drag out, and the
 * agents on this Mac given Otter Mail's tools (services/agent/connected-agents.ts).
 */

import type { AgentAccess, AgentTokens, ConnectedAgent } from "@otter-mail/contracts/agent-tokens";
import {
  accountStore,
  getAttachmentBytes,
  handle,
  mailStore,
  syncAllAccounts,
  turnedOffMailboxes,
  type GmailAccount,
  type GmailMessageSummary,
} from "@otter-mail/core";

import {
  addAgent,
  listAgents,
  removeAgent,
  setAgentAccess,
} from "../services/agent/connected-agents.js";
import { serverUrl } from "../services/agent/mcp-server.js";

const PREVIEW_LIMIT = 15;

export type TrayAccountSnapshot = {
  account: GmailAccount;
  unreadCount: number;
  messages: GmailMessageSummary[];
};

export type TraySnapshot = {
  accounts: TrayAccountSnapshot[];
  totalUnread: number;
};

export function registerBackendHandlers(): void {
  handle("tray:getSnapshot", async (params: unknown): Promise<TraySnapshot> => {
    const p = params as Record<string, unknown> | undefined;
    const unreadOnly = p?.unreadOnly !== false;
    const accounts = await accountStore.listAccounts();
    return {
      accounts: accounts.map((account) => ({
        account,
        unreadCount: mailStore.countInboxUnreadForAccount(account.id),
        messages: mailStore.listInboxPreview(account.id, PREVIEW_LIMIT, unreadOnly),
      })),
      totalUnread: mailStore.countInboxUnreadAll(turnedOffMailboxes()),
    };
  });

  // The popover's sync button, and Mailbox → Synchronize All Mailboxes.
  handle("tray:sync", async () => {
    await syncAllAccounts({ force: true });
    return { ok: true };
  });

  // gmail:dragAttachment (main) drags the file out; the bytes come from here.
  handle("desktop:attachmentBytes", async (params: unknown) => {
    const { accountId, messageId, attachmentId } = params as Record<string, string>;
    return getAttachmentBytes(accountId, messageId, attachmentId);
  });

  handle("mcp:listAgents", async (): Promise<AgentTokens<ConnectedAgent>> => ({
    url: await serverUrl(),
    tokens: await listAgents(),
  }));

  // Answers the token, this once.
  handle("mcp:addAgent", async (params: unknown) => {
    const p = params as Record<string, unknown> | undefined;
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name) throw new Error("Name the agent.");
    return addAgent(name.slice(0, 80), access(p?.access));
  });

  handle("mcp:setAgentAccess", async (params: unknown) => {
    const p = params as Record<string, unknown> | undefined;
    await setAgentAccess(String(p?.id), access(p?.access));
  });

  handle("mcp:removeAgent", async (params: unknown) => {
    await removeAgent(String((params as Record<string, unknown> | undefined)?.id));
  });
}

function access(value: unknown): AgentAccess {
  if (value === "read-only" || value === "safe" || value === "full-access") return value;
  throw new Error("Unknown access.");
}
