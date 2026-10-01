/**
 * Otter Mail's tools (core's agent tools: mailboxes, calendars) as an MCP
 * server, the way Otter Code serves its own: streamable HTTP on 127.0.0.1,
 * on the same port every launch. A bearer token says who is calling:
 *  - a chat with an agent this Mac runs (one token each), so a tool's approval
 *    goes to that chat. Claude gets the server as `mcpServers`, Codex as
 *    `mcp_servers` in its thread config.
 *  - an agent it doesn't run, with a token made in Settings (connected-agents.ts).
 */

import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  OTTER_TOOLS_SERVER,
  agentTools,
  cancelToolApprovals,
  readJson,
  runAgentTool,
  writeJson,
  type ToolCaller,
} from "@otter-mail/core";

import { appInfo } from "../../backend-protocol.js";
import { logger } from "../../logger.js";
import { agentCaller } from "./connected-agents.js";
import { CONNECTED_AGENT_INSTRUCTIONS } from "./instructions.js";
import { deviceFiles } from "./local.js";

export const MCP_SERVER_NAME = OTTER_TOOLS_SERVER;

/** What the agent is pointed at, and how the chat lets go of it. */
export type ToolAccess = {
  url: string;
  headers: { Authorization: string };
  /** The chat's turn stopped: its open approvals fail. */
  cancelApprovals(): void;
  /** The chat closed: the token stops working. */
  revoke(): void;
};

/** The chats' callers, by token. */
const chats = new Map<string, ToolCaller>();

/** One MCP server per request (stateless), bound to the caller. */
function mcpServer(caller: ToolCaller, instructions: string | undefined): Server {
  const server = new Server(
    { name: "Otter Mail", version: appInfo().version },
    { capabilities: { tools: {} }, instructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: agentTools(caller).map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: { readOnlyHint: Boolean(tool.readOnly), openWorldHint: false },
    })),
  }));
  // The signal aborts when the agent hangs up, so a change it stopped waiting for won't happen.
  server.setRequestHandler(CallToolRequestSchema, async (request, { signal }) => {
    const { text, isError } = await runAgentTool(
      caller,
      request.params.name,
      request.params.arguments ?? {},
      signal,
    );
    return { content: [{ type: "text", text }], isError };
  });
  return server;
}

async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Only this Mac's agents: a web page reaching the port through DNS rebinding names its own host.
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? "")) {
    res.writeHead(403).end();
    return;
  }
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const chat = token ? chats.get(token) : undefined;
  const caller = chat ?? (token ? await agentCaller(token) : null);
  if (!caller) {
    res.writeHead(401).end();
    return;
  }
  // A chat's agent has these in its prompt already (instructions.ts).
  const server = mcpServer(caller, chat ? undefined : CONNECTED_AGENT_INSTRUCTIONS);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/** Listens on `port` (0: any free one); answers the port it got. */
function listen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      serve(req, res).catch((error: unknown) => {
        logger.info("agent", "mcp request failed", { error: String(error) });
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

const PORT_FILE = "mcp-server.json";

let listening: Promise<string> | null = null;

/**
 * Starts the server once, on the port it had last time, so the address agents
 * were given keeps working (a free one the first time, or once another app
 * took it); answers its URL.
 */
export function serverUrl(): Promise<string> {
  listening ??= (async () => {
    const saved = (await readJson<{ port: number }>(PORT_FILE))?.port;
    const port = await listen(saved ?? 0).catch((error: unknown) => {
      if (!saved) throw error;
      logger.info("agent", "mcp port taken, moving", { port: saved, error: String(error) });
      return listen(0);
    });
    if (port !== saved) await writeJson(PORT_FILE, { port });
    logger.info("agent", "mcp server listening", { port });
    return `http://127.0.0.1:${port}/mcp`;
  })().catch((error: unknown) => {
    listening = null;
    throw error;
  });
  return listening;
}

/** Gives a chat the tools: a token of its own on the server. */
export async function toolAccess(caller: Omit<ToolCaller, "files">): Promise<ToolAccess> {
  const url = await serverUrl();
  const token = randomBytes(32).toString("base64url");
  const bound: ToolCaller = { ...caller, files: deviceFiles };
  chats.set(token, bound);
  return {
    url,
    headers: { Authorization: `Bearer ${token}` },
    cancelApprovals: () => cancelToolApprovals(bound),
    revoke() {
      chats.delete(token);
      cancelToolApprovals(bound);
    },
  };
}
