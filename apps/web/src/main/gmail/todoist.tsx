import type { TodoistPage } from "@otter-mail/contracts/todoist";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { gmailApi } from "./api";
import { Btn, IconBtn } from "./ui";
import { toast } from "./toast";

export function useTodoistStatus() {
  return useQuery({ queryKey: ["todoist", "status"], queryFn: gmailApi.todoistStatus });
}

function useTodoistProjects(enabled: boolean) {
  return useQuery({
    queryKey: ["todoist", "projects"],
    queryFn: gmailApi.todoistProjects,
    enabled,
    retry: false,
  });
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const taskUrl = (id: string) => `https://app.todoist.com/app/task/${encodeURIComponent(id)}`;

type EmailTask = { accountId: string; messageId: string; subject: string };
type Request = { kind: "browse" } | { kind: "create"; email?: EmailTask };
const listeners = new Set<(request: Request) => void>();
export function browseTodoist(): void {
  for (const listener of listeners) listener({ kind: "browse" });
}
export function addEmailToTodoist(email: EmailTask): void {
  for (const listener of listeners) listener({ kind: "create", email });
}

/** Mounted once so menu actions work from both the list and reader. */
export function TodoistDialogs() {
  const [request, setRequest] = useState<Request | null>(null);
  const qc = useQueryClient();
  useEffect(() => {
    listeners.add(setRequest);
    const off = window.desktopBridge.on("todoist:changed", () => {
      setRequest(null);
      void qc.resetQueries({ queryKey: ["todoist"] });
    });
    const offTasks = window.desktopBridge.on("todoist:tasksChanged", (payload: unknown) => {
      const completedId = (payload as { completedId?: string } | undefined)?.completedId;
      if (completedId)
        qc.setQueriesData<InfiniteData<TodoistPage>>({ queryKey: ["todoist", "tasks"] }, (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  results: page.results.filter((task) => task.id !== completedId),
                })),
              }
            : data,
        );
      void qc.invalidateQueries({ queryKey: ["todoist", "tasks"] });
    });
    return () => {
      listeners.delete(setRequest);
      off();
      offTasks();
    };
  }, [qc]);
  if (!request) return null;
  return request.kind === "browse" ? (
    <TodoistBrowser
      onClose={() => setRequest(null)}
      onCreate={() => setRequest({ kind: "create" })}
    />
  ) : (
    <TodoistCreate email={request.email} onClose={() => setRequest(null)} />
  );
}

function ConnectTodoist({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between gap-3">
      <p>Connect your Todoist account to get started.</p>
      <Btn
        size="sm"
        onClick={() => {
          onClose();
          void navigate({ to: "/settings/$pane", params: { pane: "integrations" } });
        }}
      >
        Open settings
      </Btn>
    </div>
  );
}

