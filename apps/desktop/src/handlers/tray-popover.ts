/**
 * tray-popover.ts
 *
 * The tray popover's (see renderer/tray-popover/) main-process channels:
 * opening mail or the composer in the main window, and the app. Its mini
 * inbox is read from the mail cache by the backend (handlers/backend.ts) —
 * the popover doesn't trigger its own syncs, it just reflects whatever the
 * normal sync/notifier pipeline already wrote there.
 */

import { app, ipcMain } from "electron";
import { logger } from "../logger.js";
import { broadcast } from "../ipc.js";
import { setPendingMailto } from "../services/mailto-target.js";
import { focusMainWindow } from "../windows/main-window.js";
import { hideTrayPopover } from "../windows/tray-popover-window.js";
import { setPendingOpenMessage } from "../services/open-message-target.js";

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} is required`);
  return value;
}

export function registerTrayPopoverHandlers(): void {
  // Row click: open the thread's latest message in its own window, same as
  // Cmd+click in the main list.
  ipcMain.handle("tray:openThread", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      // Opens in the main window's reader (there is no standalone window).
      setPendingOpenMessage({ accountId, messageId });
      hideTrayPopover();
      await focusMainWindow();
      broadcast("mail:open");
    } catch (err) {
      logger.info("tray-popover", `openThread failed: ${String(err)}`);
      throw err;
    }
  });

  // A blank mailto target through the same pull handoff as mailto: links —
  // a main window that's still loading picks it up on mount (a bare broadcast
  // would be lost before its listener exists).
  ipcMain.handle("tray:compose", async () => {
    setPendingMailto({ to: "", cc: "", subject: "", body: "" });
    hideTrayPopover();
    await focusMainWindow();
    broadcast("compose:mailto");
  });

  // The popover changed mail through the shared gmail:* handlers; the main
  // window has its own query cache, so tell it to refresh.
  ipcMain.handle("tray:mailChanged", async () => {
    broadcast("gmail:mail-changed");
  });

  ipcMain.handle("tray:openApp", async () => {
    await focusMainWindow();
    hideTrayPopover();
  });

  ipcMain.handle("tray:quit", async () => {
    app.quit();
  });

  ipcMain.handle("tray:hide", async () => {
    hideTrayPopover();
  });
}
