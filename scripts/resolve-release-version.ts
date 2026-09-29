#!/usr/bin/env node
// Picks the version of the next stable release, of the Mac app (and web) or,
// with --app ios, of the iPhone app, which is versioned on its own.
//
//   node scripts/resolve-release-version.ts [--app mac|ios]
//                                           [--version 1.2.3 | --tag v1.2.3 | --bump patch|minor|major]
//                                           [--github-output]
//
// An explicit --version or a pushed --tag wins. Otherwise the app's latest tag
// (vX.Y.Z for the Mac, ios-vX.Y.Z for the iPhone) is bumped; the very first
// release ships the version in the app's source (apps/desktop/package.json, or
// MARKETING_VERSION in the Xcode project). Prints (or appends to
// $GITHUB_OUTPUT) version, tag, name, prerelease, make_latest and previous_tag.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const STABLE = /^(?:ios-)?v?(\d+)\.(\d+)\.(\d+)$/;
const ANY = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

type Bump = "patch" | "minor" | "major";

export function bumpVersion(version: string, bump: Bump): string {
  const match = STABLE.exec(version);
  if (!match) throw new Error(`Not a stable version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

type App = "mac" | "ios";

const APPS: Record<App, { prefix: string; name: string; sourceVersion: () => string }> = {
  mac: {
    prefix: "v",
    name: "Otter Mail",
    sourceVersion: () =>
      (
        JSON.parse(
          NodeFS.readFileSync(NodePath.join(repoRoot, "apps/desktop/package.json"), "utf8"),
        ) as { version: string }
      ).version,
  },
  ios: {
    prefix: "ios-v",
    name: "Otter Mail for iPhone",
    sourceVersion: () =>
      /MARKETING_VERSION = ([^;]+);/.exec(
        NodeFS.readFileSync(
          NodePath.join(repoRoot, "apps/ios/OtterMail.xcodeproj/project.pbxproj"),
          "utf8",
        ),
      )?.[1] ?? "",
  },
};

/** The app's stable tags, newest first. */
function stableTags(prefix: string): string[] {
  const out = NodeChildProcess.execFileSync(
    "git",
    ["tag", "--list", `${prefix}*`, "--sort=-v:refname"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter((tag) => tag.startsWith(prefix) && /^\d+\.\d+\.\d+$/.test(tag.slice(prefix.length)));
}

function main(): void {
  const { values } = parseArgs({
    options: {
      app: { type: "string", default: "mac" },
      version: { type: "string" },
      tag: { type: "string" },
      bump: { type: "string", default: "patch" },
      "github-output": { type: "boolean", default: false },
    },
  });
  const app = APPS[values.app as App];
  if (!app) throw new Error(`Unknown app: ${values.app}`);
  const tags = stableTags(app.prefix);
  const explicit = (values.version?.trim() || values.tag?.trim() || "").replace(
    new RegExp(`^${app.prefix}`),
    "",
  );
  let version: string;
  if (explicit) {
    version = explicit;
  } else if (tags[0]) {
    const bump = values.bump as Bump;
    if (!["patch", "minor", "major"].includes(bump)) throw new Error(`Unknown bump: ${bump}`);
    version = bumpVersion(tags[0], bump);
  } else {
    version = app.sourceVersion();
  }
  if (!ANY.test(version)) throw new Error(`Invalid release version: ${version}`);
  const tag = `${app.prefix}${version}`;
  // A pushed tag already exists; a dispatched release must not reuse one.
  if (!values.tag && tags.includes(tag)) throw new Error(`${tag} was already released.`);

  const stable = STABLE.test(version);
  const outputs = {
    version,
    tag,
    name: `${app.name} ${version}`,
    prerelease: String(!stable),
    make_latest: String(stable),
    previous_tag: tags.find((t) => t !== tag) ?? "",
  };
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  if (values["github-output"] && process.env.GITHUB_OUTPUT) {
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  }
  console.log(lines.join("\n"));
}

if (import.meta.main) main();
