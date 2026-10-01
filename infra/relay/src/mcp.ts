/**
 * The relay's MCP server, for agents that run elsewhere (Hermes): the
 * account's projects and nothing more (the relay never sees mail). Agents
 * sign in with an agent token (contracts' agent-tokens.ts), made in Settings;
 * the relay keeps only its hash.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { desc, eq, and } from "drizzle-orm";
import {
  callTool,
  projectTools,
  type ProjectTool,
  type ProjectBackend,
} from "@otter-mail/contracts/project-tools";
import { agentTokenHash, newAgentToken, type AgentToken } from "@otter-mail/contracts/agent-tokens";

import { agentTokens } from "./schema.ts";
import type { Db } from "./store.ts";

const TOKEN_PREFIX = "otter_";

const toAgentToken = (row: typeof agentTokens.$inferSelect): AgentToken => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.getTime(),
  lastUsedAt: row.lastUsedAt?.getTime() ?? null,
});

export async function listTokens(db: Db, userId: string): Promise<AgentToken[]> {
  const rows = await db
    .select()
    .from(agentTokens)
    .where(eq(agentTokens.userId, userId))
    .orderBy(desc(agentTokens.createdAt));
  return rows.map(toAgentToken);
}

/** A new token: its secret (shown once) and its record. */
export async function createToken(
  db: Db,
  userId: string,
  name: string,
): Promise<{ token: string; agentToken: AgentToken }> {
  const { token, hash } = await newAgentToken(TOKEN_PREFIX);
  const [row] = await db
    .insert(agentTokens)
    .values({ id: crypto.randomUUID(), userId, name, hash })
    .returning();
  return { token, agentToken: toAgentToken(row) };
}

export async function deleteToken(db: Db, userId: string, id: string): Promise<boolean> {
  const removed = await db
    .delete(agentTokens)
    .where(and(eq(agentTokens.userId, userId), eq(agentTokens.id, id)))
    .returning({ id: agentTokens.id });
  return removed.length > 0;
}

/** The account a token belongs to, or null. */
export async function tokenUser(db: Db, token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .update(agentTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentTokens.hash, await agentTokenHash(token)))
    .returning({ userId: agentTokens.userId });
  return row?.userId ?? null;
}

const INSTRUCTIONS =
  "Otter Mail's projects: the conversations, documents, links and notes of one piece of work, kept together until it's settled. Conversations are named by account (a mailbox's email address) and threadId. This server has no mail of its own: find conversations with your own mail tools.";

function register(server: McpServer, tools: ProjectTool[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false },
      },
      (args: Record<string, unknown>) => callTool(tool, args),
    );
  }
}

/** Answers one MCP request (stateless: a server per request). */
export async function serve(request: Request, backend: ProjectBackend): Promise<Response> {
  const server = new McpServer(
    { name: "otter-mail-projects", version: "1.0.0" },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  register(server, projectTools(backend));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
