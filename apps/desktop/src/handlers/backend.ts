/**
 * The desktop-only channels the mail backend serves itself (backend.ts), as
 * core handlers: syncing every mailbox, an attachment's bytes for main to drag
 * out, and the agents on this computer given Otter Mail's tools
 * (services/agent/connected-agents.ts).
 */

import type { AgentAccess, AgentTokens, ConnectedAgent } from "@otter-mail/contracts/agent-tokens";
import { getAttachmentBytes, handle, syncAllAccounts } from "@otter-mail/core";

import {
  addAgent,
  listAgents,
  removeAgent,
  setAgentAccess,
} from "../services/agent/connected-agents.js";
import { serverUrl } from "../services/agent/mcp-server.js";

export function registerBackendHandlers(): void {
  // Mailbox → Synchronize All Mailboxes.
  handle("desktop:syncAll", async () => {
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
