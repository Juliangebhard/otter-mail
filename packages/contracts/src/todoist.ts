import { z } from "zod";

export const todoistTaskInput = z.object({
  content: z.string().trim().min(1).max(500),
  description: z.string().max(12000).default(""),
  projectId: z.string().min(1).max(200).optional(),
  due: z.string().trim().max(200).optional(),
  priority: z.number().int().min(1).max(4).default(1),
  requestId: z.uuid(),
  email: z.object({ accountId: z.string().min(1), messageId: z.string().min(1) }).optional(),
});
export type TodoistTaskInput = z.input<typeof todoistTaskInput>;
export type TodoistProject = { id: string; name: string };
export type TodoistTask = {
  id: string;
  content: string;
  description: string;
  project_id: string;
  priority: number;
  due: { date: string; string: string; is_recurring: boolean } | null;
};
export type TodoistPage = { results: TodoistTask[]; next_cursor: string | null };
