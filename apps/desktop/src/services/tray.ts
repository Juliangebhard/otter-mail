/**
 * tray.ts
 *
 * macOS menu-bar ("top menu") status item. Clicking it toggles the rich
 * popover window (tray-popover-window.ts) — a mini inbox with a tab per
 * account — anchored under the icon. The icon itself only owns the tooltip
 * (total unread count) and the click-to-toggle wiring.
 *
 * setTrayUnread() — called with the Dock badge's count (core's
 * notifier.updateDockBadge(), after syncs and every message-state mutation) —
 * keeps the tooltip current and tells any open popover to refetch, so
 * neither the icon nor the popover need their own polling.
 */

import { Tray } from "electron";
import { broadcast } from "../ipc.js";
import {
  toggleTrayPopover,
  destroyTrayPopover,
  setTrayPopoverVisibilityListener,
} from "../windows/tray-popover-window.js";
import { trayIcons } from "./tray-icons.js";

let tray: Tray | null = null;
/** Unread in the inboxes of the mailboxes that are on, as the Dock badge shows it. */
let unread = 0;

/** Updates the tooltip and nudges any open popover to refetch. */
export function setTrayUnread(count: number): void {
  unread = count;
  refreshTray();
}

function refreshTray(): void {
  if (!tray) return;
  tray.setToolTip(unread > 0 ? `Otter Mail — ${unread} unread` : "Otter Mail");
  broadcast("tray:refresh");
}

export async function createTray(): Promise<void> {
  if (tray) return;
  tray = new Tray(trayIcons().normal);
  // Selected look while the popover is open, like a native status-item menu.
  setTrayPopoverVisibilityListener((open) => {
    tray?.setImage(open ? trayIcons().selected : trayIcons().normal);
  });
  tray.on("click", (_event, bounds) => {
    void toggleTrayPopover(bounds);
  });
  refreshTray();
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
  destroyTrayPopover();
}
