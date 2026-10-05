/**
 * Linux's terminal apps (HostOS.terminals): the installed apps in the
 * TerminalEmulator category, and Debian's x-terminal-emulator as the default.
 * Terminals differ in how they take a command to run; the launcher goes in as
 * its own argument, never through a shell.
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";

import type { HostOS } from "../types.js";
import { desktopEntries, type DesktopEntry } from "./desktop-entries.js";

/** The system's default terminal (Debian's alternatives, also on Ubuntu). */
const DEFAULT_TERMINAL = "/usr/bin/x-terminal-emulator";

/** What comes before the command, by executable; most terminals take `-e`. */
const RUN_ARGS: Record<string, string[]> = {
  "gnome-terminal": ["--"],
  kgx: ["--"],
  ptyxis: ["--"],
  "xfce4-terminal": ["-x"],
  "mate-terminal": ["-x"],
  terminator: ["-x"],
  wezterm: ["start", "--"],
  kitty: [],
  foot: [],
};

const isTerminal = (entry: DesktopEntry) => entry.categories.includes("TerminalEmulator");

/** The command that runs `launcher` in the terminal `exec` (an Exec line's words). */
export function terminalCommand(exec: string[], launcher: string): string[] {
  const binary = path.basename(exec[0]!);
  return [...exec, ...(RUN_ARGS[binary] ?? ["-e"]), launcher];
}

function defaultTerminalBinary(): string | null {
  try {
    return path.basename(realpathSync(DEFAULT_TERMINAL));
  } catch {
    return null;
  }
}

function launch(command: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // The terminal outlives the app's interest in it.
    const child = spawn(command[0]!, command.slice(1), { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export const linuxTerminals: HostOS["terminals"] = {
  async list() {
    const terminals = (await desktopEntries()).filter(isTerminal);
    const binary = defaultTerminalBinary();
    // gnome-terminal's alternative is a wrapper script beside it.
    const byDefault = terminals.find(
      (entry) => binary && binary.replace(/\.wrapper$/, "") === path.basename(entry.exec[0]!),
    );
    return {
      apps: terminals.map(({ id, name }) => ({ id, name })),
      defaultName: byDefault?.name ?? null,
    };
  },
  async open(launcher, terminalId) {
    const terminals = (await desktopEntries()).filter(isTerminal);
    const chosen = terminalId ? terminals.find((entry) => entry.id === terminalId) : undefined;
    if (chosen) return launch(terminalCommand(chosen.exec, launcher));
    // Debian requires x-terminal-emulator to take `-e command args…`.
    if (defaultTerminalBinary()) return launch([DEFAULT_TERMINAL, "-e", launcher]);
    if (terminals[0]) return launch(terminalCommand(terminals[0].exec, launcher));
    throw new Error("No terminal is installed.");
  },
  // bash is on every Debian system; zsh may not be.
  launcher: { fileName: "investigate-otter-mail.sh", shebang: "#!/bin/bash -l" },
};
