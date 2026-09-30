import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { toast } from "./toast";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./menu";
import {
  InboxIcon,
  MailsIcon,
  StarIcon,
  SendIcon,
  FileIcon,
  BookmarkIcon,
  ArchiveXIcon,
  XIcon,
  Trash2Icon,
  PlusIcon,
  ChevronDownIcon,
  LayersIcon,
  TagIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  useLabels,
  useAddAccount,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  useModifyThread,
  useEmptyFolder,
  useViewUnreadCounts,
} from "./hooks";
import type { GmailLabel, MailView } from "./types";
import { COMBINED_ACCOUNT_ID, INBOX_VIEW_ID, useMailViews } from "./custom-views";
import { ALL_MAIL_LABEL_ID } from "./label-names";
import { buildLabelTree, type LabelTreeNode } from "./label-tree";
import {
  isMoveSourceLabel,
  isThreadDrag,
  readThreadDrag,
  type ThreadDragPayload,
} from "./thread-drag";
import { beginUndoGroup } from "./undo";
import { labelMoveName } from "../keybindings/commands";
import { renameLabelKeybindings, useKeybindingsState } from "../keybindings/store";
import { formatShortcut, parseShortcut } from "../keybindings/keys";
import { LabelShortcutDialog } from "../settings/keybindings-pane";
import { UnreadPill, HintTooltip } from "./ui";
import { SidebarTitle, useMailboxOptions } from "./top-bar";
import { getAccountDisplayName } from "./account-style";
import { useMailboxes } from "../mailboxes";
import { UpdateCard } from "../updates";
import { AddMailboxMenu } from "./add-mailbox";
import { useCapabilities } from "./capabilities";

const LABEL_DRAG_MIME = "application/x-gmail-label";

type LabelDragPayload = { id: string; name: string };

type RowDragProps = {
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragOver?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLButtonElement>) => void;
};

/** A sidebar row's box (Settings' nav mirrors it). */
const SIDEBAR_ROW =
  "group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg text-left text-sm font-normal outline-none transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active";

/** Gmail's labels API only accepts colors from its fixed palette. */
const GMAIL_LABEL_COLORS: { backgroundColor: string; textColor: string }[] = [
  { backgroundColor: "#fb4c2f", textColor: "#ffffff" },
  { backgroundColor: "#cc3a21", textColor: "#ffffff" },
  { backgroundColor: "#efa093", textColor: "#000000" },
  { backgroundColor: "#ff7537", textColor: "#ffffff" },
  { backgroundColor: "#ffad47", textColor: "#000000" },
  { backgroundColor: "#ffd6a2", textColor: "#000000" },
  { backgroundColor: "#fad165", textColor: "#000000" },
  { backgroundColor: "#fcda83", textColor: "#000000" },
  { backgroundColor: "#16a766", textColor: "#ffffff" },
  { backgroundColor: "#149e60", textColor: "#ffffff" },
  { backgroundColor: "#43d692", textColor: "#000000" },
  { backgroundColor: "#89d3b2", textColor: "#000000" },
  { backgroundColor: "#4a86e8", textColor: "#ffffff" },
  { backgroundColor: "#3c78d8", textColor: "#ffffff" },
  { backgroundColor: "#285bac", textColor: "#ffffff" },
  { backgroundColor: "#a4c2f4", textColor: "#000000" },
  { backgroundColor: "#a479e2", textColor: "#ffffff" },
  { backgroundColor: "#8e63ce", textColor: "#ffffff" },
  { backgroundColor: "#b99aff", textColor: "#000000" },
  { backgroundColor: "#f691b3", textColor: "#000000" },
  { backgroundColor: "#e07798", textColor: "#ffffff" },
  { backgroundColor: "#666666", textColor: "#ffffff" },
  { backgroundColor: "#999999", textColor: "#ffffff" },
  { backgroundColor: "#cccccc", textColor: "#000000" },
];

const SIDEBAR_SYSTEM_ORDER = [
  "INBOX",
  "STARRED",
  "SENT",
  "DRAFT",
  "IMPORTANT",
  ALL_MAIL_LABEL_ID,
  "SPAM",
  "TRASH",
];

const SYSTEM_LABEL_MAP: Record<string, { name: string; icon: ReactNode }> = {
  INBOX: { name: "Inbox", icon: <InboxIcon className="size-4" /> },
  STARRED: { name: "Starred", icon: <StarIcon className="size-4" /> },
  SENT: { name: "Sent", icon: <SendIcon className="size-4" /> },
  DRAFT: { name: "Drafts", icon: <FileIcon className="size-4" /> },
  IMPORTANT: { name: "Important", icon: <BookmarkIcon className="size-4" /> },
  [ALL_MAIL_LABEL_ID]: { name: "All Mail", icon: <MailsIcon className="size-4" /> },
  SPAM: { name: "Junk", icon: <ArchiveXIcon className="size-4" /> },
  TRASH: { name: "Trash", icon: <Trash2Icon className="size-4" /> },
};

