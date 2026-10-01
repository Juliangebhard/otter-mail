import {
  CircleUserRoundIcon,
  FolderKanbanIcon,
  LayersIcon,
  LogInIcon,
  MessageSquareIcon,
  PlusIcon,
  RotateCwIcon,
  SettingsIcon,
} from "lucide-react";
import { toast } from "./toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./menu";
import { HintTooltip, cn } from "./ui";
import type { ReactNode } from "react";
import { AccountPicture } from "./account-picture";
import { AddMailboxMenu, readableError } from "./add-mailbox";
import { useAddAccount, useViewUnreadCounts } from "./hooks";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./menu";
import { useInboxUnread, useMailboxOptions } from "./top-bar";
import type { GmailAccount, MailView } from "./types";
import type { SettingsPane } from "./api";
import { useOtterAccount } from "../otter-account";
import { OtterAvatar } from "../settings/otter-account-pane";
import { requestProblemReport } from "../support/report-problem";
import { PROJECTS_MAILBOX, useProjectUnreadCounts } from "./projects";

/** A rail button: a square that lights up on hover, and stays lit where you are. */
const RAIL_BUTTON =
  "relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-sidebar-row-hover";
const RAIL_BUTTON_SELECTED = "bg-sidebar-row-selected text-sidebar-foreground";

/**
 * The rail down the window's left edge (ChatGPT's): the spaces. Each mailbox
 * (a dot when its Inbox has unread mail), each view (its list alone), then
 * Projects; who you are at the bottom, with the app's menu. It stays when the
 * sidebar hides. Hovering a mailbox or Projects peeks at its sidebar
 * (`onHoverSpace`), to go somewhere in it without switching first.
 */
