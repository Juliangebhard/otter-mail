/**
 * All projects, in the main pane while no conversation is open (the list
 * next to it has their conversations): each active project with where it
 * stands (its notes' first line), its mailboxes and how much is unread, with
 * search and Active / Settled tabs (ChatGPT's "All"). Picking one opens its page.
 */

import { useState } from "react";
import { CircleCheckIcon, FolderIcon, FolderKanbanIcon, SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { getAccountColor } from "./account-style";
import { useAccounts } from "./hooks";
import { requestNewProject } from "./project-menus";
import { useProjectUnreadCounts, useProjects, type Project } from "./projects";
import { cn } from "./ui";

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
  const [tab, setTab] = useState<"active" | "settled">("active");
  const [query, setQuery] = useState("");
  const all = projects.data ?? [];
  const active = all.filter((p) => p.status === "active").sort((a, b) => b.updatedAt - a.updatedAt);
  const settled = all
    .filter((p) => p.status === "settled")
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));
  // A search looks through names and notes.
  const needle = query.trim().toLowerCase();
  const shown = (tab === "active" ? active : settled).filter(
    (p) => !needle || `${p.name}\n${p.notes}`.toLowerCase().includes(needle),
  );
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

        {/* ChatGPT's "All": search, then tabs. */}
        <div className="mt-6 flex h-9 items-center gap-2 rounded-full border border-border/70 px-3.5 focus-within:border-input">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-4 flex gap-1" role="tablist">
          {(
            [
              ["active", "Active", active.length],
              ["settled", "Settled", settled.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "h-8 rounded-full px-3.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
                tab === id
                  ? "bg-accent-surface text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="ms-1.5 tabular-nums text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>

        {shown.length > 0 ? (
          <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {shown.map(row)}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            {needle
              ? "No project matches."
              : tab === "active"
                ? "Nothing active: every project is settled."
                : "Settled projects show here, with everything they gathered."}
          </p>
        )}
      </div>
    </div>
  );
}