function viewIcon(view: MailView): ReactNode {
  if (view.kind === "inbox") return <InboxIcon className="size-4" />;
  if (view.kind === "starred") return <StarIcon className="size-4" />;
  if (view.kind === "sent") return <SendIcon className="size-4" />;
  if (view.kind === "drafts") return <FileIcon className="size-4" />;
  if (view.kind === "important") return <BookmarkIcon className="size-4" />;
  if (view.kind === "allmail") return <MailsIcon className="size-4" />;
  if (view.kind === "junk") return <ArchiveXIcon className="size-4" />;
  if (view.kind === "trash") return <Trash2Icon className="size-4" />;
  return <LayersIcon className="size-4" />;
}

/** An open search, listed under the view it was started from. */
export type SidebarSearch = { id: string; parent: string; title: string; selected: boolean };

/** Renders a view's / label's open search row (if any) right below it. */
const SearchRowsContext = createContext<(parent: string, depth: number) => ReactNode>(() => null);

function SearchRows({ parent, depth = 0 }: { parent: string; depth?: number }) {
  return useContext(SearchRowsContext)(parent, depth);
}

function SearchRow({
  search,
  depth,
  onSelect,
  onClose,
}: {
  search: SidebarSearch;
  depth: number;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <SkRow
      icon={<SearchIcon className="size-4" />}
      title={search.title}
      depth={depth + 1}
      selected={search.selected}
      onClick={onSelect}
      trailing={
        <span
          role="button"
          tabIndex={-1}
          aria-label="Close search"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-sidebar-foreground"
        >
          <XIcon className="size-3.5" />
        </span>
      }
    />
  );
}

/** Sidebar row (Codex): 14px regular text, muted icon, a rounded pill on hover
    and when selected; counts live in the badge only. */
