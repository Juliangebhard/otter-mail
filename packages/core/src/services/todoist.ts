/** Todoist's v1 API. Credentials stay in this device's secret store. */
import {
  todoistTaskInput,
  type TodoistPage,
  type TodoistProject,
} from "@otter-mail/contracts/todoist";
import { broadcast } from "../ipc.js";
import { platform } from "../platform.js";
import { listAccounts } from "./account-store.js";
import { getMessageLabelIds } from "./mail-store.js";

const SECRET = "todoist-token";
const API = "https://api.todoist.com/api/v1";

async function request<T>(
  path: string,
  options: { token?: string; form?: URLSearchParams } = {},
): Promise<T> {
  const token = options.token ?? (await platform().secrets.get(SECRET));
  if (!token) throw new Error("Connect Todoist in Settings → Integrations first.");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: options.form === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.form === undefined
          ? {}
          : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: options.form,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      credentials: "omit",
    });
  } catch {
    throw new Error("Could not reach Todoist. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Todoist rejected this token. Reconnect in Settings → Integrations.");
    if (response.status === 403)
      throw new Error("Todoist did not allow this action. Check your project permissions.");
    if (response.status === 429)
      throw new Error("Todoist is receiving too many requests. Wait a moment, then try again.");
    if (response.status === 404)
      throw new Error("This Todoist task or project no longer exists. Refresh and try again.");
    if (response.status === 400)
      throw new Error("Todoist could not accept this task. Check its title, project and due date.");
    throw new Error(`Todoist is unavailable (${response.status}). Try again shortly.`);
  }
  if (response.status === 204) return undefined as T;
  try {
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  } catch {
    throw new Error("Todoist returned an unreadable response. Try again shortly.");
  }
}

export async function todoistStatus(): Promise<{ connected: boolean }> {
  return { connected: Boolean(await platform().secrets.get(SECRET)) };
}

export async function connectTodoist(token: unknown): Promise<void> {
  if (typeof token !== "string" || !token.trim() || /\s/.test(token.trim()) || token.length > 512)
    throw new Error("Enter a valid Todoist API token.");
  const cleaned = token.trim();
  await request("/projects?limit=1", { token: cleaned });
  await platform().secrets.set(SECRET, cleaned);
  broadcast("todoist:changed");
}

export async function disconnectTodoist(): Promise<void> {
  await platform().secrets.delete(SECRET);
  broadcast("todoist:changed");
}

export async function todoistProjects(): Promise<TodoistProject[]> {
  const projects: TodoistProject[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const query = new URLSearchParams({ limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page: { results: TodoistProject[]; next_cursor: string | null } = await request(
      `/projects?${query}`,
    );
    projects.push(...page.results.map(({ id, name }) => ({ id, name })));
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor))
      throw new Error("Todoist returned a repeated page. Try refreshing.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return projects;
}

export function todoistTasks(projectId?: string, cursor?: string): Promise<TodoistPage> {
  const query = new URLSearchParams({ limit: "50" });
  if (projectId) query.set("project_id", projectId);
  if (cursor) query.set("cursor", cursor);
  return request(`/tasks?${query}`);
}

/** Sync command UUIDs make retries safe without custom headers (Todoist's CORS
 * policy only allows Authorization and Content-Type in browsers). */
async function command(
  type: "item_add" | "item_close",
  requestId: string,
  args: Record<string, unknown>,
): Promise<void> {
  const result = await request<{ sync_status: Record<string, "ok" | { error_code?: number }> }>(
    "/sync",
    {
      form: new URLSearchParams({
        commands: JSON.stringify([
          { type, uuid: requestId, ...(type === "item_add" ? { temp_id: requestId } : {}), args },
        ]),
      }),
    },
  );
  if (result?.sync_status?.[requestId] !== "ok")
    throw new Error(
      "Todoist could not save this change. Check the task, project permissions and due date, then try again.",
    );
}

export async function createTodoistTask(input: unknown): Promise<void> {
  const p = todoistTaskInput.parse(input);
  let description = p.description;
  if (p.email) {
    const account = (await listAccounts()).find((a) => a.id === p.email!.accountId);
    const message = account && getMessageLabelIds(account.id, p.email.messageId);
    if (!account || !message)
      throw new Error("This email is no longer available. Reopen it and try again.");
    const link = `https://mail.otterware.app/${encodeURIComponent(account.id)}/INBOX/${encodeURIComponent(p.email.messageId)}`;
    description = `${description}${description ? "\n\n" : ""}[Open conversation in Otter Mail](${link})`;
  }
  await command("item_add", p.requestId, {
    content: p.content,
    description,
    project_id: p.projectId,
    due: p.due ? { string: p.due } : undefined,
    priority: p.priority,
  });
  broadcast("todoist:tasksChanged");
}

export async function completeTodoistTask(id: string, requestId: string): Promise<void> {
  await command("item_close", requestId, { id });
  broadcast("todoist:tasksChanged", { completedId: id });
}
