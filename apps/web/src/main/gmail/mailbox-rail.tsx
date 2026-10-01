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
import { AccountPicture } from "./account-picture";
import { AddMailboxMenu, readableError } from "./add-mailbox";
import { useAddAccount } from "./hooks";
import { useInboxUnread, useMailboxOptions } from "./top-bar";
import type { GmailAccount } from "./types";
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
 * The rail down the window's left edge (ChatGPT's): the mailboxes, a dot on
 * those with unread mail in the Inbox, then Projects, then who you are at the
 * bottom, with the app's menu. It stays when the sidebar hides, so switching
 * mailboxes never needs the sidebar.
 */
export function MailboxRail({
  accounts,
  selectedAccountId,
  onSelectAccount,
  settingsOpen,
  onOpenSettings,
  onSync,
  syncing,
}: {
  accounts: GmailAccount[];
  /** The mailbox showing (or Projects, PROJECTS_MAILBOX); none is lit while Settings is. */
  selectedAccountId: string | null;
  /** A mailbox, or PROJECTS_MAILBOX. */
  onSelectAccount: (accountId: string) => void;
  settingsOpen: boolean;
  /** The app's menu: Settings (a pane, General by default) and Sync now. */
  onOpenSettings: (pane?: SettingsPane) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const options = useMailboxOptions(accounts);
  const unread = useInboxUnread(accounts);
  const projectsUnread = Object.values(useProjectUnreadCounts().data ?? {}).some((n) => n > 0);
  const projectsSelected = !settingsOpen && selectedAccountId === PROJECTS_MAILBOX;
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

  return (
    <nav
      aria-label="Mailboxes"
      data-app-sidebar=""
      className="flex w-(--workspace-rail-width) shrink-0 flex-col items-center pb-(--sidebar-content-inset) text-sidebar-foreground"
    >
      {/* Under the title band, and past the panel's rounded corner: level with
          the sidebar's heading. */}
      <div aria-hidden className="drag-region h-(--workspace-topbar-height) w-full shrink-0" />
      <div className="mt-(--radius-xl) flex flex-col items-center gap-1" data-tour="mailbox">
        {options.map((option) => {
          const selected = !settingsOpen && option.id === selectedAccountId;
          return (
            <HintTooltip key={option.id} label={option.name} hint={option.shortcut} side="right">
              <button
                type="button"
                aria-label={option.name}
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelectAccount(option.id)}
                className={cn(RAIL_BUTTON, selected && RAIL_BUTTON_SELECTED)}
              >
                {option.account ? (
                  <AccountPicture
                    account={option.account}
                    className="size-6 rounded-md text-[11px]"
                  />
                ) : (
                  <LayersIcon className="size-5" />
                )}
                {(unread[option.id] ?? 0) > 0 ? (
                  <span
                    aria-hidden
                    className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-sidebar-foreground"
                  />
                ) : null}
              </button>
            </HintTooltip>
          );
        })}
        <HintTooltip label="Add mailbox" side="right">
          <AddMailboxMenu
            onGmail={() => void handleAddGmail()}
            onAdded={(account) => onSelectAccount(account.id)}
          >
            <button type="button" aria-label="Add mailbox" className={RAIL_BUTTON}>
              <PlusIcon className="size-4.5" />
            </button>
          </AddMailboxMenu>
        </HintTooltip>
        {/* Projects span every mailbox: a place of their own, after them. */}
        <span aria-hidden className="my-1 h-px w-5 bg-border" />
        <HintTooltip label="Projects" side="right">
          <button
            type="button"
            aria-label="Projects"
            aria-current={projectsSelected ? "page" : undefined}
            onClick={() => onSelectAccount(PROJECTS_MAILBOX)}
            className={cn(RAIL_BUTTON, projectsSelected && RAIL_BUTTON_SELECTED)}
          >
            <FolderKanbanIcon className="size-5" />
            {projectsUnread ? (
              <span
                aria-hidden
                className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-sidebar-foreground"
              />
            ) : null}
          </button>
        </HintTooltip>
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
