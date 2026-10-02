import { handle } from "../ipc.js";
import * as todoist from "../services/todoist.js";
import { runAsTask } from "./ipc-budget.js";

type Params = Record<string, unknown> | undefined;
const optional = (value: unknown) => (typeof value === "string" ? value : undefined);

export function registerTodoistHandlers(): void {
  handle("todoist:status", () => todoist.todoistStatus());
  handle("todoist:disconnect", () => todoist.disconnectTodoist());
  handle("todoist:connect", (params: unknown) => {
    const p = params as Params;
    return runAsTask(optional(p?.taskId), () => todoist.connectTodoist(p?.token));
  });
  handle("todoist:projects", (params: unknown) =>
    runAsTask(optional((params as Params)?.taskId), todoist.todoistProjects),
  );
  handle("todoist:tasks", (params: unknown) => {
    const p = params as Params;
    return runAsTask(optional(p?.taskId), () =>
      todoist.todoistTasks(optional(p?.projectId), optional(p?.cursor)),
    );
  });
  handle("todoist:create", (params: unknown) =>
    runAsTask(optional((params as Params)?.taskId), () => todoist.createTodoistTask(params)),
  );
  handle("todoist:complete", (params: unknown) => {
    const p = params as Params;
    const id = optional(p?.id);
    const requestId = optional(p?.requestId);
    if (!id || id.length > 200 || !requestId || !/^[\da-f-]{36}$/i.test(requestId))
      throw new Error("Invalid Todoist task request.");
    return runAsTask(optional(p?.taskId), () => todoist.completeTodoistTask(id, requestId));
  });
}
