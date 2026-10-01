/**
 * All projects, in the main pane while no conversation is open (the list
 * next to it has their conversations): each active project with where it
 * stands (its notes' first line), its mailboxes and how much is unread; the
 * settled ones folded after them. Picking one opens its page.
 */

import { useState } from "react";
import { ChevronDownIcon, CircleCheckIcon, FolderIcon, FolderKanbanIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { getAccountColor } from "./account-style";
import { useAccounts } from "./hooks";
import { requestNewProject } from "./project-menus";
import { useProjectUnreadCounts, useProjects, type Project } from "./projects";
import { cn } from "./ui";

const SETTLED_OPEN_KEY = "gmail:projects:settled-open";

function ago(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

function ProjectRow({
  project,
  unread,
  onOpen,
}: {
  project: Project;
  unread: number;
  onOpen: () => void;
}) {
  const accounts = useAccounts().data ?? [];
  const settled = project.status === "settled";
  const count = project.threads.length;
  const firstLine = project.notes.split("\n").find((line) => line.trim()) ?? "";
  const mailboxes = [...new Set(project.threads.map((t) => t.email))].flatMap(
    (email) => accounts.find((a) => a.email.toLowerCase() === email) ?? [],
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-accent-surface/60 focus-visible:bg-accent-surface/60"
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">
        {settled ? <CircleCheckIcon className="size-4" /> : <FolderIcon className="size-4" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
        <span className="truncate text-[13px] text-muted-foreground">
          {firstLine.replace(/^[-*#>\s]+/, "") || "No notes yet"}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-xs tabular-nums text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {unread > 0 ? <span className="text-foreground">{unread} unread ·</span> : null}
          {count} conversation{count === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex -space-x-0.5">
            {mailboxes.map((a) => (
              <span
                key={a.id}
                className="size-2 rounded-full ring-2 ring-card"
                style={{ background: getAccountColor(a) }}
              />
            ))}
          </span>
          {settled && project.settledAt
            ? `settled ${ago(project.settledAt)}`
            : `updated ${ago(project.updatedAt)}`}
        </span>
      </span>
    </button>
  );
}

export function ProjectsOverview({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const projects = useProjects();
  const unread = useProjectUnreadCounts().data ?? {};
  const [settledOpen, setSettledOpen] = useState(
    () => localStorage.getItem(SETTLED_OPEN_KEY) === "1",
  );
  const all = projects.data ?? [];
  const active = all.filter((p) => p.status === "active").sort((a, b) => b.updatedAt - a.updatedAt);
  const settled = all
    .filter((p) => p.status === "settled")
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));
  const row = (project: Project) => (
    <ProjectRow
      key={project.id}
      project={project}
      unread={unread[project.id] ?? 0}
      onOpen={() => onOpenProject(project.id)}
    />
  );

  if (projects.isSuccess && all.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          className="max-w-sm px-8"
          media={<FolderKanbanIcon className="size-10 stroke-[1.25] text-muted-foreground" />}
          title="No projects yet"
          description="A project keeps a piece of work's conversations, from any mailbox, with its documents, links and notes, until it's settled. Your agent can start one too."
          actions={
            <Button variant="accent" onClick={() => requestNewProject({ open: true })}>
              New project
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 pb-16 pt-6">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {active.length === 1 ? "1 active project" : `${active.length} active projects`}
              {settled.length > 0 ? `, ${settled.length} settled` : ""}
            </p>
          </div>
          <Button size="small" onClick={() => requestNewProject({ open: true })}>
            New project
          </Button>
        </div>

        {active.length > 0 ? (
          <div className="mt-6 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {active.map(row)}
          </div>
        ) : null}

        {settled.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() =>
                setSettledOpen((open) => {
                  localStorage.setItem(SETTLED_OPEN_KEY, open ? "0" : "1");
                  return !open;
                })
              }
              aria-expanded={settledOpen}
              className="mt-8 flex h-7 items-center gap-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Settled
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", !settledOpen && "-rotate-90")}
              />
            </button>
            {settledOpen ? (
              <div className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
                {settled.map(row)}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
