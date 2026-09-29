import type { ReactNode } from "react";
import { DropdownMenu as RadixMenu } from "radix-ui";
import {
  ChevronDownIcon,
  LayersIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelRightIcon,
} from "lucide-react";
import { IconBtn, HintTooltip, UnreadPill, cn, restoreFocusForKeyboardOnly } from "./ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { useAllAccountLabels } from "./hooks";
import { DropdownMenuSeparator } from "./menu";
import type { GmailAccount } from "./types";
import type { KeybindingCommand } from "../keybindings/commands";
import { shortcutLabelFor, useKeybindingsState } from "../keybindings/store";
import { useMailboxArrangement } from "../mailboxes";

/**
 * Every column owns the slice of the title band above it, so the pane
 * separators run all the way up. These pieces fill those slices: the window
 * title (traffic lights, sidebar toggle, wordmark), the mailbox breadcrumb,
 * and the right-hand controls.
 */

/**
 * The sidebar toggle, pinned at one window position (Otter Code's
 * SidebarControl): right of the traffic lights, whether the sidebar is open
 * or not. The bands under it leave room (`WindowTitle`, `TitlebarInset`).
 */
export function SidebarControl({
  sidebarOpen,
  onToggleSidebar,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="pointer-events-none fixed left-(--workspace-controls-left) top-0 z-40 flex h-(--workspace-topbar-height) items-center">
      <HintTooltip label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="sidebar.toggle">
        <IconBtn
          label="Toggle sidebar"
          className="no-drag pointer-events-auto"
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? (
            <PanelLeftCloseIcon className="size-4" />
          ) : (
            <PanelLeftIcon className="size-4" />
          )}
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

/**
 * The assistant panel toggle, pinned at the window's top-right. The rightmost
 * band (list, reader, draft, or the panel's own header) keeps a
 * `PanelControlSlot` where it sits.
 */
export function PanelControl({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="pointer-events-none fixed right-(--workspace-controls-right) top-0 z-40 flex h-(--workspace-topbar-height) items-center">
      <HintTooltip
        label={open ? "Hide assistant panel" : "Show assistant panel"}
        shortcut="assistant.toggle"
        side="bottom"
      >
        <IconBtn
          label="Toggle assistant panel"
          active={open}
          className="no-drag pointer-events-auto"
          onClick={onToggle}
        >
          <PanelRightIcon className="size-4" />
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

/** Room left in a band for the pinned panel toggle. */
export function PanelControlSlot() {
  return <span aria-hidden className="w-(--workspace-titlebar-control-size) shrink-0" />;
}

/** Room left at the start of the leftmost band (sidebar hidden): traffic lights + toggle. */
export function TitlebarInset() {
  // The band's own px-4 already covers 1rem of it.
  return (
    <span aria-hidden className="w-[calc(var(--workspace-titlebar-content-left)-1rem)] shrink-0" />
  );
}

/** The sidebar's title band: room for the traffic lights and pinned toggle, then the wordmark. */
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

/** Small square mark for a mailbox, like a project favicon in the breadcrumb. */
function MailboxMark({ account, className }: { account: GmailAccount | null; className?: string }) {
  if (!account) {
    return <LayersIcon className={cn("size-4 shrink-0", className)} aria-hidden />;
  }
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-bold leading-none text-white",
        className,
      )}
      style={{ background: getAccountColor(account) }}
      aria-hidden
    >
      {(getAccountDisplayName(account)[0] ?? "?").toUpperCase()}
    </span>
  );
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
function useInboxUnread(accounts: GmailAccount[]): Record<string, number> {
  const counts = Object.fromEntries(
    useAllAccountLabels(accounts.map((a) => a.id)).map(({ accountId, labels }) => [
      accountId,
      labels.find((l) => l.id === "INBOX")?.unread ?? 0,
    ]),
  );
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { ...counts, [COMBINED_ACCOUNT_ID]: total };
}

/**
 * Dia's profile dots for the sidebar's footer: one dot per mailbox, the
 * current one lit; click one to switch. Empty with a single mailbox.
 */
export function MailboxDots({
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
  if (options.length < 2) return <span className={className} />;
  return (
    <div role="tablist" aria-label="Mailboxes" className={cn("flex items-center", className)}>
      {options.map((option) => {
        const selected = option.id === selectedAccountId;
        return (
          <HintTooltip key={option.id} label={option.name} hint={option.shortcut}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={option.name}
              onClick={() => onSelectAccount(option.id)}
              className="group/dot flex size-5 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <span
                className={cn(
                  "size-2 rounded-full transition-colors",
                  selected
                    ? "bg-sidebar-foreground"
                    : "bg-sidebar-muted-foreground/40 group-hover/dot:bg-sidebar-muted-foreground/80",
                )}
              />
            </button>
          </HintTooltip>
        );
      })}
    </div>
  );
}

/**
 * Mailbox switcher, the sidebar's heading; aligned with the rows below it.
 * `children` are more items after the mailboxes (the sidebar's app menu).
 */
export function MailboxSwitcher({
  accounts,
  selectedAccountId,
  onSelectAccount,
  className,
  children,
}: {
  accounts: GmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  className?: string;
  children?: ReactNode;
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
          <span className="flex size-4 shrink-0 items-center justify-center">
            <MailboxMark account={selectedAccount} className="text-sidebar-muted-foreground" />
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
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <MailboxMark account={option.account} className="text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                <UnreadPill count={unread[option.id] ?? 0} />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {option.shortcut}
                </span>
              </RadixMenu.Item>
            );
          })}
          {children ? (
            <>
              <DropdownMenuSeparator className="bg-foreground/15" />
              {children}
            </>
          ) : null}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

/**
 * Right end of the content column's title band: room for the pinned
 * assistant toggle. Views that own the band (the reader) render it at the end
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
