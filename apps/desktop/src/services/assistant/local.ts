/**
 * Where Codex and Claude (local CLIs) work on this Mac: their workspace, and
 * the absolute paths of the attachments core stages in the app's files.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { ATTACHMENTS_DIR, type ChatAttachment, type Platform } from "@otter-mail/core";

import { appInfo } from "../../backend-protocol.js";
import { requestMain } from "../../main-link.js";

/** Codex threads started from Otter Mail run here (their cwd), so they're listable as ours. */
export async function assistantWorkspace(): Promise<string> {
  const dir = path.join(appInfo().stateDir, "assistant-workspace");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function attachmentsDir(): Promise<string> {
  const dir = path.join(appInfo().stateDir, ATTACHMENTS_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function attachmentPath(attachment: ChatAttachment): string {
  return path.join(appInfo().stateDir, attachment.path);
}

/**
 * Otter Code's attachment context, appended to the prompt for every
 * attachment (images too: tools can't read inlined pixels, but can read paths).
 */
export function withAttachmentPaths(text: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return text;
  const context = attachments
    .map((a) => `[Attached ${a.kind} "${a.name}" is saved at: ${attachmentPath(a)}]`)
    .join("\n");
  return text ? `${text}\n\n${context}` : context;
}

/** The Hermes key used to live in its own safeStorage file; it's a platform secret now. */
export async function migrateHermesKey(secrets: Platform["secrets"]): Promise<void> {
  const file = path.join(appInfo().stateDir, "assistant-chat.enc");
  const hex = await fs.readFile(file, "utf-8").catch(() => null);
  if (hex === null) return;
  try {
    const sealed = Buffer.from(hex.trim(), "hex").toString("base64");
    await secrets.set("assistant-hermes-key", await requestMain("unseal", { sealed }));
  } catch {
    // Unreadable: Hermes asks to connect again.
  }
  await fs.rm(file, { force: true });
}