function SkRow({
  icon,
  title,
  selected,
  badge,
  trailing,
  depth = 0,
  onClick,
  dragProps,
  dropActive,
  dot,
}: {
  icon: ReactNode;
  title: string;
  selected?: boolean;
  badge?: number;
  trailing?: ReactNode;
  depth?: number;
  onClick?: () => void;
  dragProps?: RowDragProps;
  dropActive?: boolean;
  /** A small dot on the right: something is waiting here (a kept search). */
  dot?: boolean;
}) {
  const style: CSSProperties = { paddingLeft: 10 + depth * 16 };
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      {...dragProps}
      className={[
        SIDEBAR_ROW,
        "pr-(--sidebar-row-content-inset)",
        selected
          ? "bg-sidebar-row-selected text-sidebar-foreground"
          : "text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        dropActive ? "bg-sidebar-row-hover ring-1 ring-inset ring-primary/70" : "",
      ].join(" ")}
    >
      <span
        className={[
          "flex shrink-0 items-center",
          selected
            ? "text-sidebar-foreground"
            : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing ? (
        // One trailing slot: the count at rest, the row action on hover, so
        // the action never reserves dead space next to the count.
        <span className="relative ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
          {badge != null && badge > 0 ? (
            <span className="group-hover:invisible group-focus-within:invisible">
              <UnreadPill count={badge} selected={selected} />
            </span>
          ) : null}
          <span className="absolute inset-y-0 right-0 flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {trailing}
          </span>
        </span>
      ) : badge != null ? (
        <UnreadPill count={badge} selected={selected} />
      ) : dot ? (
        <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}

function Section({
  title,
  action,
  children,
  dropZone,
  tour,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  /** Its `data-tour` part, for the tour's spotlight. */
  tour?: string;
  dropZone?: {
    active: boolean;
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: ReactDragEvent<HTMLDivElement>) => void;
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
  };
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4" data-tour={tour}>
      <div
        className={[
          "group flex h-8 items-center gap-1 rounded-lg pr-1",
          dropZone?.active ? "bg-sidebar-row-hover ring-1 ring-inset ring-primary/70" : "",
        ].join(" ")}
        onDragOver={dropZone?.onDragOver}
        onDragLeave={dropZone?.onDragLeave}
        onDrop={dropZone?.onDrop}
      >
        {/* A plain muted heading (Codex's "Projects"); the chevron shows on
            hover, or while the section is collapsed. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 items-center gap-1 rounded-lg px-(--sidebar-row-content-inset) text-[13px] font-normal text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label={`Toggle ${title}`}
        >
          {title}
          <ChevronDownIcon
            className={[
              "size-3.5 transition-[opacity,transform]",
              open ? "opacity-0 group-hover:opacity-100" : "-rotate-90",
            ].join(" ")}
          />
        </button>
        <span className="flex-1" />
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </span>
      </div>
      {open ? children : null}
    </div>
  );
}

function SectionAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HintTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <PlusIcon className="size-4" />
      </button>
    </HintTooltip>
  );
}

/** "+ Add …" footer row for a section. */
function AddRow({ label, ...props }: { label: string } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={`${SIDEBAR_ROW} px-(--sidebar-row-content-inset) text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground`}
    >
      <PlusIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ViewRow({
  view,
  selected,
  unreadCount,
  onSelect,
  onEdit,
  onDelete,
  onReset,
}: {
  view: MailView;
  selected: boolean;
  unreadCount: number;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReset: () => void;
}): ReactNode {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <SkRow
          icon={viewIcon(view)}
          title={view.name}
          selected={selected}
          badge={unreadCount}
          onClick={() => {
            console.log("[AccountsSidebar:selectView]", { viewId: view.id });
            onSelect();
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon="pencil" onSelect={onEdit}>
          Edit view…
        </ContextMenuItem>
        <ContextMenuSeparator />
        {view.kind === "custom" ? (
          <ContextMenuItem icon="trash" color="red" onSelect={onDelete}>
            Delete view
          </ContextMenuItem>
        ) : (
          <ContextMenuItem icon="arrow.counterclockwise" onSelect={onReset}>
            Reset to default
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function labelIcon(label?: GmailLabel): ReactNode {
  const color = label?.color?.backgroundColor;
  if (color) {
    return <TagIcon className="size-4 fill-current" style={{ color }} />;
  }
  return <TagIcon className="size-4" />;
}

type LabelActions = {
  /** "label", or "folder" in a mailbox whose mail sits in one folder (IMAP). */
  noun: string;
  onRename: (label: GmailLabel) => void;
  /** Absent when the mailbox's labels have no colors. */
  onRecolor?: (label: GmailLabel) => void;
  onDelete: (label: GmailLabel) => void;
  onMove: (source: LabelDragPayload, targetParentName: string | null) => void;
  /** Conversations dropped from the message list; `keep` = ⌥ held (label only). */
  onDropThreads: (payload: ThreadDragPayload, label: GmailLabel, keep: boolean) => void;
  onEditShortcut: (label: GmailLabel) => void;
  /** The label's own move shortcut, formatted (⌘⇧1), if it has one. */
  shortcutFor: (label: GmailLabel) => string | undefined;
};

function LabelNode({
  node,
  depth,
  selectedLabelId,
  onSelectLabel,
  actions,
}: {
  node: LabelTreeNode;
  depth: number;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  actions: LabelActions;
}): ReactNode {
  const [open, setOpen] = useState(true);
  const [dropActive, setDropActive] = useState(false);
  const { label, children } = node;
  const unread = label?.unread && label.unread > 0 ? label.unread : 0;
  const hasChildren = children.length > 0;

  // Drag to nest: rows are both sources and targets. Drop payloads aren't
  // readable during dragover, so self/descendant checks happen on drop.
  // Conversations dragged from the list drop here too: moved to the label,
  // or only labelled with ⌥ held (Finder's copy modifier).
  const dragProps: RowDragProps | undefined = label
    ? {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.setData(
            LABEL_DRAG_MIME,
            JSON.stringify({ id: label.id, name: label.name } satisfies LabelDragPayload),
          );
          e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e) => {
          if (isThreadDrag(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
            setDropActive(true);
            return;
          }
          if (!e.dataTransfer.types.includes(LABEL_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropActive(true);
        },
        onDragLeave: () => setDropActive(false),
        onDrop: (e) => {
          setDropActive(false);
          const threads = readThreadDrag(e.dataTransfer);
          if (threads) {
            e.preventDefault();
            actions.onDropThreads(threads, label, e.altKey);
            return;
          }
          const raw = e.dataTransfer.getData(LABEL_DRAG_MIME);
          if (!raw) return;
          e.preventDefault();
          actions.onMove(JSON.parse(raw) as LabelDragPayload, label.name);
        },
      }
    : undefined;

  const row = (
    <SkRow
      icon={
        hasChildren ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={open ? `Collapse ${node.segment}` : `Expand ${node.segment}`}
            className="flex items-center"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            <ChevronDownIcon
              className={["size-4 transition-transform", open ? "" : "-rotate-90"].join(" ")}
            />
          </span>
        ) : (
          labelIcon(label)
        )
      }
      title={node.segment}
      depth={depth}
      selected={label ? selectedLabelId === label.id : false}
      badge={unread}
      dragProps={dragProps}
      dropActive={dropActive}
      onClick={
        label
          ? () => {
              console.log("[AccountsSidebar:selectLabel]", { labelId: label.id });
              onSelectLabel(label.id);
            }
          : () => setOpen((o) => !o)
      }
    />
  );

  return (
    <>
      {label ? (
        <ContextMenu>
          <ContextMenuTrigger>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem icon="pencil" onSelect={() => actions.onRename(label)}>
              Rename…
            </ContextMenuItem>
            {actions.onRecolor ? (
              <ContextMenuItem icon="paintpalette" onSelect={() => actions.onRecolor?.(label)}>
                Change color…
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              icon="keyboard"
              accelerator={actions.shortcutFor(label)}
              onSelect={() => actions.onEditShortcut(label)}
            >
              Keyboard shortcut…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon="trash" color="red" onSelect={() => actions.onDelete(label)}>
              Delete {actions.noun}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {label ? <SearchRows parent={label.id} depth={depth} /> : null}
      {open
        ? children.map((child) => (
            <LabelNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedLabelId={selectedLabelId}
              onSelectLabel={onSelectLabel}
              actions={actions}
            />
          ))
        : null}
    </>
  );
}

type AccountsSidebarProps = {
  /** Opens Settings → Views on a view ("new" to create one) for a mailbox. */
  onEditView: (viewId: string, mailbox: string | null) => void;
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  selectedLabelId: string;
  onSelectLabel: (labelId: string) => void;
  views: MailView[];
  onCompose: () => void;
  /** The Search mailbox is the one showing. */
  searchSelected: boolean;
  /** A search is kept (typed or run) — shown as a dot on the Search row. */
  searchPending: boolean;
  onOpenSearch: () => void;
  /** Searches opened from views (⌘F), nested under them. */
  searches: SidebarSearch[];
  onSelectSearch: (id: string) => void;
  onCloseSearch: (id: string) => void;
};

/**
 * The sidebar: its mailboxes' pages side by side (Dia's profiles) between the
 * title and the footer, in a horizontal scroller that snaps a page at a time.
 * The swipe is the platform's own scrolling: macOS follows the fingers,
 * carries the momentum, rubber-bands at the ends and settles on a page with
 * its own physics. Where it comes to rest picks the mailbox; the other
 * switches (the rail, ⌘1…) scroll there.
 */
export function AccountsSidebar(props: AccountsSidebarProps) {
  const { selectedAccountId, onSelectAccount } = props;
  const { accounts } = useMailboxes();
  const mailboxIds = useMailboxOptions(accounts).map((o) => o.id);
  const index = mailboxIds.indexOf(selectedAccountId ?? "");
  const pageIds = index < 0 ? [selectedAccountId ?? ""] : mailboxIds;

  const scroller = useRef<HTMLDivElement>(null);
  // The page the scroller is at (or heading to), so its own resting doesn't
  // pick a mailbox again, and a switch from elsewhere knows to scroll.
  const shown = useRef(-1);
  // Whether the user has moved the scroller since it last scrolled itself:
  // only then does where it rests pick a mailbox.
  const swiped = useRef(false);
  const onUserScroll = () => {
    swiped.current = true;
  };

  // A switch from elsewhere scrolls to its page (at once the first time).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || index < 0 || shown.current === index) return;
    const first = shown.current < 0;
    shown.current = index;
    swiped.current = false;
    el.scrollTo({ left: index * el.clientWidth, behavior: first ? "instant" : "smooth" });
  }, [index]);
  // Resizing the sidebar keeps the page in place.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (shown.current >= 0) el.scrollLeft = shown.current * el.clientWidth;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Where a swipe comes to rest picks the mailbox.
  const settleTimer = useRef(0);
  const settled = () => {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    const at = Math.round(el.scrollLeft / el.clientWidth);
    if (at === shown.current || !mailboxIds[at]) return;
    // Its own scroll cut short (a layout change re-snaps it): carry on.
    if (!swiped.current) {
      el.scrollTo({ left: shown.current * el.clientWidth, behavior: "smooth" });
      return;
    }
    shown.current = at;
    onSelectAccount(mailboxIds[at]);
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scrollend", settled);
    return () => el.removeEventListener("scrollend", settled);
  });

  return (
    <div className="flex h-full min-w-0 flex-col">
      <SidebarTitle />

      <div
        ref={scroller}
        onWheel={onUserScroll}
        onTouchStart={onUserScroll}
        onPointerDown={onUserScroll}
        onKeyDown={onUserScroll}
        // Where there's no scrollend (older Safari), a pause in scrolling stands in.
        onScroll={() => {
          window.clearTimeout(settleTimer.current);
          settleTimer.current = window.setTimeout(settled, 150);
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pageIds.map((id) => {
          const current = id === (selectedAccountId ?? "");
          return (
            <div key={id} className="h-full w-full shrink-0 snap-start snap-always">
              {current ? (
                <SidebarPage {...props} active />
              ) : (
                // Another mailbox as it looks once switched to: its inbox.
                <SidebarPage
                  {...props}
                  active={false}
                  selectedAccountId={id}
                  selectedLabelId={id === COMBINED_ACCOUNT_ID ? INBOX_VIEW_ID : "INBOX"}
                  searchSelected={false}
                  searchPending={false}
                  searches={[]}
                />
              )}
            </div>
          );
        })}
      </div>

      <UpdateCard />
    </div>
  );
}

/** One mailbox's page of the sidebar: its heading, rows, views and labels. */
function SidebarPage({
  active,
  onEditView,
  selectedAccountId,
  onSelectAccount,
  selectedLabelId,
  onSelectLabel,
  views,
  onCompose,
  searchSelected,
  searchPending,
  onOpenSearch,
  searches,
  onSelectSearch,
  onCloseSearch,
}: AccountsSidebarProps & {
  /** The page showing; a neighbor drawn during a swipe is inert. */
  active: boolean;
}) {
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  const labelsQuery = useLabels(isCombined ? null : selectedAccountId);
  const capabilities = useCapabilities(isCombined ? null : selectedAccountId);
  // Mail in one folder at a time (IMAP): its labels are folders.
  const labelNoun = capabilities.multipleLabels ? "Label" : "Folder";
  const addAccount = useAddAccount();
  const createLabel = useCreateLabel();

  const [createLabelOpen, setCreateLabelOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const updateLabel = useUpdateLabel();
  const deleteLabelMutation = useDeleteLabel();
  const [renameTarget, setRenameTarget] = useState<GmailLabel | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [colorTarget, setColorTarget] = useState<GmailLabel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GmailLabel | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const [shortcutTarget, setShortcutTarget] = useState<string | null>(null);
  // Empty Junk / Empty Trash, waiting for its confirmation.
  const [emptyTarget, setEmptyTarget] = useState<{
    labelId: "SPAM" | "TRASH";
    accountIds: string[];
  } | null>(null);
  const emptyFolder = useEmptyFolder();
  const modifyThread = useModifyThread();
  const { rules: keybindingRules } = useKeybindingsState();

  const { accounts } = useMailboxes();
  const account = accounts.find((a) => a.id === selectedAccountId);
  const mailboxName = isCombined
    ? "All mailboxes"
    : account
      ? getAccountDisplayName(account)
      : "Mailbox";
  const labels: GmailLabel[] = labelsQuery.data ?? [];
  // Views belong to one mailbox; each mailbox (account or Combined) lists its own.
  const countScope = isCombined ? accounts : accounts.filter((a) => a.id === selectedAccountId);
  const viewUnreadCounts = useViewUnreadCounts(views, countScope, true);
  const accountViews = isCombined
    ? []
    : views.filter((v) => v.kind === "custom" && v.mailbox === selectedAccountId);
  const combinedViews = views.filter(
    (v) => v.kind === "custom" && (v.mailbox ?? COMBINED_ACCOUNT_ID) === COMBINED_ACCOUNT_ID,
  );
  const { deleteView, resetView } = useMailViews();

  // Same order as the Combined built-in views. All Mail isn't a Gmail label
  // (archived mail just lacks INBOX), so it's listed without one — and, like
  // Gmail, without an unread badge.
  const allMail: GmailLabel = { id: ALL_MAIL_LABEL_ID, name: "All Mail", type: "system" };
  const systemLabels = [
    ...labels.filter((l) => l.type === "system" && l.id in SYSTEM_LABEL_MAP),
    allMail,
  ].sort((a, b) => SIDEBAR_SYSTEM_ORDER.indexOf(a.id) - SIDEBAR_SYSTEM_ORDER.indexOf(b.id));
  const userLabels = labels.filter((l) => l.type === "user");
  const userLabelTree = buildLabelTree(userLabels);

  const handleAddAccount = async () => {
    console.log("[AccountsSidebar:addAccount]");
    try {
      const account = await addAccount.mutateAsync();
      if (account) onSelectAccount(account.id);
    } catch (err) {
      toast.error("Couldn't add the account", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleCreateLabel = async () => {
    const name = newLabelName.trim();
    if (!name || !selectedAccountId) return;
    console.log("[AccountsSidebar:createLabel]", { name });
    try {
      await createLabel.mutateAsync({ accountId: selectedAccountId, name });
      toast.success(`Label "${name}" created`);
      setCreateLabelOpen(false);
      setNewLabelName("");
    } catch {
      toast.error("Failed to create label");
    }
  };

  const handleMoveLabel = (source: LabelDragPayload, targetParentName: string | null) => {
    if (!selectedAccountId) return;
    if (
      targetParentName &&
      (targetParentName === source.name || targetParentName.startsWith(`${source.name}/`))
    ) {
      toast.error("Can't nest a label inside itself");
      return;
    }
    const segment = source.name.split("/").pop() ?? source.name;
    const newName = targetParentName ? `${targetParentName}/${segment}` : segment;
    if (newName === source.name) return;
    console.log("[AccountsSidebar:moveLabel]", { from: source.name, to: newName });
    updateLabel
      .mutateAsync({ accountId: selectedAccountId, labelId: source.id, name: newName })
      .then(() => renameLabelKeybindings(source.name, newName))
      .catch(() => toast.error("Could not move the label"));
  };

  const handleRenameConfirm = () => {
    const name = renameValue.trim();
    const target = renameTarget;
    setRenameTarget(null);
    if (!target || !name || !selectedAccountId || name === target.name) return;
    console.log("[AccountsSidebar:renameLabel]", { from: target.name, to: name });
    updateLabel
      .mutateAsync({ accountId: selectedAccountId, labelId: target.id, name })
      .then(() => renameLabelKeybindings(target.name, name))
      .catch(() => toast.error("Could not rename the label"));
  };

  const handlePickColor = (color: { backgroundColor: string; textColor: string }) => {
    const target = colorTarget;
    setColorTarget(null);
    if (!target || !selectedAccountId) return;
    console.log("[AccountsSidebar:recolorLabel]", {
      label: target.name,
      color: color.backgroundColor,
    });
    updateLabel
      .mutateAsync({ accountId: selectedAccountId, labelId: target.id, color })
      .catch(() => toast.error("Could not change the color"));
  };

  const handleDeleteConfirm = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target || !selectedAccountId) return;
    if (selectedLabelId === target.id) onSelectLabel("INBOX");
    console.log("[AccountsSidebar:deleteLabel]", { label: target.name });
    deleteLabelMutation
      .mutateAsync({ accountId: selectedAccountId, labelId: target.id })
      .catch(() => toast.error("Could not delete the label"));
  };

  // Labels here belong to the open account, so only its conversations can
  // take them (a search may list other accounts' mail too).
  const handleDropThreads = (payload: ThreadDragPayload, label: GmailLabel, keep: boolean) => {
    const threads = payload.threads.filter((t) => t.accountId === selectedAccountId);
    if (threads.length === 0) {
      toast.error("Those conversations belong to another account");
      return;
    }
    const removeId =
      (!keep || !capabilities.multipleLabels) &&
      payload.fromLabelId &&
      isMoveSourceLabel(payload.fromLabelId, label.id)
        ? payload.fromLabelId
        : null;
    console.log("[AccountsSidebar:dropThreads]", {
      label: label.name,
      count: threads.length,
      from: removeId,
    });
    beginUndoGroup(threads.length);
    for (const t of threads) {
      void modifyThread.mutateAsync({
        accountId: t.accountId,
        threadId: t.threadId,
        addLabelIds: [label.id],
        removeLabelIds: removeId ? [removeId] : undefined,
      });
    }
    // The action toast ("Moved 3 conversations to “X”", with Undo) comes from
    // the undo registry.
  };

  const labelActions: LabelActions = {
    noun: labelNoun.toLowerCase(),
    onRename: (label) => {
      setRenameValue(label.name);
      setRenameTarget(label);
    },
    onRecolor: capabilities.labelColors ? (label) => setColorTarget(label) : undefined,
    onDelete: (label) => setDeleteTarget(label),
    onMove: handleMoveLabel,
    onDropThreads: handleDropThreads,
    onEditShortcut: (label) => setShortcutTarget(label.name),
    shortcutFor: (label) => {
      const rule = keybindingRules.find((r) => labelMoveName(r.command) === label.name);
      const shortcut = rule ? parseShortcut(rule.key) : null;
      return shortcut ? formatShortcut(shortcut) : undefined;
    },
  };

  // Settings live in this window: open the view editor directly rather than
  // round-tripping through the backend deep link.
  const openViewEditor = (viewId: string) => {
    onEditView(viewId, isCombined ? COMBINED_ACCOUNT_ID : selectedAccountId);
  };

  /** Right-click on Junk/Trash (a mailbox's own, or Combined's) → Empty…. */
  const withEmptyMenu = (row: ReactNode, labelId: string, accountIds: string[]) => {
    if ((labelId !== "SPAM" && labelId !== "TRASH") || accountIds.length === 0) return row;
    return (
      <ContextMenu>
        <ContextMenuTrigger>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            icon="trash"
            color="red"
            onSelect={() => setEmptyTarget({ labelId, accountIds })}
          >
            {labelId === "SPAM" ? "Empty Junk…" : "Empty Trash…"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };
  /** The folder a built-in Combined view shows, and the accounts in it. */
  const viewFolder = (view: MailView): { labelId: string; accountIds: string[] } => ({
    labelId: view.kind === "junk" ? "SPAM" : view.kind === "trash" ? "TRASH" : "",
    accountIds: view.rules
      ? [...new Set(view.rules.map((r) => r.accountId))]
      : accounts.map((a) => a.id),
  });

  const viewRow = (view: MailView) => (
    <Fragment key={view.id}>
      <ViewRow
        view={view}
        selected={selectedLabelId === view.id}
        unreadCount={viewUnreadCounts[view.id] ?? 0}
        onSelect={() => onSelectLabel(view.id)}
        onDelete={() => void deleteView(view.id)}
        onReset={() => void resetView(view.id)}
        onEdit={() => openViewEditor(view.id)}
      />
      <SearchRows parent={view.id} />
    </Fragment>
  );

  const renderSearchRows = (parent: string, depth: number) =>
    searches
      .filter((sr) => sr.parent === parent)
      .map((sr) => (
        <SearchRow
          key={sr.id}
          search={sr}
          depth={depth}
          onSelect={() => onSelectSearch(sr.id)}
          onClose={() => onCloseSearch(sr.id)}
        />
      ));

  return (
    <SearchRowsContext.Provider value={renderSearchRows}>
      <div className="flex h-full min-w-0 flex-col" inert={!active}>
        {/* The mailbox's name, the sidebar's heading (Codex's "Codex"), past
            the panel's rounded corner; the rail beside it switches. */}
        <div className="shrink-0 px-(--sidebar-content-inset) pb-2 pt-(--radius-xl)">
          <h2 className="flex h-9 items-center px-(--sidebar-row-content-inset) text-base font-semibold tracking-tight text-sidebar-foreground">
            <span className="truncate">{mailboxName}</span>
          </h2>
        </div>

        {/* New message (Codex's "New chat"), then Search, which is a mailbox:
            selecting it opens Gmail search in the list. */}
        <div
          className="flex shrink-0 flex-col gap-0.5 px-(--sidebar-content-inset)"
          data-tour={active ? "compose" : undefined}
        >
          <HintTooltip label="New message" shortcut="compose.new">
            <button
              type="button"
              onClick={onCompose}
              className={`${SIDEBAR_ROW} bg-sidebar-control-surface px-(--sidebar-row-content-inset) text-sidebar-foreground hover:bg-sidebar-row-hover`}
            >
              <SquarePenIcon className="size-4 shrink-0 text-sidebar-muted-foreground group-hover:text-sidebar-foreground" />
              <span className="truncate">New message</span>
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
          {isCombined ? (
            <>
              {views
                .filter((v) => v.kind !== "custom")
                .map((view) => (
                  <Fragment key={view.id}>
                    {withEmptyMenu(
                      <SkRow
                        icon={viewIcon(view)}
                        title={view.name}
                        selected={selectedLabelId === view.id}
                        badge={viewUnreadCounts[view.id] ?? 0}
                        onClick={() => {
                          console.log("[AccountsSidebar:selectView]", { viewId: view.id });
                          onSelectLabel(view.id);
                        }}
                      />,
                      viewFolder(view).labelId,
                      viewFolder(view).accountIds,
                    )}
                    <SearchRows parent={view.id} />
                  </Fragment>
                ))}

              <Section
                title="Views"
                tour={active ? "views" : undefined}
                action={<SectionAddButton label="Add view" onClick={() => openViewEditor("new")} />}
              >
                {combinedViews.map(viewRow)}
              </Section>
            </>
          ) : (
            <>
              {(labels.length > 0
                ? systemLabels.map((l) => ({
                    id: l.id,
                    unread: l.unread ?? 0,
                    total: l.total ?? 0,
                  }))
                : Object.keys(SYSTEM_LABEL_MAP).map((id) => ({ id, unread: 0, total: 0 }))
              ).map(({ id, unread, total }) => {
                const meta = SYSTEM_LABEL_MAP[id];
                if (!meta) return null;
                // Drafts is a raw count of drafts, not an unread signal.
                const isDrafts = id === "DRAFT";
                return (
                  <Fragment key={id}>
                    {withEmptyMenu(
                      <SkRow
                        icon={meta.icon}
                        title={meta.name}
                        selected={selectedLabelId === id}
                        badge={isDrafts ? total : unread}
                        onClick={() => {
                          console.log("[AccountsSidebar:selectLabel]", { labelId: id });
                          onSelectLabel(id);
                        }}
                      />,
                      id,
                      selectedAccountId ? [selectedAccountId] : [],
                    )}
                    <SearchRows parent={id} />
                  </Fragment>
                );
              })}

              <Section
                title="Views"
                tour={active ? "views" : undefined}
                action={<SectionAddButton label="Add view" onClick={() => openViewEditor("new")} />}
              >
                {accountViews.map(viewRow)}
              </Section>

              {selectedAccountId ? (
                <Section
                  title={`${labelNoun}s`}
                  action={
                    <SectionAddButton
                      label={`Add ${labelNoun.toLowerCase()}`}
                      onClick={() => setCreateLabelOpen(true)}
                    />
                  }
                  dropZone={{
                    active: rootDropActive,
                    onDragOver: (e) => {
                      if (!e.dataTransfer.types.includes(LABEL_DRAG_MIME)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setRootDropActive(true);
                    },
                    onDragLeave: () => setRootDropActive(false),
                    onDrop: (e) => {
                      setRootDropActive(false);
                      const raw = e.dataTransfer.getData(LABEL_DRAG_MIME);
                      if (!raw) return;
                      e.preventDefault();
                      handleMoveLabel(JSON.parse(raw) as LabelDragPayload, null);
                    },
                  }}
                >
                  {userLabelTree.map((node) => (
                    <LabelNode
                      key={node.key}
                      node={node}
                      depth={0}
                      selectedLabelId={selectedLabelId}
                      onSelectLabel={onSelectLabel}
                      actions={labelActions}
                    />
                  ))}
                </Section>
              ) : null}

              {accounts.length === 0 ? (
                <AddMailboxMenu
                  onGmail={() => void handleAddAccount()}
                  onAdded={(account) => onSelectAccount(account.id)}
                >
                  <AddRow label="Add mailbox" />
                </AddMailboxMenu>
              ) : null}
            </>
          )}
        </div>

        <Dialog
          open={createLabelOpen}
          onOpenChange={setCreateLabelOpen}
          title={`New ${labelNoun}`}
          confirmLabel="Create"
          confirmVariant="accent"
          confirmDisabled={!newLabelName.trim() || createLabel.isPending}
          onConfirm={handleCreateLabel}
        >
          <Field label="Name" orientation="vertical">
            <Input
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="e.g. 04 Follow-up"
              autoFocus
            />
          </Field>
        </Dialog>

        <Dialog
          open={renameTarget != null}
          onOpenChange={(o) => {
            if (!o) setRenameTarget(null);
          }}
          title={`Rename ${labelNoun}`}
          confirmLabel="Rename"
          confirmVariant="accent"
          confirmDisabled={!renameValue.trim()}
          onConfirm={handleRenameConfirm}
        >
          <Field label="Name" orientation="vertical">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="e.g. 90 Ops/alerts"
              autoFocus
            />
          </Field>
          <Text variant="mini" color="tertiary">
            Use / to nest, e.g. "90 Ops/alerts". Nested labels move along.
          </Text>
        </Dialog>

        <Dialog
          open={colorTarget != null}
          onOpenChange={(o) => {
            if (!o) setColorTarget(null);
          }}
          title={colorTarget ? `Color for "${colorTarget.name.split("/").pop()}"` : "Label Color"}
        >
          <div className="grid grid-cols-8 gap-2 py-1">
            {GMAIL_LABEL_COLORS.map((color) => (
              <button
                key={color.backgroundColor}
                type="button"
                aria-label={`Use ${color.backgroundColor}`}
                onClick={() => handlePickColor(color)}
                className={[
                  "size-6 rounded-full",
                  colorTarget?.color?.backgroundColor === color.backgroundColor
                    ? "ring-2 ring-accent ring-offset-1"
                    : "hover:ring-2 hover:ring-input",
                ].join(" ")}
                style={{ backgroundColor: color.backgroundColor }}
              />
            ))}
          </div>
        </Dialog>

        <Dialog
          open={deleteTarget != null}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
          title={`Delete ${labelNoun}`}
          confirmLabel="Delete"
          confirmVariant="accent"
          onConfirm={handleDeleteConfirm}
        >
          <Text variant="small">
            {capabilities.multipleLabels
              ? `Delete "${deleteTarget?.name}"? It is removed from every message; the messages themselves and any nested labels are kept.`
              : `Delete "${deleteTarget?.name}"? Its mail moves to Archive.`}
          </Text>
        </Dialog>

        <LabelShortcutDialog labelName={shortcutTarget} onClose={() => setShortcutTarget(null)} />

        <Dialog
          open={emptyTarget != null}
          onOpenChange={(o) => {
            if (!o) setEmptyTarget(null);
          }}
          title={emptyTarget?.labelId === "TRASH" ? "Empty Trash" : "Empty Junk"}
          confirmLabel={emptyTarget?.labelId === "TRASH" ? "Empty Trash" : "Empty Junk"}
          confirmVariant="destructive"
          onConfirm={() => {
            const target = emptyTarget;
            setEmptyTarget(null);
            if (target) emptyFolder.mutate(target);
          }}
        >
          <Text variant="small">
            Permanently delete every message in{" "}
            {emptyTarget?.labelId === "TRASH" ? "Trash" : "Junk"}
            {emptyTarget && emptyTarget.accountIds.length > 1
              ? ` for all ${emptyTarget.accountIds.length} accounts`
              : ""}
            ? This can't be undone.
          </Text>
        </Dialog>
      </div>
    </SearchRowsContext.Provider>
  );
}
