import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EmptyState } from "~/components/ui/empty-state";
import { useQueryClient } from "@tanstack/react-query";
import { toast, type ToastId } from "./gmail/toast";
import { setDraftOpener } from "./gmail/undo-send";
import { AccountsSidebar } from "./gmail/accounts-sidebar";
import { MessageList } from "./gmail/message-list";
import { MessageReader } from "./gmail/message-reader";
import { NewMessageView } from "./gmail/new-message-view";
import { CommandPalette } from "./gmail/command-palette";
import { AgentChatPanel } from "./gmail/agent-chat";
import { SEARCH_MAILBOX } from "./gmail/gmail-query";
import { searchTabId, searchTitle, type SearchTab } from "./gmail/search-tabs";
import {
  PanelControl,
  SidebarControl,
  TitleControls,
  TitleTrailing,
  TitlebarInset,
  WindowTitle,
} from "./gmail/top-bar";
import { SettingsPage, type SettingsRoute } from "./settings/settings-page";
import { SettingsNav } from "./settings/settings-nav";
import { isTypingTarget } from "./gmail/keyboard";
import { cn } from "./gmail/ui";
import { usePanelAnimationSettings, usePanelPresence } from "./panel-animations";
import {
  keybindingContext,
  useCommandHandlers,
  useKeybindingContext,
  useKeybindingDispatcher,
} from "./keybindings/dispatch";
import { MAILBOX_JUMP_COMMANDS } from "./keybindings/commands";
import {
  useAccounts,
  useAccountSync,
  useGlobalSyncStatus,
  useGmailWriteFailureToasts,
  useExternalMailChanges,
  useModifyMessage,
  useModifyThread,
  useTrashMessage,
  useTrashThread,
  useUntrashThread,
  useUntrashMessage,
} from "./gmail/hooks";
import {
  beginUndoGroup,
  onUndoableAction,
  quietParams,
  registerRedo,
  takeRedo,
  takeUndo,
  type UndoAction,
} from "./gmail/undo";
import { getAccountColor, getAccountContrastColor } from "./gmail/account-style";
import { gmailApi, type MailtoTarget } from "./gmail/api";
import type { QuoteContext } from "./gmail/chat-context";
import type { GmailMessageSummary } from "./gmail/types";
import {
  useMailViews,
  resolveRules,
  loadLastLocation,
  saveLastLocation,
  COMBINED_ACCOUNT_ID,
  INBOX_VIEW_ID,
  SENT_VIEW_ID,
  STARRED_VIEW_ID,
  DRAFTS_VIEW_ID,
  ALL_MAIL_VIEW_ID,
} from "./gmail/custom-views";
import { ALL_MAIL_LABEL_ID } from "./gmail/label-names";
import { useMonochromeTheme } from "./theme/apply-theme";
import { useMailboxes } from "./mailboxes";
import { offerWhatsNew } from "./changelog";
import { SetupFlow } from "./onboarding/setup";
import { Tour } from "./onboarding/tour";
import {
  endTour,
  getSetupStage,
  markSetUp,
  offerTour,
  useSetupStage,
  useTourRequested,
} from "./onboarding/onboarding";

/** Narrowest the reader gets when the chat panel is dragged wider. */
const READER_MIN_WIDTH = 360;

/** A place the user was at, for the top-bar back/forward buttons. */
type NavLoc = {
  accountId: string | null;
  labelId: string;
  messageId: string | null;
  readerAccountId: string | null;
};

/**
 * Drag-resizable pane width persisted to localStorage. `room` (when given)
 * caps the width at drag start so neighbouring panes keep their minimum.
 */
function useStoredWidth(
  key: string,
  def: number,
  min: number,
  max: number,
  dir: 1 | -1 = 1,
  room?: () => number,
) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : def;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  // The pane element itself, resized imperatively during a drag.
  const paneRef = useRef<HTMLDivElement>(null);
  // The animated frame around a collapsible pane: follows the drag with its
  // open/close transition switched off.
  const frameRef = useRef<HTMLDivElement>(null);

  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const cap = Math.max(min, Math.min(max, room ? room() : max));
    let latest = startW;
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (paneRef.current) paneRef.current.style.width = `${latest}px`;
      if (frameRef.current) frameRef.current.style.width = `${latest}px`;
    };
    const move = (ev: PointerEvent) => {
      // dir -1: right-side panes grow when the handle drags left.
      latest = Math.min(cap, Math.max(min, startW + dir * (ev.clientX - startX)));
      // Drive the drag through the DOM only — calling setWidth on every
      // pointermove re-renders the whole HomeView tree (message list, reader,
      // chat) each frame, which is what made resizing slow and shaky. Batch the
      // style write to one per frame and commit to React state once, on release.
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (raf) cancelAnimationFrame(raf);
      apply();
      if (frameRef.current) frameRef.current.style.transitionProperty = "";
      widthRef.current = latest;
      setWidth(latest);
      localStorage.setItem(key, String(latest));
    };
    if (frameRef.current) frameRef.current.style.transitionProperty = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { width, start, paneRef, frameRef };
}

function PaneResizer({ onPointerDown }: { onPointerDown: (e: ReactPointerEvent) => void }) {
  // Zero-width in the layout: panes meet on a tone change (or their own faint
  // divider), and the grab area is an invisible strip centered on the seam
  // that shows a hairline on hover (no-drag, so it resizes instead of moving
  // the window inside the title band).
  return (
    <div className="relative z-20 w-0 shrink-0" aria-hidden>
      <div
        onPointerDown={onPointerDown}
        className="no-drag group absolute inset-y-0 -left-[3px] flex w-1.5 cursor-col-resize justify-center"
      >
        <div className="w-px transition-colors group-hover:bg-input" />
      </div>
    </div>
  );
}

/**
 * Codex-style window chrome: the window wears the sidebar's surface (and
 * grain), so the sidebar and the title band read as one frame, and the
 * content columns share one inset panel (canvas) that starts under the title
 * band, with a rounded top-left corner and a faint top/left edge. The panes
 * themselves are transparent: their title bands sit on the frame, their
 * bodies on the panel.
 */
