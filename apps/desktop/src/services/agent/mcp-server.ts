/**
 * Otter Mail's tools (core's agent tools: mailboxes, calendars) as an MCP
 * server for the agents this Mac runs, the way Otter Code serves its own:
 * streamable HTTP on 127.0.0.1, one bearer token per chat. The token says
 * which chat is calling, so a tool's approval goes to that chat. Claude gets
 * the server as `mcpServers`, Codex as `mcp_servers` in its thread config.
 */

import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  OTTER_TOOLS_SERVER,
  agentTools,
  cancelToolApprovals,
  runAgentTool,
  type ToolCaller,
  type ToolFiles,
} from "@otter-mail/core";

import { appInfo } from "../../backend-protocol.js";
import { logger } from "../../logger.js";
import { attachmentsDir } from "./local.js";

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

const callers = new Map<string, ToolCaller>();

/** Attachments land in the agents' attachments folder (Claude may read there). */
const files: ToolFiles = {
  async save(name, bytes) {
    const dir = path.join(await attachmentsDir(), "mail", randomUUID());
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, path.basename(name).replace(/^\.+/, "_") || "attachment");
    await fs.writeFile(file, bytes);
    return file;
  },
  async read(file) {
    const resolved = file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
    if (!path.isAbsolute(resolved)) throw new Error(`Give the file's full path: ${file}`);
    return { name: path.basename(resolved), bytes: new Uint8Array(await fs.readFile(resolved)) };
  },
};

/** One MCP server per request (stateless), bound to the calling chat. */
function mcpServer(caller: ToolCaller): Server {
  const server = new Server(
    { name: "Otter Mail", version: appInfo().version },
    { capabilities: { tools: {} } },
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
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { text, isError } = await runAgentTool(
      caller,
      request.params.name,
      request.params.arguments ?? {},
    );
    return { content: [{ type: "text", text }], isError };
  });
  return server;
}

async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const caller = token ? callers.get(token) : undefined;
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (!caller) {
    res.writeHead(401).end();
    return;
  }
  const server = mcpServer(caller);
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

let listening: Promise<string> | null = null;

/** Starts the server once, on a free port; answers its URL. */
function start(): Promise<string> {
  listening ??= new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      serve(req, res).catch((error: unknown) => {
        logger.info("agent", "mcp request failed", { error: String(error) });
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      logger.info("agent", "mcp server listening", { port });
      resolve(`http://127.0.0.1:${port}/mcp`);
    });
  }).catch((error: unknown) => {
    listening = null;
    throw error;
  });
  return listening;
}

/** Gives a chat the tools: a token of its own on the server. */
export async function toolAccess(caller: Omit<ToolCaller, "files">): Promise<ToolAccess> {
  const url = await start();
  const token = randomBytes(32).toString("base64url");
  const bound: ToolCaller = { ...caller, files };
  callers.set(token, bound);
  return {
    url,
    headers: { Authorization: `Bearer ${token}` },
    cancelApprovals: () => cancelToolApprovals(bound),
    revoke() {
      callers.delete(token);
      cancelToolApprovals(bound);
    },
  };
}
