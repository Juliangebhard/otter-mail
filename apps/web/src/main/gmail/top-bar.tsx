import type { ReactNode } from "react";
import { DropdownMenu as RadixMenu } from "radix-ui";
import { useRouter, type RouterHistory } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import {
  ArchiveXIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FileIcon,
  FolderIcon,
  FolderClosedIcon,
  InboxIcon,
  LayersIcon,
  MailIcon,
  MailsIcon,
  SendIcon,
  Settings2Icon,
  StarIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { IconBtn, HintTooltip, UnreadPill, cn, restoreFocusForKeyboardOnly } from "./ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";
import { getAccountDisplayName } from "./account-style";
import { AccountPicture } from "./account-picture";
import { useAllAccountLabels } from "./hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./menu";
import { useRecentlyViewed, type RecentIcon } from "../recently-viewed";
import type { GmailAccount } from "./types";
import type { KeybindingCommand } from "../keybindings/commands";
import { shortcutLabelFor, useKeybindingsState } from "../keybindings/store";
import { features } from "../features";
import { useMailboxArrangement } from "../mailboxes";

/**
 * Every column owns the slice of the title band above it, so the pane
 * separators run all the way up. These pieces fill those slices: the window
 * title (traffic lights, sidebar toggle, wordmark), the mailbox breadcrumb,
 * and the right-hand controls.
 */

/**
 * Where history can go: the router gives each entry its index, and a push
 * drops everything ahead of it. Tracked from the first HistoryControls on,
 * which mount with the window.
 */
let trackedHistory: RouterHistory | null = null;
let furthestIndex = 0;

function trackHistory(history: RouterHistory): void {
  if (trackedHistory === history) return;
  trackedHistory = history;
  furthestIndex = history.location.state.__TSR_index;
  history.subscribe(({ location, action }) => {
    const index = location.state.__TSR_index;
    furthestIndex = action.type === "PUSH" ? index : Math.max(furthestIndex, index);
  });
}

const RECENT_ICONS: Record<RecentIcon, typeof InboxIcon> = {
  inbox: InboxIcon,
  starred: StarIcon,
  sent: SendIcon,
  drafts: FileIcon,
  important: BookmarkIcon,
  allmail: MailsIcon,
  junk: ArchiveXIcon,
  trash: Trash2Icon,
  custom: LayersIcon,
  label: TagIcon,
  conversation: MailIcon,
  settings: Settings2Icon,
  project: FolderIcon,
  projects: FolderClosedIcon,
};

/** The clock: where you've been lately (recently-viewed.ts), to go back to in one click. */
function RecentlyViewedMenu() {
  const { navigate } = useRouter();
  const places = useRecentlyViewed();
  return (
    <DropdownMenu>
      <HintTooltip label="Recently viewed">
        <DropdownMenuTrigger asChild>
          <IconBtn label="Recently viewed" className="no-drag pointer-events-auto">
            <ClockIcon className="size-4" />
          </IconBtn>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="start" className="w-[26rem]">
        <DropdownMenuLabel>Recently viewed</DropdownMenuLabel>
        {places.length === 0 ? (
          <p className="px-2.5 pb-2 pt-1 text-sm text-muted-foreground">
            Conversations and mailboxes you open show up here.
          </p>
        ) : (
          places.map((place) => {
            const Icon = RECENT_ICONS[place.icon] ?? MailIcon;
            return (
              <DropdownMenuItem
                key={place.href}
                onSelect={() => void navigate({ href: place.href })}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-muted-foreground">
                    {place.context}
                  </span>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{place.title}</span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Recently viewed, back and forward through the mailboxes, conversations and
 * Settings pages you've been to (Linear's), in the Mac app, where no browser
 * offers them: after the pinned sidebar toggle.
 */
export function HistoryControls() {
  const { history } = useRouter();
  trackHistory(history);
  const where = useSyncExternalStore(history.subscribe, () => {
    const index = history.location.state.__TSR_index;
    return `${index > 0 ? "back" : ""} ${index < furthestIndex ? "forward" : ""}`;
  });
  if (!features.historyButtons) return null;
  return (
    <div className="flex items-center gap-1">
      <RecentlyViewedMenu />
      <HintTooltip label="Back">
        <IconBtn
          label="Back"
          className="no-drag pointer-events-auto"
          disabled={!where.includes("back")}
          onClick={() => history.back()}
        >
          <ChevronLeftIcon className="size-4" />
        </IconBtn>
      </HintTooltip>
      <HintTooltip label="Forward">
        <IconBtn
          label="Forward"
          className="no-drag pointer-events-auto"
          disabled={!where.includes("forward")}
          onClick={() => history.forward()}
        >
          <ChevronRightIcon className="size-4" />
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

/**
 * The sidebar and agent panel toggles' icon: ChatGPT's and Linear's soft
 * frame, in Lucide's strokes so it sits with the rest. The pane is filled
 * while it's open, a thin bar while it's closed.
 */
export function PaneIcon({
  side,
  open,
  className,
}: {
  side: "left" | "right";
  open: boolean;
  className?: string;
}) {
  const x = side === "left" ? 8 : 16;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3" y="4" width="18" height="16" rx="4" />
      {open ? (
        <rect
          x={x - 1.5}
          y="7.5"
          width="3"
          height="9"
          rx="1"
          fill="currentColor"
          strokeWidth="1.5"
        />
      ) : (
        <path d={`M${x} 8v8`} strokeWidth="1.5" />
      )}
    </svg>
  );
}

/**
 * The sidebar toggle and back/forward, pinned at one window position (Otter
 * Code's SidebarControl, ChatGPT's): right of the traffic lights, whether the
 * sidebar is open or not, so nothing moves when it opens or closes. The
 * bands under them leave room (`SidebarTitle`, `TitlebarInset`).
 */
export function SidebarControl({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="pointer-events-none fixed left-(--workspace-controls-left) top-0 z-40 flex h-(--workspace-topbar-height) items-center gap-1">
      <HintTooltip label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="sidebar.toggle">
        <IconBtn
          label="Toggle sidebar"
          className="no-drag pointer-events-auto"
          onClick={onToggleSidebar}
        >
          <PaneIcon side="left" open={sidebarOpen} className="size-4" />
        </IconBtn>
      </HintTooltip>
      <HistoryControls />
    </div>
  );
}

/**
 * The agent panel toggle, pinned at the window's top-right. The rightmost
 * band (list, reader, draft, or the panel's own header) keeps a
 * `PanelControlSlot` where it sits.
 */
export function PanelControl({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="pointer-events-none fixed right-(--workspace-controls-right) top-0 z-40 flex h-(--workspace-topbar-height) items-center">
      <HintTooltip
        label={open ? "Hide agent panel" : "Show agent panel"}
        shortcut="agent.toggle"
        side="bottom"
      >
        <IconBtn
          label="Toggle agent panel"
          className="no-drag pointer-events-auto"
          onClick={onToggle}
        >
          <PaneIcon side="right" open={open} className="size-4" />
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

/** Room left in a band for the pinned panel toggle. */
export function PanelControlSlot() {
  return <span aria-hidden className="w-(--workspace-titlebar-control-size) shrink-0" />;
}

/**
 * Room left at the start of the band next to the rail (sidebar hidden) for
 * what sits over it: traffic lights, toggle, arrows.
 */
export function TitlebarInset() {
  // The band's own px-4 already covers 1rem of it, and the rail its width.
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0",
        features.historyButtons
          ? "w-[max(0px,calc(var(--workspace-titlebar-content-left)+var(--workspace-history-controls-width)-1rem-var(--workspace-rail-width)))]"
          : "w-[max(0px,calc(var(--workspace-titlebar-content-left)-1rem-var(--workspace-rail-width)))]",
      )}
    />
  );
}

/** The setup's title band: room for the traffic lights, then the wordmark. */
export function WindowTitle({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "drag-region flex h-(--workspace-topbar-height) shrink-0 items-center pl-(--workspace-titlebar-content-left) pr-3",
        className,
      )}
    >
      {/* Wordmark in Otter Code's style: brand word, then the product muted. */}
      <span className="inline-flex min-w-0 select-none items-baseline gap-1 whitespace-nowrap text-sm font-medium tracking-tight">
        <span className="text-foreground">Otter</span>
        <span className="truncate text-muted-foreground">Mail</span>
      </span>
    </div>
  );
}

/**
 * The sidebar's title band in the main window: the traffic lights, the
 * pinned toggle and back/forward sit over it.
 */
export function SidebarTitle() {
  return <div className="drag-region h-(--workspace-topbar-height) shrink-0" />;
}

/** Round mark for a mailbox: the account's picture, or its initial; layers for All mailboxes. */
function MailboxMark({
  account,
  iconClassName,
}: {
  account: GmailAccount | null;
  iconClassName?: string;
}) {
  if (!account) {
    return <LayersIcon className={cn("size-4.5 shrink-0", iconClassName)} aria-hidden />;
  }
  return <AccountPicture account={account} className="size-4.5 text-[9px]" />;
}

type MailboxOption = { id: string; account: GmailAccount | null; name: string; shortcut: string };

/** The mailboxes to switch between, in ⌘1… order: All mailboxes (when on), then each account. */
export function useMailboxOptions(accounts: GmailAccount[]): MailboxOption[] {
  const { resolved: keybindings } = useKeybindingsState();
  const combined = useMailboxArrangement().combined && accounts.length > 1;
  const jump = (digit: number) =>
    shortcutLabelFor(keybindings, `mailbox.jump.${digit}` as KeybindingCommand) ?? "";
  return [
    ...(combined
      ? [{ id: COMBINED_ACCOUNT_ID, account: null, name: "All mailboxes", shortcut: jump(1) }]
      : []),
    ...accounts.map((account, i) => ({
      id: account.id,
      account,
      name: getAccountDisplayName(account),
      shortcut: jump(combined ? i + 2 : i + 1),
    })),
  ];
}

/** Unread in each mailbox's Inbox (as its sidebar shows it), and their sum for All mailboxes. */
export function useInboxUnread(accounts: GmailAccount[]): Record<string, number> {
  const counts = Object.fromEntries(
    useAllAccountLabels(accounts.map((a) => a.id)).map(({ accountId, labels }) => [
      accountId,
      labels.find((l) => l.id === "INBOX")?.unread ?? 0,
    ]),
  );
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { ...counts, [COMBINED_ACCOUNT_ID]: total };
}

/** Mailbox switcher, the menu-bar popover's heading. */
export function MailboxSwitcher({
  accounts,
  selectedAccountId,
  onSelectAccount,
  className,
}: {
  accounts: GmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  className?: string;
}) {
  const options = useMailboxOptions(accounts);
  const unread = useInboxUnread(accounts);
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;
  const selectedAccount = isCombined
    ? null
    : (accounts.find((a) => a.id === selectedAccountId) ?? null);
  const mailboxName = isCombined
    ? "All mailboxes"
    : selectedAccount
      ? getAccountDisplayName(selectedAccount)
      : "Mailbox";
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Switch mailbox"
          className={cn(
            "group/switcher flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-(--sidebar-row-content-inset) text-left text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-sidebar-row-hover",
            className,
          )}
        >
          <span className="flex size-4.5 shrink-0 items-center justify-center">
            <MailboxMark account={selectedAccount} iconClassName="text-sidebar-muted-foreground" />
          </span>
          {/* A heading, like Codex's "Codex ⌄": the name, then its chevron. */}
          <span className="min-w-0 truncate text-base font-semibold tracking-tight">
            {mailboxName}
          </span>
          <ChevronDownIcon
            className="size-4 shrink-0 text-sidebar-muted-foreground transition-transform group-data-[state=open]/switcher:rotate-180"
            aria-hidden
          />
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="start"
          sideOffset={4}
          onCloseAutoFocus={restoreFocusForKeyboardOnly}
          className="dropdown-glass z-[130] w-(--radix-dropdown-menu-trigger-width) min-w-52 rounded-lg p-1 text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
        >
          {options.map((option) => {
            const selected = option.id === (selectedAccountId ?? "");
            return (
              <RadixMenu.Item
                key={option.id}
                onSelect={() => onSelectAccount(option.id)}
                className={cn(
                  "flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 text-sm outline-none data-[highlighted]:bg-accent-surface data-[highlighted]:text-foreground",
                  selected && "bg-foreground/[0.08]",
                )}
              >
                <span className="flex size-4.5 shrink-0 items-center justify-center">
                  <MailboxMark account={option.account} iconClassName="text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <UnreadPill count={unread[option.id] ?? 0} />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {option.shortcut}
                </span>
              </RadixMenu.Item>
            );
          })}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

/**
 * Right end of the content column's title band: room for the pinned
 * agent toggle. Views that own the band (the reader) render it at the end
 * of their own header.
 */
export function TitleTrailing({ showPanelToggle }: { showPanelToggle: boolean }) {
  return <>{showPanelToggle ? <PanelControlSlot /> : null}</>;
}

/** Title band of the content column: optional breadcrumb, sync status, trailing controls. */
export function TitleControls({
  leading,
  syncing,
  syncLabel,
  showPanelToggle,
}: {
  leading?: ReactNode;
  syncing: boolean;
  syncLabel: string;
  showPanelToggle: boolean;
}) {
  return (
    <div
      data-toolbar=""
      className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-3 px-4"
    >
      {leading}
      {syncing ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary animate-status-pulse"
            aria-hidden
          />
          <span className="max-w-64 truncate text-xs text-muted-foreground">{syncLabel}</span>
        </div>
      ) : null}
      <span className="min-w-0 flex-1" />
      <TitleTrailing showPanelToggle={showPanelToggle} />
    </div>
  );
}