export function MailboxRail({
  accounts,
  views,
  onEditView,
  onHoverSpace,
  selectedAccountId,
  onSelectAccount,
  settingsOpen,
  onOpenSettings,
  onSync,
  syncing,
}: {
  accounts: GmailAccount[];
  /** The custom views, each a space. */
  views: MailView[];
  /** Settings' editor for one ("new" makes one). */
  onEditView: (viewId: string) => void;
  /**
   * The space under the pointer, if it has a sidebar to peek at; null when it
   * leaves. Absent while the sidebar shows: the rail has tooltips instead.
   */
  onHoverSpace?: (spaceId: string | null) => void;
  /** The space showing (a mailbox, a view or PROJECTS_MAILBOX); none is lit while Settings is. */
  selectedAccountId: string | null;
  onSelectAccount: (spaceId: string) => void;
  settingsOpen: boolean;
  /** The app's menu: Settings (a pane, General by default) and Sync now. */
  onOpenSettings: (pane?: SettingsPane) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const options = useMailboxOptions(accounts);
  const unread = useInboxUnread(accounts);
  const viewUnread = useViewUnreadCounts(views, accounts);
  const projectsUnread = Object.values(useProjectUnreadCounts().data ?? {}).some((n) => n > 0);
  const addAccount = useAddAccount();

  const handleAddGmail = async () => {
    console.log("[MailboxRail:addAccount]");
    try {
      const account = await addAccount.mutateAsync();
      if (account) onSelectAccount(account.id);
    } catch (err) {
      toast.error("Couldn't add the account", { description: readableError(err) });
    }
  };

  /** A space's square: lit where you are, a dot for unread mail; named by a tooltip unless it peeks. */
  const spaceButton = (
    id: string,
    name: string,
    mark: ReactNode,
    dot: boolean,
    peek: boolean,
    extra?: { tour?: string; shortcut?: string },
  ) => {
    const selected = !settingsOpen && id === selectedAccountId;
    const peeks = peek && onHoverSpace != null;
    const button = (
      <button
        type="button"
        aria-label={name}
        aria-current={selected ? "page" : undefined}
        data-tour={extra?.tour}
        onClick={() => onSelectAccount(id)}
        onMouseEnter={() => onHoverSpace?.(peeks ? id : null)}
        onDragEnter={() => onHoverSpace?.(peeks ? id : null)}
        className={cn(RAIL_BUTTON, selected && RAIL_BUTTON_SELECTED)}
      >
        {mark}
        {dot ? (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-sidebar-foreground"
          />
        ) : null}
      </button>
    );
    return peek && !peeks ? (
      <HintTooltip label={name} hint={extra?.shortcut} side="right">
        {button}
      </HintTooltip>
    ) : (
      button
    );
  };

  return (
    <nav
      aria-label="Spaces"
      data-app-sidebar=""
      onMouseLeave={() => onHoverSpace?.(null)}
      className="flex w-(--workspace-rail-width) shrink-0 flex-col items-center pb-(--sidebar-content-inset) text-sidebar-foreground"
    >
      {/* Under the title band, and past the panel's rounded corner: level with
          the sidebar's heading. */}
      <div aria-hidden className="drag-region h-(--workspace-topbar-height) w-full shrink-0" />
      <div className="mt-(--radius-xl) flex flex-col items-center gap-1" data-tour="mailbox">
        {/* Mailboxes peek at their sidebars, which name them, while the
            sidebar is collapsed; otherwise a tooltip names them. */}
        {options.map((option) => (
          <span key={option.id} className="contents">
            {spaceButton(
              option.id,
              option.name,
              option.account ? (
                <AccountPicture
                  account={option.account}
                  className="size-6 rounded-md text-[11px]"
                />
              ) : (
                <LayersIcon className="size-5" />
              ),
              (unread[option.id] ?? 0) > 0,
              true,
              { shortcut: option.shortcut },
            )}
          </span>
        ))}
        <HintTooltip label="Add mailbox or view" side="right">
          <AddMailboxMenu
            onGmail={() => void handleAddGmail()}
            onAdded={(account) => onSelectAccount(account.id)}
            onView={() => onEditView("new")}
          >
            <button
              type="button"
              aria-label="Add mailbox or view"
              onMouseEnter={() => onHoverSpace?.(null)}
              className={RAIL_BUTTON}
            >
              <PlusIcon className="size-4.5" />
            </button>
          </AddMailboxMenu>
        </HintTooltip>
        {views.length > 0 ? <span aria-hidden className="my-1 h-px w-5 bg-border" /> : null}
        {views.map((view) => (
          <ContextMenu key={view.id}>
            <ContextMenuTrigger>
              <HintTooltip label={view.name} side="right">
                {spaceButton(
                  view.id,
                  view.name,
                  <span className="flex size-6 items-center justify-center rounded-md border border-sidebar-muted-foreground/40 text-[11px] font-semibold uppercase leading-none">
                    {view.name.trim()[0] ?? "?"}
                  </span>,
                  (viewUnread[view.id] ?? 0) > 0,
                  false,
                )}
              </HintTooltip>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onEditView(view.id)}>Edit view…</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        {/* Projects span every mailbox: a space of their own, after them. */}
        <span aria-hidden className="my-1 h-px w-5 bg-border" />
        {spaceButton(
          PROJECTS_MAILBOX,
          "Projects",
          <FolderKanbanIcon className="size-5" />,
          projectsUnread,
          true,
          { tour: "projects" },
        )}
      </div>
      <span className="flex-1" />
      <AccountMenu
        active={settingsOpen}
        onOpenSettings={onOpenSettings}
        onSync={onSync}
        syncing={syncing}
      />
    </nav>
  );
}

/**
 * The rail's foot: the Otter account (or a placeholder when signed out),
 * opening the app's menu: the account (or Sign in), Settings, feedback, and
 * Sync now (only while push isn't live; ⌘, and ⌘R work either way).
 */
function AccountMenu({
  active,
  onOpenSettings,
  onSync,
  syncing,
}: {
  /** Settings is showing. */
  active: boolean;
  onOpenSettings: (pane?: SettingsPane) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const otter = useOtterAccount();
  const user = otter?.user ?? null;
  return (
    <DropdownMenu>
      <HintTooltip label={user ? (user.name ?? user.email) : "Settings"} side="right">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account and settings"
            className={cn(RAIL_BUTTON, active && RAIL_BUTTON_SELECTED)}
          >
            {user ? (
              <OtterAvatar user={user} className="size-6" />
            ) : (
              <CircleUserRoundIcon className="size-5" />
            )}
          </button>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent side="right" align="end" className="min-w-56">
        {user ? (
          <DropdownMenuItem
            icon={<OtterAvatar user={user} className="size-5" />}
            onSelect={() => onOpenSettings("otter")}
            className="h-auto py-1.5"
          >
            <span className="block truncate text-foreground">{user.name ?? user.email}</span>
            {user.name ? (
              <span className="block truncate text-[13px] text-muted-foreground">{user.email}</span>
            ) : null}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem icon={<LogInIcon />} onSelect={() => onOpenSettings("otter")}>
            Sign in to Otter Mail
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<SettingsIcon />}
          accelerator="⌘,"
          onSelect={() => onOpenSettings()}
        >
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem icon={<MessageSquareIcon />} onSelect={requestProblemReport}>
          Send feedback
        </DropdownMenuItem>
        {otter?.realtime === "live" ? null : (
          <DropdownMenuItem
            icon={<RotateCwIcon className={syncing ? "animate-spin" : undefined} />}
            accelerator="⌘R"
            disabled={syncing}
            onSelect={onSync}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