function ProjectSelect({
  value,
  onChange,
  projects,
  all = false,
}: {
  value: string;
  onChange: (value: string) => void;
  projects: { id: string; name: string }[];
  all?: boolean;
}) {
  return (
    <Select
      value={value || "__default__"}
      onValueChange={(next) => onChange(next === "__default__" ? "" : next)}
    >
      <SelectTrigger aria-label="Todoist project">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__default__">{all ? "All projects" : "Inbox (default)"}</SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TodoistCreate({ email, onClose }: { email?: EmailTask; onClose: () => void }) {
  const status = useTodoistStatus();
  const projects = useTodoistProjects(status.data?.connected === true);
  const [content, setContent] = useState(email?.subject.slice(0, 500) || "");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("1");
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const connected = status.data?.connected === true;
  return (
    <Dialog
      open
      title={email ? "Add email to Todoist" : "New Todoist task"}
      description={
        email
          ? "A link to this conversation will be included. Only the title, notes and link are sent to Todoist."
          : "Create a task in your Todoist account."
      }
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      confirmLabel="Create task"
      confirmDisabled={!connected || !content.trim() || pending}
      onConfirm={async () => {
        const input = {
          content: content.trim(),
          description,
          projectId: project || undefined,
          due: due.trim() || undefined,
          priority: Number(priority),
          email: email ? { accountId: email.accountId, messageId: email.messageId } : undefined,
        };
        const payload = JSON.stringify(input);
        if (attempt.current?.payload !== payload)
          attempt.current = { payload, id: crypto.randomUUID() };
        setPending(true);
        try {
          await gmailApi.createTodoistTask({ ...input, requestId: attempt.current.id });
          toast.success("Task created in Todoist", {
            action: { label: "View tasks", onClick: browseTodoist },
          });
        } catch (error) {
          toast.error(errorText(error));
          throw error;
        } finally {
          setPending(false);
        }
      }}
    >
      {status.isError ? (
        <p role="alert">{errorText(status.error)}</p>
      ) : !status.data ? (
        <p>Loading Todoist…</p>
      ) : !connected ? (
        <ConnectTodoist onClose={onClose} />
      ) : null}
      <fieldset disabled={pending || !connected} className="flex flex-col gap-3">
        <Field label="Title" orientation="vertical">
          <Input
            value={content}
            maxLength={500}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Notes" orientation="vertical">
          <textarea
            aria-label="Notes"
            className="min-h-24 rounded-md border border-input bg-transparent p-2"
            value={description}
            maxLength={12000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Project" orientation="vertical">
          <ProjectSelect value={project} onChange={setProject} projects={projects.data ?? []} />
        </Field>
        {projects.isLoading ? <p className="text-muted-foreground">Loading projects…</p> : null}
        {projects.isError ? (
          <p role="alert">
            {errorText(projects.error)}{" "}
            <button type="button" className="underline" onClick={() => void projects.refetch()}>
              Retry
            </button>
          </p>
        ) : null}
        <Field label="Due date" orientation="vertical">
          <Input
            value={due}
            maxLength={200}
            onChange={(e) => setDue(e.target.value)}
            placeholder="e.g. tomorrow at 3pm or every Monday"
          />
        </Field>
        <Field label="Priority" orientation="vertical">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">Priority 1 · Urgent</SelectItem>
              <SelectItem value="3">Priority 2 · High</SelectItem>
              <SelectItem value="2">Priority 3 · Medium</SelectItem>
              <SelectItem value="1">Priority 4 · Normal</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </fieldset>
    </Dialog>
  );
}

function TodoistBrowser({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const status = useTodoistStatus();
  const connected = status.data?.connected === true;
  const projects = useTodoistProjects(connected);
  const [project, setProject] = useState("");
  const [completing, setCompleting] = useState<string | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const tasks = useInfiniteQuery({
    queryKey: ["todoist", "tasks", project],
    queryFn: ({ pageParam }) => gmailApi.todoistTasks(project || undefined, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: connected,
    retry: false,
  });
  const rows = tasks.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !completing) onClose();
      }}
      title="Todoist"
      description="Your active tasks. Completing a recurring task schedules its next occurrence."
      size="xl"
    >
      <div className="flex items-center gap-2">
        <ProjectSelect value={project} onChange={setProject} projects={projects.data ?? []} all />
        <IconBtn
          label="Refresh Todoist"
          disabled={tasks.isFetching || projects.isFetching}
          onClick={() => {
            void tasks.refetch();
            void projects.refetch();
          }}
        >
          <RefreshCwIcon className="size-4" />
        </IconBtn>
        <Btn
          size="sm"
          variant="primary"
          disabled={!connected || completing !== null}
          onClick={onCreate}
        >
          New task
        </Btn>
      </div>
      {status.isError ? (
        <p role="alert">{errorText(status.error)}</p>
      ) : !status.data ? (
        <p>Loading Todoist…</p>
      ) : !connected ? (
        <ConnectTodoist onClose={onClose} />
      ) : null}
      {projects.isError ? <p role="alert">{errorText(projects.error)}</p> : null}
      {tasks.isError ? (
        <p role="alert">
          {errorText(tasks.error)}{" "}
          <button className="underline" onClick={() => void tasks.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      {connected && tasks.isPending ? <p>Loading tasks…</p> : null}
      {connected && tasks.isSuccess && rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          No active tasks{project ? " in this project" : ""}.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {rows.map((task) => (
          <li key={task.id} className="flex items-start gap-3 py-3">
            <IconBtn
              label={`Complete ${task.content}`}
              disabled={completing !== null}
              onClick={() => {
                setCompleting(task.id);
                const id = requestIds.current.get(task.id) ?? crypto.randomUUID();
                requestIds.current.set(task.id, id);
                void gmailApi
                  .completeTodoistTask(task.id, id)
                  .then(() => {
                    requestIds.current.delete(task.id);
                    toast.success(
                      task.due?.is_recurring
                        ? "Task completed; next occurrence scheduled"
                        : "Task completed",
                    );
                  })
                  .catch((error: unknown) => toast.error(errorText(error)))
                  .finally(() => setCompleting(null));
              }}
            >
              <CheckIcon className="size-4" />
            </IconBtn>
            <div className="min-w-0 flex-1">
              <a
                href={taskUrl(task.id)}
                target="_blank"
                rel="noreferrer"
                className="break-words hover:underline"
              >
                {task.content} <ExternalLinkIcon className="inline size-3 text-muted-foreground" />
              </a>
              <p className="text-xs text-muted-foreground">
                {projects.data?.find((p) => p.id === task.project_id)?.name ?? ""}
                {task.due ? ` · ${task.due.string || task.due.date} (${task.due.date})` : ""}
                {task.priority > 1 ? ` · Priority ${5 - task.priority}` : ""}
              </p>
              {task.description ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground line-clamp-3">
                  {task.description}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {tasks.hasNextPage ? (
        <Btn disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>
          {tasks.isFetchingNextPage ? "Loading…" : "Load more"}
        </Btn>
      ) : null}
    </Dialog>
  );
}
