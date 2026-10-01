/**
 * The sidebar while Projects is picked in the rail (ChatGPT's projects): New
 * project and Search, then every active project's conversations together,
 * each active project, and the settled ones folded at the end. Conversations
 * dragged from the list drop onto a project to join it.
 */

import { useState } from "react";
import {
  CircleCheckIcon,
  FolderIcon,
  FolderKanbanIcon,
  FolderPlusIcon,
  SearchIcon,
} from "lucide-react";

import { HintTooltip } from "./ui";
import { SIDEBAR_ROW, Section, SectionAddButton, SkRow } from "./accounts-sidebar";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./menu";
import { requestNewProject } from "./project-menus";
import {
  ALL_PROJECTS,
  projectsApi,
  useProjectUnreadCounts,
  useProjects,
  type Project,
} from "./projects";
import { isThreadDrag, readThreadDrag } from "./thread-drag";
import { toast } from "./toast";

function ProjectRow({
  project,
  selected,
  unread,
  onSelect,
}: {
  project: Project;
  selected: boolean;
  unread: number;
  onSelect: () => void;
}) {
  const [dropActive, setDropActive] = useState(false);
  const settled = project.status === "settled";
  const addDropped = (threads: { accountId: string; threadId: string }[]) => {
    console.log("[ProjectsSidebar:dropThreads]", { count: threads.length });
    projectsApi.addThreads(project.id, threads).then(
      () =>
        toast.success(
          threads.length === 1
            ? `Added to “${project.name}”`
            : `Added ${threads.length} conversations to “${project.name}”`,
        ),
      () => toast.error("Couldn't add to the project"),
    );
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <SkRow
          icon={
            settled ? <CircleCheckIcon className="size-4" /> : <FolderIcon className="size-4" />
          }
          title={project.name}
          selected={selected}
          badge={settled ? undefined : unread}
          dropActive={dropActive}
          onClick={onSelect}
          dragProps={{
            onDragOver: (e) => {
              if (!isThreadDrag(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDropActive(true);
            },
            onDragLeave: () => setDropActive(false),
            onDrop: (e) => {
              setDropActive(false);
              const payload = readThreadDrag(e.dataTransfer);
              if (!payload) return;
              e.preventDefault();
              addDropped(payload.threads);
            },
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          icon={settled ? undefined : <CircleCheckIcon />}
          onSelect={() =>
            void projectsApi.update(project.id, { status: settled ? "active" : "settled" })
          }
        >
          {settled ? "Reopen" : "Settle"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ProjectsSidebar({
  selectedLabelId,
  onSelectLabel,
  searchSelected,
  searchPending,
  onOpenSearch,
}: {
  /** ALL_PROJECTS, a project's id, or Search. */
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  searchSelected: boolean;
  searchPending: boolean;
  onOpenSearch: () => void;
}) {
  const projects = useProjects().data ?? [];
  const unread = useProjectUnreadCounts().data ?? {};
  const active = projects
    .filter((p) => p.status === "active")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const settled = projects
    .filter((p) => p.status === "settled")
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));
  const allUnread = active.reduce((sum, p) => sum + (unread[p.id] ?? 0), 0);
  const row = (project: Project) => (
    <ProjectRow
      key={project.id}
      project={project}
      selected={selectedLabelId === project.id}
      unread={unread[project.id] ?? 0}
      onSelect={() => onSelectLabel(project.id)}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 px-(--sidebar-content-inset) pb-2 pt-(--radius-xl)">
        <h2 className="flex h-9 items-center px-(--sidebar-row-content-inset) text-base font-semibold tracking-tight text-sidebar-foreground">
          Projects
        </h2>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 px-(--sidebar-content-inset)">
        <HintTooltip label="New project">
          <button
            type="button"
            onClick={() => requestNewProject({ open: true })}
            className={`${SIDEBAR_ROW} bg-sidebar-control-surface px-(--sidebar-row-content-inset) text-sidebar-foreground hover:bg-sidebar-row-hover`}
          >
            <FolderPlusIcon className="size-4 shrink-0 text-sidebar-muted-foreground group-hover:text-sidebar-foreground" />
            <span className="truncate">New project</span>
          </button>
        </HintTooltip>
        <SkRow
          icon={<SearchIcon className="size-4" />}
          title="Search"
          selected={searchSelected}
          dot={searchPending}
          onClick={onOpenSearch}
        />
      </div>

      <div className="min-h-0 flex-1 scroll-fade-y overflow-y-auto px-(--sidebar-content-inset) pb-8 pt-3">
        <SkRow
          icon={<FolderKanbanIcon className="size-4" />}
          title="All projects"
          selected={selectedLabelId === ALL_PROJECTS}
          badge={allUnread}
          onClick={() => onSelectLabel(ALL_PROJECTS)}
        />
        <Section
          title="Active"
          action={
            <SectionAddButton
              label="New project"
              onClick={() => requestNewProject({ open: true })}
            />
          }
        >
          {active.map(row)}
        </Section>
        {settled.length > 0 ? (
          <Section title="Settled" defaultOpen={false}>
            {settled.map(row)}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
