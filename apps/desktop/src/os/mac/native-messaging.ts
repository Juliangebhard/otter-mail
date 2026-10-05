import { app } from "electron";
import * as path from "node:path";

export function nativeMessagingDirectories(): string[] {
  const support = path.join(app.getPath("home"), "Library/Application Support");
  return [
    path.join(app.getPath("userData"), "NativeMessagingHosts"),
    path.join(support, "Google/Chrome/NativeMessagingHosts"),
    path.join(support, "Chromium/NativeMessagingHosts"),
    "/Library/Google/Chrome/NativeMessagingHosts",
    "/Library/Application Support/Chromium/NativeMessagingHosts",
  ];
}
