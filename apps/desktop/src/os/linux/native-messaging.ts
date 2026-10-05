import { app } from "electron";
import * as path from "node:path";

export function nativeMessagingDirectories(): string[] {
  const config = process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config");
  return [
    path.join(app.getPath("userData"), "NativeMessagingHosts"),
    path.join(config, "google-chrome/NativeMessagingHosts"),
    path.join(config, "chromium/NativeMessagingHosts"),
    "/etc/opt/chrome/native-messaging-hosts",
    "/etc/chromium/native-messaging-hosts",
    "/etc/chromium-browser/native-messaging-hosts",
  ];
}
