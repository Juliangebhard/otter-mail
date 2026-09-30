import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SupportTerminals } from "@otter-mail/shared/support";

const exec = promisify(execFile);
const preferenceFile = (home: string) => path.join(home, "support-terminal.json");

async function selectedTerminal(home: string): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(preferenceFile(home), "utf8"));
    return typeof value === "string" && /^[\w.-]+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

const LIST_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const fm = $.NSFileManager.defaultManager;
  const name = (u) => fm.displayNameAtPath(u.path).js.replace(/\\.app$/, "");
  const urls = ws.URLsForApplicationsToOpenURL(url);
  const apps = [];
  for (let i = 0; i < urls.count; i++) {
    const u = urls.objectAtIndex(i);
    const bundle = $.NSBundle.bundleWithURL(u);
    const types = ObjC.deepUnwrap(bundle.infoDictionary.objectForKey("CFBundleDocumentTypes")) || [];
    if (!types.some((type) => type.CFBundleTypeRole === "Shell")) continue;
    apps.push({ bundleId: bundle.bundleIdentifier.js, name: name(u) });
  }
  const def = ws.URLForApplicationToOpenURL(url);
  return JSON.stringify({ apps, defaultName: def.isNil() ? null : name(def) });
}
`;

export async function getSupportTerminals(home: string): Promise<SupportTerminals> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "otter-terminal-"));
  try {
    // LaunchServices needs an existing file to resolve its actual default handler.
    const probe = path.join(directory, "probe.command");
    await fs.writeFile(probe, "#!/bin/zsh\nexit 0\n", { mode: 0o700 });
    const { stdout } = await exec(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", LIST_SCRIPT, probe],
      { timeout: 5_000 },
    );
    const result = JSON.parse(stdout) as Omit<SupportTerminals, "selectedBundleId">;
    const apps = [...new Map(result.apps.map((item) => [item.bundleId, item])).values()].sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    const selected = await selectedTerminal(home);
    return {
      apps,
      defaultName: result.defaultName,
      selectedBundleId: apps.some((item) => item.bundleId === selected) ? selected : null,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function setSupportTerminal(
  home: string,
  bundleId: unknown,
): Promise<SupportTerminals> {
  const terminals = await getSupportTerminals(home);
  if (bundleId !== null && !terminals.apps.some((item) => item.bundleId === bundleId))
    throw new Error("Choose an installed terminal.");
  await fs.writeFile(preferenceFile(home), JSON.stringify(bundleId), { mode: 0o600 });
  return { ...terminals, selectedBundleId: bundleId as string | null };
}

export async function openSupportTerminal(home: string, launcher: string): Promise<void> {
  const saved = await selectedTerminal(home);
  const selected = saved ? (await getSupportTerminals(home)).selectedBundleId : null;
  const args = selected ? ["-b", selected, launcher] : [launcher];
  await exec("/usr/bin/open", args, { timeout: 5_000 });
}
