/**
 * Agents on this Mac that Otter Mail doesn't run itself (Claude Code, Codex in
 * a terminal, Cursor, …): each gets Otter Mail's tools at the MCP server
 * (mcp-server.ts) with an agent token made in Settings › Agents (contracts'
 * agent-tokens.ts). Its changes ask as its access says; with no chat to ask
 * in, they ask the main window, and a notification brings it up.
 */

import { AGENT_APPROVALS_CHANNEL, allowQuestion, type AgentApproval } from "@otter-mail/contracts";
import {
  agentTokenHash,
  newAgentToken,
  type AgentAccess,
  type ConnectedAgent,
} from "@otter-mail/contracts/agent-tokens";
import {
  broadcast,
  cancelToolApprovals,
  readJson,
  writeJson,
  type Emit,
  type ToolCaller,
} from "@otter-mail/core";

import { tellMain } from "../../main-link.js";
import { deviceFiles } from "./local.js";

type StoredAgent = ConnectedAgent & { hash: string };

const FILE = "connected-agents.json";

let stored: Promise<StoredAgent[]> | null = null;
const load = () => (stored ??= readJson<StoredAgent[]>(FILE).then((agents) => agents ?? []));
const save = async () => writeJson(FILE, await load());

const toConnectedAgent = ({ hash: _hash, ...agent }: StoredAgent): ConnectedAgent => agent;

export async function listAgents(): Promise<ConnectedAgent[]> {
  return (await load()).map(toConnectedAgent);
}

/** A new agent; answers its token, this once. */
export async function addAgent(name: string, access: AgentAccess): Promise<string> {
  const { token, hash } = await newAgentToken("otter_mac_");
  const agents = await load();
  agents.unshift({
    id: crypto.randomUUID(),
    name,
    access,
    createdAt: Date.now(),
    lastUsedAt: null,
    hash,
  });
  await save();
  return token;
}

export async function setAgentAccess(id: string, access: AgentAccess): Promise<void> {
  const agent = (await load()).find((a) => a.id === id);
  if (!agent) throw new Error("That agent's token was revoked.");
  agent.access = access;
  await save();
}

/** Revokes an agent's token: what it waits on the user to allow won't happen. */
export async function removeAgent(id: string): Promise<void> {
  const agents = await load();
  const index = agents.findIndex((a) => a.id === id);
  if (index >= 0) agents.splice(index, 1);
  await save();
  const caller = callers.get(id);
  callers.delete(id);
  if (caller) cancelToolApprovals(caller);
}

/** The caller a token stands for, or null. */
export async function agentCaller(token: string): Promise<ToolCaller | null> {
  const hash = await agentTokenHash(token);
  const agent = (await load()).find((a) => a.hash === hash);
  if (!agent) return null;
  // "Last used" to the minute, so a busy agent doesn't write the file on every call.
  if (Date.now() - (agent.lastUsedAt ?? 0) > 60_000) {
    agent.lastUsedAt = Date.now();
    void save().catch(() => {});
  }
  return callerOf(agent);
}

// ── Callers and their approvals ─────────────────────────────────────────────

/** One per agent, so its changes run in the order it asked for them. */
const callers = new Map<string, ToolCaller>();
const approvals = new Map<string, AgentApproval>();

export const pendingApprovals = (): AgentApproval[] => [...approvals.values()];

function callerOf(agent: StoredAgent): ToolCaller {
  const existing = callers.get(agent.id);
  if (existing) return existing;
  const emit: Emit = (event) => {
    if (event.type === "approval") {
      const { id, title, detail = "" } = event.approval;
      approvals.set(id, { id, agent: agent.name, title, detail });
      tellMain({ kind: "notify", title: allowQuestion(agent.name, title), body: detail });
    } else if (event.type === "approvalResolved") {
      approvals.delete(event.approvalId);
    } else return;
    broadcast(AGENT_APPROVALS_CHANNEL, pendingApprovals());
  };
  const caller: ToolCaller = {
    mode: () => (agent.access === "full-access" ? "full-access" : "approval-required"),
    readOnly: () => agent.access === "read-only",
    // No chat to ask in: its approvals go to the main window.
    turn: () => ({ requestId: agent.id, emit }),
    files: deviceFiles,
  };
  callers.set(agent.id, caller);
  return caller;
}
