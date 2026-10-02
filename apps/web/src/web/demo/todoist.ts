/** A device-local Todoist for the demo mailbox. Connect with the token `demo`. */
import type { TodoistTask } from "@otter-mail/contracts/todoist";
import type { Platform } from "@otter-mail/core";

const FILE = "demo-todoist.json";
const projects = [
  { id: "inbox", name: "Inbox" },
  { id: "work", name: "Work" },
];
type State = { tasks: TodoistTask[]; commands: string[] };

export async function fakeTodoist(files: Platform["files"]) {
  const saved = await files.read(FILE);
  const state: State = saved
    ? JSON.parse(new TextDecoder().decode(saved))
    : {
        tasks: [
          {
            id: "demo-plan",
            content: "Review the launch plan",
            description: "Check the milestones before Friday.",
            project_id: "work",
            priority: 3,
            due: null,
          },
          {
            id: "demo-inbox",
            content: "Follow up on the proposal",
            description: "",
            project_id: "inbox",
            priority: 1,
            due: null,
          },
          {
            id: "demo-recurring",
            content: "Review the inbox",
            description: "This recurring task advances when completed.",
            project_id: "work",
            priority: 2,
            due: {
              date: new Date().toISOString().slice(0, 10),
              string: "every day",
              is_recurring: true,
            },
          },
        ],
        commands: [],
      };
  return async (url: URL, init?: RequestInit): Promise<Response> => {
    if (new Headers(init?.headers).get("Authorization") !== "Bearer demo")
      return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/api/v1/projects")
      return Response.json({ results: projects, next_cursor: null });
    if (url.pathname === "/api/v1/tasks") {
      const project = url.searchParams.get("project_id");
      const tasks = state.tasks.filter((task) => !project || task.project_id === project);
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return Response.json({
        results: tasks.slice(start, start + limit),
        next_cursor: start + limit < tasks.length ? String(start + limit) : null,
      });
    }
    if (url.pathname !== "/api/v1/sync" || init?.method !== "POST")
      return new Response(null, { status: 404 });
    const form = new URLSearchParams(String(init.body));
    const commands = JSON.parse(form.get("commands") ?? "[]") as {
      type: string;
      uuid: string;
      args: {
        id?: string;
        content?: string;
        description?: string;
        project_id?: string;
        priority?: number;
        due?: { string: string };
      };
    }[];
    const sync_status: Record<string, "ok" | { error_code: number }> = {};
    for (const command of commands) {
      if (state.commands.includes(command.uuid)) {
        sync_status[command.uuid] = "ok";
        continue;
      }
      const args = command.args;
      if (command.type === "item_add" && args.content) {
        state.tasks.push({
          id: `demo-${command.uuid}`,
          content: args.content,
          description: args.description ?? "",
          project_id: args.project_id ?? "inbox",
          priority: args.priority ?? 1,
          due: args.due
            ? {
                string: args.due.string,
                date: new Date().toISOString().slice(0, 10),
                is_recurring: args.due.string.toLowerCase().includes("every"),
              }
            : null,
        });
      } else if (command.type === "item_close") {
        const task = state.tasks.find((task) => task.id === args.id);
        if (!task) {
          sync_status[command.uuid] = { error_code: 20 };
          continue;
        }
        if (task.due?.is_recurring) {
          const date = new Date(`${task.due.date}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + 1);
          task.due.date = date.toISOString().slice(0, 10);
        } else state.tasks = state.tasks.filter((task) => task.id !== args.id);
      } else {
        sync_status[command.uuid] = { error_code: 20 };
        continue;
      }
      state.commands.push(command.uuid);
      sync_status[command.uuid] = "ok";
    }
    await files.write(FILE, JSON.stringify(state));
    return Response.json({ sync_status });
  };
}
