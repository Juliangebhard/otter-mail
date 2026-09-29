/**
 * The desktop's logger: console plus a rolling file at <userData>/logs/main.log
 * (app.getPath("logs"), see paths.ts). The main process writes both
 * (`logToFile`); the mail backend hands its lines to main (backend.ts), so
 * there's still one log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";

export type Level = "debug" | "info" | "warn" | "error";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

let stream: fs.WriteStream | null = null;
let withDebug = true;

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  return inspect(value, { depth: 4, breakLength: Infinity });
}

function write(level: Level, scope: string, message: string, data?: unknown): void {
  if (level === "debug" && !withDebug) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${
    data === undefined ? "" : ` ${format(data)}`
  }`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  stream?.write(line + "\n");
}

let sink: (level: Level, scope: string, message: string, data?: unknown) => void = write;

/** Main: also write every line to `<dir>/main.log`; debug lines only when `debug`. */
export function logToFile(dir: string, debug: boolean): void {
  withDebug = debug;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "main.log");
    // One generation of history is plenty for bug reports.
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, path.join(dir, "main.old.log"));
    }
    stream = fs.createWriteStream(file, { flags: "a" });
  } catch {
    // Console only.
  }
}

/** The backend: hand lines elsewhere (to main), with `data` already formatted. */
export function sendLogsTo(
  send: (level: Level, scope: string, message: string, data?: string) => void,
) {
  sink = (level, scope, message, data) =>
    send(level, scope, message, data === undefined ? undefined : format(data));
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => sink("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) => sink("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => sink("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => sink("error", scope, message, data),
};