const PANE = "min-h-0 overflow-hidden";
const PANE_SIDEBAR = `${PANE} text-sidebar-foreground`;
/** Faint full-height dividers, through the title band (ChatGPT): on the
    list's right, the chat's left. */
const PANE_LIST = `${PANE} relative after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:top-0 after:w-px after:bg-border/70`;
const PANE_MAIN = PANE;
const PANE_CHAT = `${PANE} relative before:pointer-events-none before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-border/70`;
/** Clips a collapsible pane while its width animates open or closed (Otter
    Code's panel animations); the pane keeps its width so nothing reflows. */
const PANE_FRAME =
  "flex min-h-0 shrink-0 overflow-hidden [[data-panel-animations=true]_&]:transition-[width] [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out";

/**
 * The main window: the setup while there's no mailbox yet (or until it's
 * finished), else mail. The setup stands in for the whole view, so none of
 * mail's shortcuts run under it.
 */
export function HomeView() {
  const accountsQuery = useAccounts();
  const stage = useSetupStage();
  const loaded = !accountsQuery.isLoading;
  if (loaded && ((accountsQuery.data ?? []).length === 0 || stage === "setup")) {
    return <SetupFlow />;
  }
  return <MailHome />;
}

function MailHome() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string>("INBOX");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  // One message picked from an expanded conversation in the list: the reader
  // shows just that message. Tied to the row it came from, so it lapses as
  // soon as the selection moves anywhere else.
  const [focusedMessage, setFocusedMessage] = useState<{ rowId: string; id: string } | null>(null);
  const focusedMessageId =
    focusedMessage && focusedMessage.rowId === selectedMessageId ? focusedMessage.id : null;
  useEffect(() => {
    if (focusedMessage && focusedMessage.rowId !== selectedMessageId) setFocusedMessage(null);
  }, [focusedMessage, selectedMessageId]);
  // Account that owns the currently-open message (differs per row in combined views).
  const [readerAccountId, setReaderAccountId] = useState<string | null>(null);
  // Open searches, each a sidebar row: the top Search row (all mail) and one
  // per view it was started from (⌘F there). They keep their query and any
  // unrun text while you visit other mailboxes; × or Escape closes them.
  const [searchTabs, setSearchTabs] = useState<SearchTab[]>([]);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  // mailto: target from the OS (OtterMail as default mail app). The seq keys
  // NewMessageView so a link arriving while the composer is open re-seeds it.
  const [mailtoPrefill, setMailtoPrefill] = useState<MailtoTarget | null>(null);
  const [mailtoSeq, setMailtoSeq] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // In-app settings page; null = mail. Opened from the sidebar footer, ⌘,
  // (menu accelerator → backend broadcast), or any window's deep link.
  const [settingsRoute, setSettingsRoute] = useState<SettingsRoute | null>(null);
  const settingsRouteRef = useRef(settingsRoute);
  settingsRouteRef.current = settingsRoute;
  useEffect(() => {
    const pull = async () => {
      try {
        const target = await gmailApi.getSettingsTarget();
        if (!target) return;
        console.log("[HomeView:openSettings]", { pane: target.pane });
        setSettingsRoute({
          pane: target.pane,
          viewId: target.viewId ?? null,
          mailbox: target.mailbox ?? null,
        });
      } catch (error) {
        console.log("[HomeView:getSettingsTarget] failed", { error: String(error) });
      }
    };
    void pull();
    return window.desktopBridge.on("settings:open", () => void pull());
  }, []);

  // ⌘W (File ▸ Close): the agent's active chat tab closes first; with no
  // tab left to close, the window does (Otter Code).
  const closeChatTabRef = useRef<(() => boolean) | null>(null);
  useEffect(
    () =>
      window.desktopBridge.on("window:closeRequest", () => {
        if (closeChatTabRef.current?.()) return;
        void gmailApi.closeMainWindow();
      }),
    [],
  );
  // Escape leaves settings (blurring a focused field first, like a dialog).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !settingsRouteRef.current) return;
      if (isTypingTarget(e)) {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      e.preventDefault();
      setSettingsRoute(null);
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, []);
  const [initialized, setInitialized] = useState(false);

  const accountsQuery = useAccounts();
  const { views } = useMailViews();

  // The mailboxes shown: turned-on accounts, in the user's order (Settings →
  // Mailboxes, synced with the Otter account).
  const mailboxes = useMailboxes();
  const accounts = mailboxes.accounts;
  const accountIds = accounts.map((a) => a.id);
  const firstRealAccountId = accounts[0]?.id ?? null;

  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID && mailboxes.combined;

  const globalSync = useGlobalSyncStatus(accountIds);
  useGmailWriteFailureToasts();
  useExternalMailChanges();

  const sidebarPane = useStoredWidth("gmail:pane:sidebar", 256, 224, 400);
  const listPane = useStoredWidth("gmail:pane:list", 400, 300, 640);
  // The chat can grow wide, as long as the reader keeps READER_MIN_WIDTH.
  const chatPane = useStoredWidth(
    "gmail:pane:chat",
    340,
    280,
    900,
    -1,
    () =>
      window.innerWidth - (sidebarOpen ? sidebarPane.width : 0) - listPane.width - READER_MIN_WIDTH,
  );
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("gmail:chat-open") === "1");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("gmail:sidebar-open") !== "0",
  );
  // Entering or leaving Settings swaps panes in place rather than animating them.
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings(settingsRoute ? "settings" : "mail");
  const chatVisible = chatOpen && !settingsRoute;
  const sidebarPresent = usePanelPresence(
    sidebarOpen,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const chatPresent = usePanelPresence(
    chatVisible,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      localStorage.setItem("gmail:sidebar-open", open ? "0" : "1");
      return !open;
    });
  };
  // Rows multi-selected in the list, surfaced to the chat panel's context chip.
  const [chatSelection, setChatSelection] = useState<GmailMessageSummary[]>([]);
  const toggleChat = () => {
    setChatOpen((open) => {
      localStorage.setItem("gmail:chat-open", open ? "0" : "1");
      return !open;
    });
  };
  const closeChat = () => {
    localStorage.setItem("gmail:chat-open", "0");
    setChatOpen(false);
    setPendingQuote(null);
  };
  const openChat = () => {
    localStorage.setItem("gmail:chat-open", "1");
    setChatOpen(true);
  };
  // Getting started. A device whose mail was already here skips the setup,
  // and is offered the tour, once.
  useEffect(() => {
    if (accountsQuery.isLoading || accounts.length === 0 || getSetupStage()) return;
    markSetUp();
    offerTour();
  }, [accountsQuery.isLoading, accounts.length]);
  // Just updated: say so once, with the way to What's new.
  useEffect(() => {
    void offerWhatsNew(() => setSettingsRoute({ pane: "changelog", viewId: null, mailbox: null }));
  }, []);
  // The tour walks the mail view: out of Settings and the composer, with the sidebar showing.
  const tourRequested = useTourRequested();
  useEffect(() => {
    if (!tourRequested) return;
    setSettingsRoute(null);
    setComposeOpen(false);
    if (!sidebarOpen) toggleSidebar();
  }, [tourRequested]);

  // A highlighted excerpt handed from the reader to the chat panel (one-shot).
  const [pendingQuote, setPendingQuote] = useState<QuoteContext | null>(null);

  // MessageList fills this each render; reader archive/trash advance through it.
  const advanceRef = useRef<(fromMessageId: string) => boolean>(() => false);
  const handleReaderAdvance = () => {
    if (!selectedMessageId || !advanceRef.current(selectedMessageId)) {
      setSelectedMessageId(null);
      setReaderAccountId(null);
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘1 = Combined mailbox, ⌘2…⌘9 = accounts in rail order. The ref is
  // populated below once handleSelectAccount exists.
  const accountSwitchRef = useRef<{
    ids: string[];
    combined: boolean;
    select: (id: string) => void;
  }>({ ids: [], combined: false, select: () => {} });

  const undoModifyMessage = useModifyMessage();
  const undoModifyThread = useModifyThread();
  const undoUntrashThread = useUntrashThread();
  const undoUntrashMessage = useUntrashMessage();
  const redoTrashThread = useTrashThread();
  const redoTrashMessage = useTrashMessage();
  const undoRunner = useRef<(action: UndoAction) => void>(() => {});
  const redoRunner = useRef<() => boolean>(() => false);
  // An undo runs quietly (quietParams: no undo or toast of its own). A redo is
  // the action again: it registers its undo and shows its toast, so a bulk
  // redo regroups to announce itself once.
  const runAction = (action: UndoAction, quiet: boolean): Promise<unknown> => {
    const params = <T extends object>(p: T) => (quiet ? quietParams(p) : p);
    switch (action.kind) {
      case "modifyMessage":
        return undoModifyMessage.mutateAsync(params(action.params));
      case "modifyThread":
        return undoModifyThread.mutateAsync(params(action.params));
      case "untrashThread":
        return undoUntrashThread.mutateAsync(params(action.params));
      case "untrashMessage":
        return undoUntrashMessage.mutateAsync(params(action.params));
      case "trashThread":
        return redoTrashThread.mutateAsync(params(action.params));
      case "trashMessage":
        return redoTrashMessage.mutateAsync(params(action.params));
      case "callback":
        action.run();
        return Promise.resolve();
      case "batch":
        if (!quiet) beginUndoGroup(action.actions.length);
        return Promise.all(action.actions.map((a) => runAction(a, quiet)));
    }
  };
  // ⌘Z / ⇧⌘Z (Edit › Undo and Redo in the app menu): text undo while typing,
  // else the mail action, like z and ⇧Z.
  useEffect(() => {
    const onEdit = (native: "edit:nativeUndo" | "edit:nativeRedo", run: () => void) => () => {
      const context = keybindingContext();
      if (context.editableFocus) {
        void window.desktopBridge.invoke(native);
        return;
      }
      if (context.dialogOpen) return;
      run();
    };
    const offUndo = window.desktopBridge.on(
      "edit:undo",
      onEdit("edit:nativeUndo", () => {
        const action = takeUndo();
        if (action) undoRunner.current(action);
      }),
    );
    const offRedo = window.desktopBridge.on(
      "edit:redo",
      onEdit("edit:nativeRedo", () => redoRunner.current()),
    );
    return () => {
      offUndo();
      offRedo();
    };
  }, []);
  // Each action's toast, stacked; undoing an action (z or its Undo) closes it.
  const actionToasts = useRef(new Map<UndoAction, ToastId>());
  undoRunner.current = (action) => {
    console.log("[HomeView:undo]", {
      kind: action.kind,
      count: action.kind === "batch" ? action.actions.length : 1,
    });
    const toastId = actionToasts.current.get(action);
    if (toastId) toast.close(toastId);
    actionToasts.current.delete(action);
    runAction(action, true).then(
      () => {
        registerRedo(action);
        // Callbacks (e.g. holding back a send) say what happened themselves.
        if (action.kind !== "callback") toast.success("Undone");
      },
      () => toast.error("Could not undo"),
    );
  };
  redoRunner.current = () => {
    const action = takeRedo();
    if (!action) return false;
    console.log("[HomeView:redo]", {
      kind: action.kind,
      count: action.kind === "batch" ? action.actions.length : 1,
    });
    runAction(action, false).catch(() => toast.error("Could not redo"));
    return true;
  };
  useEffect(
    () =>
      onUndoableAction((title, action) => {
        // This toast undoes this action only, whatever came after it.
        const toastId = toast.success(title, {
          action: {
            label: "Undo",
            onClick: () => {
              if (!takeUndo(action)) {
                actionToasts.current.delete(action);
                toast.info("That can no longer be undone");
                return;
              }
              undoRunner.current(action);
            },
          },
          onRemove: () => actionToasts.current.delete(action),
        });
        actionToasts.current.set(action, toastId);
      }),
    [],
  );

  // Keyboard commands (Settings › Keybindings; defaults in keybindings/commands.ts).
  useKeybindingDispatcher();
  useKeybindingContext("settingsOpen", settingsRoute !== null);
  useKeybindingContext("messageOpen", selectedMessageId !== null);
  const goTo = (combinedViewId: string, labelId: string) => {
    setSelectedLabelId(isCombined ? combinedViewId : labelId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };
  const jumpToMailbox = (digit: number) => {
    const { ids, combined, select } = accountSwitchRef.current;
    // ⌘1 = All mailboxes when it's on, then the accounts in sidebar order.
    const target = combined ? (digit === 1 ? COMBINED_ACCOUNT_ID : ids[digit - 2]) : ids[digit - 1];
    if (!target) return false;
    select(target);
  };
  useCommandHandlers({
    "commandPalette.toggle": () => setPaletteOpen((o) => !o),
    "sidebar.toggle": () => toggleSidebar(),
    "agent.toggle": () => toggleChat(),
    "search.focus": () => searchFromView(),
    "compose.new": () => setComposeOpen(true),
    "keybindings.show": () =>
      setSettingsRoute({ pane: "keybindings", viewId: null, mailbox: null }),
    "mail.undo": () => {
      const action = takeUndo();
      if (!action) return false;
      undoRunner.current(action);
    },
    "mail.redo": () => redoRunner.current(),
    "go.inbox": () => goTo(INBOX_VIEW_ID, "INBOX"),
    "go.sent": () => goTo(SENT_VIEW_ID, "SENT"),
    "go.starred": () => goTo(STARRED_VIEW_ID, "STARRED"),
    "go.drafts": () => goTo(DRAFTS_VIEW_ID, "DRAFT"),
    "go.allMail": () => goTo(ALL_MAIL_VIEW_ID, ALL_MAIL_LABEL_ID),
    "message.close": () => {
      setSelectedMessageId(null);
      setReaderAccountId(null);
    },
    ...Object.fromEntries(
      MAILBOX_JUMP_COMMANDS.map((command, i) => [command, () => jumpToMailbox(i + 1)]),
    ),
  });

  // Once accounts are known, restore the last location or apply the default
  // (Combined when 2+ accounts, else the first account).
  useEffect(() => {
    if (initialized || accountsQuery.isLoading || accounts.length === 0) return;
    const canCombined = mailboxes.combined;
    const saved = loadLastLocation();
    let acct: string | null = null;
    let label = "INBOX";
    if (saved) {
      if (saved.accountId === COMBINED_ACCOUNT_ID && canCombined) {
        acct = COMBINED_ACCOUNT_ID;
        label = saved.labelId;
      } else if (accounts.some((a) => a.id === saved.accountId)) {
        acct = saved.accountId;
        label = saved.labelId;
      }
    }
    if (!acct) {
      if (canCombined) {
        acct = COMBINED_ACCOUNT_ID;
        label = INBOX_VIEW_ID;
      } else {
        acct = firstRealAccountId;
        label = "INBOX";
      }
    }
    setSelectedAccountId(acct);
    setSelectedLabelId(label);
    setInitialized(true);
  }, [initialized, accountsQuery.isLoading, accounts, firstRealAccountId, mailboxes.combined]);

  // Persist where the user is so we can reopen here next launch.
  useEffect(() => {
    if (!initialized || !selectedAccountId) return;
    // The Search mailbox isn't a place to reopen into.
    if (selectedLabelId === SEARCH_MAILBOX) return;
    saveLastLocation({ accountId: selectedAccountId, labelId: selectedLabelId });
  }, [initialized, selectedAccountId, selectedLabelId]);

  // ── Back/forward navigation history (top bar) ────────────────────────────
  const [nav, setNav] = useState<{ stack: NavLoc[]; idx: number }>({ stack: [], idx: -1 });
  const navigatingRef = useRef(false);
  useEffect(() => {
    if (!initialized) return;
    if (navigatingRef.current) {
      navigatingRef.current = false;
      return;
    }
    const loc: NavLoc = {
      accountId: selectedAccountId,
      labelId: selectedLabelId,
      messageId: selectedMessageId,
      readerAccountId,
    };
    setNav((h) => {
      const cur = h.stack[h.idx];
      if (
        cur &&
        cur.accountId === loc.accountId &&
        cur.labelId === loc.labelId &&
        cur.messageId === loc.messageId
      ) {
        return h;
      }
      const stack = [...h.stack.slice(Math.max(0, h.idx - 98), h.idx + 1), loc];
      return { stack, idx: stack.length - 1 };
    });
  }, [initialized, selectedAccountId, selectedLabelId, selectedMessageId, readerAccountId]);

  const applyNavLoc = (loc: NavLoc) => {
    navigatingRef.current = true;
    setSelectedAccountId(loc.accountId);
    setSelectedLabelId(loc.labelId);
    setSelectedMessageId(loc.messageId);
    setReaderAccountId(loc.readerAccountId);
  };
  const goBack = () => {
    if (nav.idx <= 0) return;
    console.log("[HomeView:navBack]");
    applyNavLoc(nav.stack[nav.idx - 1]);
    setNav({ ...nav, idx: nav.idx - 1 });
  };
  const goForward = () => {
    if (nav.idx >= nav.stack.length - 1) return;
    console.log("[HomeView:navForward]");
    applyNavLoc(nav.stack[nav.idx + 1]);
    setNav({ ...nav, idx: nav.idx + 1 });
  };

  // ⌘[ / ⌘] and the mouse back/forward buttons drive the same history as the
  // header arrows. Latest closures via ref so the listeners mount once.
  const navActionsRef = useRef({ back: goBack, forward: goForward });
  navActionsRef.current = { back: goBack, forward: goForward };
  useEffect(() => {
    // The menu accelerators (main/index.ts "Go") broadcast these; a DOM
    // keydown never arrives for ⌘[/⌘] because the webview consumes it.
    const unsubBack = window.desktopBridge.on("nav:back", () => navActionsRef.current.back());
    const unsubForward = window.desktopBridge.on("nav:forward", () =>
      navActionsRef.current.forward(),
    );
    const mouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navActionsRef.current.back();
      } else if (e.button === 4) {
        e.preventDefault();
        navActionsRef.current.forward();
      }
    };
    window.addEventListener("mouseup", mouse);
    return () => {
      unsubBack();
      unsubForward();
      window.removeEventListener("mouseup", mouse);
    };
  }, []);

  // mailto: links (default mail app): pull the pending target on mount (cold
  // start) and whenever the backend broadcasts one, then open the composer
  // prefilled.
  useEffect(() => {
    const pull = async () => {
      const target = await gmailApi.takePendingMailto();
      if (!target) return;
      console.log("[HomeView:mailto]", { to: target.to });
      setMailtoPrefill(target);
      setMailtoSeq((n) => n + 1);
      setComposeOpen(true);
    };
    void pull();
    const unsub = window.desktopBridge.on("compose:mailto", () => void pull());
    return unsub;
  }, []);

  // A conversation clicked in the menu-bar popover, or a new-mail
  // notification, opens here, in the reader.
  const openFromTrayRef = useRef<(accountId: string, messageId: string) => void>(() => {});
  useEffect(() => {
    const pull = async () => {
      const target = await gmailApi.takePendingOpenMessage().catch(() => null);
      if (!target) return;
      console.log("[HomeView:openFromTray]", { messageId: target.messageId });
      openFromTrayRef.current(target.accountId, target.messageId);
    };
    void pull();
    return window.desktopBridge.on("mail:open", () => void pull());
  }, []);

  const effectiveAccountId = isCombined
    ? COMBINED_ACCOUNT_ID
    : selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : firstRealAccountId;

  // If the selected view disappears (deleted, or it has no rules for the
  // active account), fall back to Inbox.
  useEffect(() => {
    if (selectedLabelId === SEARCH_MAILBOX) return;
    if (isCombined) {
      if (!views.some((v) => v.id === selectedLabelId)) {
        setSelectedLabelId(INBOX_VIEW_ID);
      }
      return;
    }
    const view = views.find((v) => v.id === selectedLabelId);
    if (!view) return; // plain label
    if (view.mailbox !== effectiveAccountId) {
      setSelectedLabelId("INBOX");
    }
  }, [isCombined, views, selectedLabelId, effectiveAccountId]);

  // Local-first: keep the on-disk cache synced in the background. Combined mode
  // refreshes all accounts via its own list handler (sentinel isn't a real account).
  useAccountSync(isCombined ? null : effectiveAccountId);

  // Per-account branding: the primary (send, unread dot, focus ring) and the
  // accent take the active account's color; selection surfaces stay
  // neutral (Combined keeps the default blue). Set on the document root so
  // portaled dialogs/menus rebrand too; inline properties win over the
  // injected theme rule.
  const brandAccount = isCombined
    ? null
    : (accounts.find((a) => a.id === effectiveAccountId) ?? null);
  // Monochrome themes (Codex) keep their own primary.
  const monochrome = useMonochromeTheme();
  const brand = brandAccount && !monochrome ? getAccountColor(brandAccount) : null;
  useEffect(() => {
    const root = document.documentElement.style;
    const props = ["--accent", "--accent-contrast", "--primary", "--primary-foreground", "--ring"];
    if (!brand) {
      for (const p of props) root.removeProperty(p);
      return;
    }
    const contrast = getAccountContrastColor(brand);
    root.setProperty("--accent", brand);
    root.setProperty("--accent-contrast", contrast);
    root.setProperty("--primary", brand);
    root.setProperty("--primary-foreground", contrast);
    root.setProperty("--ring", brand);
  }, [brand]);

  // Resolve the selected view to concrete per-account rules.
  const combined = (() => {
    if (isCombined) {
      const view = views.find((v) => v.id === selectedLabelId) ?? views[0];
      return {
        viewId: view?.id ?? INBOX_VIEW_ID,
        name: view?.name ?? "Inbox",
        rules: view ? resolveRules(view, accounts) : [],
      };
    }
    // Account mailboxes own their views outright — rules reference only the
    // owning account, but prune defensively anyway.
    const view = views.find((v) => v.id === selectedLabelId);
    if (!view || !effectiveAccountId || view.mailbox !== effectiveAccountId) return null;
    const rules = resolveRules(view, accounts).filter((r) => r.accountId === effectiveAccountId);
    if (rules.length === 0) return null;
    return { viewId: `${effectiveAccountId}:${view.id}`, name: view.name, rules };
  })();

  const handleSelectAccount = (accountId: string) => {
    console.log("[HomeView:selectAccount]", { accountId });
    setComposeOpen(false);
    setSelectedAccountId(accountId);
    setSelectedLabelId(accountId === COMBINED_ACCOUNT_ID ? INBOX_VIEW_ID : "INBOX");
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };
  accountSwitchRef.current = {
    ids: accountIds,
    combined: mailboxes.combined,
    select: handleSelectAccount,
  };

  // The showing mailbox was turned off (or "All mailboxes" was): move to
  // what's first now, at its inbox.
  const showingOff =
    initialized &&
    selectedAccountId !== null &&
    (selectedAccountId === COMBINED_ACCOUNT_ID
      ? !mailboxes.combined
      : !accounts.some((a) => a.id === selectedAccountId));
  useEffect(() => {
    if (!showingOff) return;
    const next = mailboxes.combined ? COMBINED_ACCOUNT_ID : firstRealAccountId;
    if (next) handleSelectAccount(next);
  }, [showingOff]);

  const handleSelectLabel = (labelId: string) => {
    console.log("[HomeView:selectLabel]", { labelId });
    setComposeOpen(false);
    setSelectedLabelId(labelId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };

  const handleSelectMessage = (messageId: string, accountId: string, focusId?: string) => {
    console.log("[HomeView:selectMessage]", { messageId, accountId, focusId });
    setComposeOpen(false);
    setSelectedMessageId(messageId);
    setReaderAccountId(accountId);
    setFocusedMessage(focusId ? { rowId: messageId, id: focusId } : null);
  };

  // A send taken back with Undo reopens its draft here (the reader edits drafts).
  const queryClient = useQueryClient();
  const selectMessageRef = useRef(handleSelectMessage);
  selectMessageRef.current = handleSelectMessage;
  useEffect(
    () =>
      setDraftOpener(({ accountId, messageId }) => {
        void queryClient.invalidateQueries({ queryKey: ["gmail:messages", accountId] });
        void queryClient.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
        selectMessageRef.current(messageId, accountId);
      }),
    [],
  );

  // ── Search mailbox ───────────────────────────────────────────────────────
  // Search is a mailbox like Inbox: selecting a search row (the top Search
  // row, or one under the view it was started from) shows Gmail's search in
  // the list pane. Escape clears it, then closes it back to where you were.
  const searchActive = selectedLabelId === SEARCH_MAILBOX;
  const searchReturnRef = useRef<string>("INBOX");
  const searchMailbox = selectedAccountId ?? "";
  const topSearchId = searchTabId(searchMailbox, null);
  const activeSearch = searchActive
    ? (searchTabs.find((t) => t.id === activeSearchId) ?? null)
    : null;
  const patchSearch = (id: string, patch: Partial<SearchTab>) =>
    setSearchTabs((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  // Where a new search looks by default: the mailbox you started it from.
  const defaultScope = (): string[] =>
    isCombined || !effectiveAccountId
      ? combined && selectedLabelId !== SEARCH_MAILBOX
        ? [...new Set(combined.rules.map((r) => r.accountId))]
        : accountIds
      : [effectiveAccountId];
  const focusSearchEnd = () =>
    setTimeout(() => {
      const input = searchRef.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  const showSearch = (id: string) => {
    if (!searchActive) searchReturnRef.current = selectedLabelId;
    setComposeOpen(false);
    setSettingsRoute(null);
    setSelectedLabelId(SEARCH_MAILBOX);
    setActiveSearchId(id);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };
  /** The top Search row (all mail), optionally running `q`. */
  const openSearch = (q?: string) => {
    console.log("[HomeView:openSearch]", { hasQuery: Boolean(q) });
    setSearchTabs((tabs) => {
      const existing = tabs.find((t) => t.id === topSearchId);
      if (existing)
        return q === undefined
          ? tabs
          : tabs.map((t) => (t.id === topSearchId ? { ...t, query: q, draft: q } : t));
      return [
        ...tabs,
        {
          id: topSearchId,
          mailbox: searchMailbox,
          parent: null,
          base: "",
          query: q ?? "",
          draft: q ?? "",
          scope: defaultScope(),
        },
      ];
    });
    showSearch(topSearchId);
    // Focus once the header has mounted (no query: ready to type).
    if (!q) focusSearchEnd();
  };
  // ⌘F / the list's search icon: the view's own search row, opened under it
  // with its operators prefilled (`in:inbox `) and the cursor after them.
  // Already in a search, it just focuses the bar.
  const viewQueryRef = useRef("");
  const searchFromView = () => {
    if (searchActive && !settingsRoute) {
      searchRef.current?.focus();
      return;
    }
    const base = viewQueryRef.current;
    if (!base) return openSearch();
    const id = searchTabId(searchMailbox, selectedLabelId);
    console.log("[HomeView:searchFromView]", { base });
    setSearchTabs((tabs) =>
      tabs.some((t) => t.id === id)
        ? tabs
        : [
            ...tabs,
            {
              id,
              mailbox: searchMailbox,
              parent: selectedLabelId,
              base,
              query: "",
              draft: `${base} `,
              scope: defaultScope(),
            },
          ],
    );
    showSearch(id);
    focusSearchEnd();
  };
  const runSearch = (q: string) => {
    const tab = activeSearch;
    if (!tab) return openSearch(q);
    // Dropping the view's operators makes it a search of all mail: it moves
    // up to the top Search row.
    if (tab.parent && !q.includes(tab.base)) {
      console.log("[HomeView:searchLeavesView]");
      setSearchTabs((tabs) => [
        ...tabs.filter((t) => t.id !== tab.id && t.id !== topSearchId),
        { ...tab, id: topSearchId, parent: null, base: "", query: q, draft: q },
      ]);
      setActiveSearchId(topSearchId);
      return;
    }
    patchSearch(tab.id, { query: q, draft: q });
  };
  const closeSearch = (id: string) => {
    const tab = searchTabs.find((t) => t.id === id);
    console.log("[HomeView:closeSearch]", { child: Boolean(tab?.parent) });
    setSearchTabs((tabs) => tabs.filter((t) => t.id !== id));
    if (searchActive && activeSearchId === id) {
      setSelectedLabelId(tab?.parent ?? searchReturnRef.current);
      setSelectedMessageId(null);
      setReaderAccountId(null);
    }
  };
  const handleSearchChange = (q: string) => openSearch(q);
  // Back/forward into a search that was since closed: the top Search row.
  useEffect(() => {
    if (searchActive && !activeSearch) openSearch();
  });

  // Palette mail result: jump to the owning account (Combined stays put) and open.
  const handlePaletteOpenMessage = (message: GmailMessageSummary) => {
    console.log("[HomeView:paletteOpenMessage]", {
      messageId: message.id,
      accountId: message.accountId,
    });
    const owner = message.accountId ?? firstRealAccountId;
    if (!owner) return;
    if (!isCombined && owner !== effectiveAccountId) {
      setSelectedAccountId(owner);
      setSelectedLabelId("INBOX");
    }
    setSelectedMessageId(message.id);
    setReaderAccountId(owner);
  };

  openFromTrayRef.current = (owner, messageId) => {
    setComposeOpen(false);
    setSettingsRoute(null);
    if (!isCombined && owner !== effectiveAccountId) {
      setSelectedAccountId(owner);
      setSelectedLabelId("INBOX");
    }
    setSelectedMessageId(messageId);
    setReaderAccountId(owner);
  };

  const handlePaletteGoToView = (viewId: string) => {
    console.log("[HomeView:paletteGoToView]", { viewId });
    setSelectedAccountId(COMBINED_ACCOUNT_ID);
    setSelectedLabelId(viewId);
    setSelectedMessageId(null);
    setReaderAccountId(null);
  };

  // Manual refresh: spin from the click until every account's sync settles
  // (any phase — the passive indicator only shows long full/body syncs), and
  // for at least a beat so a fast incremental sync still reads as feedback.
  const [manualSyncing, setManualSyncing] = useState(false);
  const syncNow = () => {
    if (manualSyncing) return;
    console.log("[HomeView:syncNow]");
    setManualSyncing(true);
    const startedAt = Date.now();
    void (async () => {
      try {
        await Promise.all(accountIds.map((id) => gmailApi.syncAccount(id).catch(() => null)));
        for (let i = 0; i < 150; i++) {
          const statuses = await Promise.all(
            accountIds.map((id) => gmailApi.getSyncStatus(id).catch(() => null)),
          );
          if (!statuses.some((st) => st?.syncing)) break;
          await new Promise((r) => setTimeout(r, 400));
        }
      } finally {
        const remaining = 700 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        setManualSyncing(false);
      }
    })();
  };
  // ⌘R (Mailbox › Sync Now in the app menu) is the same manual refresh.
  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;
  useEffect(() => window.desktopBridge.on("mail:syncNow", () => syncNowRef.current()), []);

  const composeAccountId = isCombined ? firstRealAccountId : effectiveAccountId;
  const readerAccount = readerAccountId ?? (isCombined ? firstRealAccountId : effectiveAccountId);
  const hasListTarget = isCombined || effectiveAccountId != null;

  // Full-height columns: each pane owns its slice of the title band (on the
  // chrome); the content panel is painted behind them from under that band.
  // With a conversation open, its header is the title band (subject, actions
  // and the panel toggle in one row) instead of an empty band above it.
  const readerOwnsBand =
    !settingsRoute && !(composeOpen && composeAccountId) && !!readerAccount && !!selectedMessageId;
  const titleTrailing = <TitleTrailing showPanelToggle={!chatOpen && !settingsRoute} />;
  // With the sidebar hidden and no list pane, this band is the leftmost one: it
  // needs the traffic-light clearance and the toggle to bring the sidebar (and
  // Settings' Back button) back.
  const mainIsLeftmost = !sidebarOpen && !(hasListTarget && !settingsRoute);
  const titleControls = (
    <TitleControls
      leading={mainIsLeftmost ? <TitlebarInset /> : null}
      syncing={globalSync.syncing}
      syncLabel={globalSync.label}
      // Room for the pinned panel toggle while the panel is closed; when
      // open, the panel's header keeps it. Settings has no panel.
      showPanelToggle={!chatOpen && !settingsRoute}
    />
  );
  return (
    <>
      <div
        className="surface-grain flex h-full bg-sidebar-surface text-foreground"
        data-panel-animations={panelAnimationsActive ? "true" : "false"}
        style={{ "--panel-animation-duration": `${panelAnimationDurationMs}ms` } as CSSProperties}
      >
        <div className="contents">
          {sidebarPresent ? (
            <>
              <div
                ref={sidebarPane.frameRef}
                style={{ width: sidebarOpen ? sidebarPane.width : 0 }}
                className={cn(
                  PANE_FRAME,
                  // Anchored right, so the sidebar slides out to the left.
                  "justify-end",
                  sidebarOpen && "[[data-panel-animations=true]_&]:starting:w-0!",
                  !sidebarOpen && "pointer-events-none",
                )}
              >
                <div
                  ref={sidebarPane.paneRef}
                  style={{ width: sidebarPane.width }}
                  className={`${PANE_SIDEBAR} flex shrink-0 flex-col`}
                  data-app-sidebar=""
                >
                  {settingsRoute ? (
                    <>
                      <WindowTitle />
                      <SettingsNav
                        pane={settingsRoute.pane}
                        onSelect={(pane) => setSettingsRoute({ pane, viewId: null, mailbox: null })}
                        onBack={() => setSettingsRoute(null)}
                      />
                    </>
                  ) : (
                    <AccountsSidebar
                      onOpenSettings={(pane = "general") =>
                        setSettingsRoute({ pane, viewId: null, mailbox: null })
                      }
                      onEditView={(viewId, mailbox) =>
                        setSettingsRoute({ pane: "views", viewId, mailbox })
                      }
                      onSync={syncNow}
                      syncing={globalSync.syncing || manualSyncing}
                      selectedAccountId={effectiveAccountId}
                      onSelectAccount={handleSelectAccount}
                      selectedLabelId={selectedLabelId}
                      onSelectLabel={handleSelectLabel}
                      views={views}
                      onCompose={() => setComposeOpen(true)}
                      searchSelected={activeSearch?.id === topSearchId}
                      searchPending={Boolean(
                        searchTabs.find((t) => t.id === topSearchId)?.draft.trim(),
                      )}
                      searches={searchTabs
                        .filter((t) => t.mailbox === searchMailbox && t.parent)
                        .map((t) => ({
                          id: t.id,
                          parent: t.parent!,
                          title: searchTitle(t),
                          selected: activeSearch?.id === t.id,
                        }))}
                      onSelectSearch={(id) => {
                        showSearch(id);
                        focusSearchEnd();
                      }}
                      onCloseSearch={closeSearch}
                      onOpenSearch={() => openSearch()}
                    />
                  )}
                </div>
              </div>
              {sidebarOpen ? <PaneResizer onPointerDown={sidebarPane.start} /> : null}
            </>
          ) : null}
          {/* A thin margin of frame on every free side (ChatGPT), so the panel
              floats with all four corners rounded. */}
          <div
            className={cn("relative isolate flex min-w-0 flex-1 pb-1 pr-1", !sidebarOpen && "pl-1")}
          >
            {/* The inset content panel, behind the panes and under their title bands. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute bottom-1 right-1 top-(--workspace-topbar-height) -z-10 rounded-xl border border-border/70 bg-canvas",
                sidebarOpen ? "left-0" : "left-1",
              )}
            />
            {hasListTarget && !settingsRoute ? (
              <>
                <div
                  ref={listPane.paneRef}
                  style={{ width: listPane.width }}
                  className={`${PANE_LIST} shrink-0`}
                  data-tour="list"
                >
                  <MessageList
                    headerLeading={sidebarOpen ? null : <TitlebarInset />}
                    accountId={(isCombined ? firstRealAccountId : effectiveAccountId) ?? ""}
                    labelId={selectedLabelId}
                    combined={combined}
                    accountIds={accountIds}
                    accounts={accounts}
                    selectedMessageId={selectedMessageId}
                    focusedMessageId={focusedMessageId}
                    onSelectMessage={handleSelectMessage}
                    onDeselect={() => {
                      setSelectedMessageId(null);
                      setReaderAccountId(null);
                    }}
                    advanceRef={advanceRef}
                    onSelectionChange={setChatSelection}
                    onOpenChat={openChat}
                    onSearchView={searchFromView}
                    viewQueryRef={viewQueryRef}
                    search={
                      activeSearch
                        ? {
                            id: activeSearch.id,
                            query: activeSearch.query,
                            base: activeSearch.base,
                            accountIds: activeSearch.scope,
                            onSearch: runSearch,
                            onClear: () => {
                              const base = activeSearch.base ? `${activeSearch.base} ` : "";
                              patchSearch(activeSearch.id, { query: "", draft: base });
                              focusSearchEnd();
                            },
                            onExit: () => closeSearch(activeSearch.id),
                            onScope: (scope) => patchSearch(activeSearch.id, { scope }),
                            focusRef: searchRef,
                            draft: activeSearch.draft,
                            onDraftChange: (draft) => patchSearch(activeSearch.id, { draft }),
                            messageOpen: selectedMessageId !== null,
                          }
                        : undefined
                    }
                  />
                </div>
                <PaneResizer onPointerDown={listPane.start} />
              </>
            ) : null}
            <div className={`${PANE_MAIN} flex min-w-0 flex-1 flex-col`} data-tour="reader">
              {readerOwnsBand ? null : titleControls}
              <div className="flex min-h-0 flex-1 flex-col">
                {settingsRoute ? (
                  <SettingsPage route={settingsRoute} onNavigate={setSettingsRoute} />
                ) : composeOpen && composeAccountId ? (
                  <NewMessageView
                    key={mailtoSeq}
                    accounts={accounts}
                    defaultAccountId={composeAccountId}
                    onClose={() => {
                      setComposeOpen(false);
                      setMailtoPrefill(null);
                    }}
                    prefill={mailtoPrefill ?? undefined}
                  />
                ) : readerAccount ? (
                  <MessageReader
                    titleTrailing={titleTrailing}
                    accountId={readerAccount}
                    messageId={focusedMessageId ?? selectedMessageId}
                    single={focusedMessageId != null}
                    onShowConversation={() => setFocusedMessage(null)}
                    onDeselect={() => {
                      setSelectedMessageId(null);
                      setReaderAccountId(null);
                    }}
                    onAdvance={handleReaderAdvance}
                    onOpenChat={openChat}
                    onQuote={(q) => {
                      // Only reflect selections while the panel is open, so normal
                      // reading/copying is never hijacked.
                      if (chatOpen) setPendingQuote(q);
                    }}
                    onComposeTo={(email) => {
                      setMailtoPrefill({ to: email, cc: "", subject: "", body: "" });
                      setMailtoSeq((n) => n + 1);
                      setComposeOpen(true);
                    }}
                    onSearchSender={(email) => handleSearchChange(`from:${email}`)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      title="No account selected"
                      description="Select a mailbox from the sidebar."
                    />
                  </div>
                )}
              </div>
            </div>
            {chatPresent ? (
              <>
                {chatVisible ? <PaneResizer onPointerDown={chatPane.start} /> : null}
                <div
                  ref={chatPane.frameRef}
                  data-tour="agent"
                  style={{ width: chatVisible ? chatPane.width : 0 }}
                  className={cn(
                    PANE_FRAME,
                    chatVisible && "[[data-panel-animations=true]_&]:starting:w-0!",
                    !chatVisible && "pointer-events-none",
                  )}
                >
                  <div
                    ref={chatPane.paneRef}
                    style={{ width: chatPane.width }}
                    className={`${PANE_CHAT} shrink-0`}
                  >
                    <AgentChatPanel
                      closeTabRef={closeChatTabRef}
                      onClosePanel={closeChat}
                      accountId={selectedMessageId ? readerAccount : null}
                      messageId={selectedMessageId}
                      selectedRows={chatSelection}
                      quote={pendingQuote}
                      onClearQuote={() => setPendingQuote(null)}
                    />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Pinned titlebar toggles (Otter Code): same window spot whatever the panes do. */}
      <SidebarControl sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      {!settingsRoute ? (
        <PanelControl
          open={chatOpen}
          onToggle={() => {
            if (chatOpen) setPendingQuote(null);
            toggleChat();
          }}
        />
      ) : null}

      {tourRequested && initialized ? (
        <Tour
          actions={{
            agentOpen: chatOpen,
            setAgentOpen: (open) => (open ? openChat() : closeChat()),
            openMessage: () => {
              if (selectedMessageId) return;
              // A read one where there is one: opening marks a conversation read.
              const row =
                document.querySelector<HTMLElement>(
                  "[data-message-row]:not([data-draft]):not([data-unread])",
                ) ?? document.querySelector<HTMLElement>("[data-message-row]:not([data-draft])");
              row?.click();
            },
          }}
          onClose={endTour}
        />
      ) : null}

      {accounts.length > 0 ? (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          accounts={accounts}
          views={views}
          selectedAccountId={effectiveAccountId}
          onOpenMessage={handlePaletteOpenMessage}
          onSearchMail={(q) => openSearch(q)}
          onGoToView={handlePaletteGoToView}
          onSelectAccount={handleSelectAccount}
          onCompose={() => setComposeOpen(true)}
          onOpenSettings={(pane = "general") =>
            setSettingsRoute({ pane, viewId: null, mailbox: null })
          }
          onNewView={() =>
            setSettingsRoute({
              pane: "views",
              viewId: "new",
              mailbox: isCombined ? COMBINED_ACCOUNT_ID : effectiveAccountId,
            })
          }
          onToggleChat={toggleChat}
          onToggleSidebar={toggleSidebar}
          onSync={syncNow}
        />
      ) : null}
    </>
  );
}
