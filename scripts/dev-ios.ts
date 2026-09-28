#!/usr/bin/env node
// Builds the iPhone app (apps/ios) for the simulator and runs it in the booted
// one (booting an iPhone first if none is). Use `--relay local` to point it at
// `pnpm dev`'s relay on :8787 instead of production.
//
//   pnpm dev:ios [--relay local]

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const derived = NodePath.join(root, "apps/ios/.build");
const app = NodePath.join(derived, "Build/Products/Debug-iphonesimulator/Otter Mail.app");
const local = process.argv.includes("local");

const run = (command: string, args: string[], env?: NodeJS.ProcessEnv) =>
  NodeChildProcess.execFileSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
const read = (command: string, args: string[]) =>
  NodeChildProcess.execFileSync(command, args, { encoding: "utf8" });

run("node", [NodePath.join(root, "scripts/export-ios-resources.ts")]);

const devices = JSON.parse(read("xcrun", ["simctl", "list", "devices", "available", "--json"])) as {
  devices: Record<string, { udid: string; name: string; state: string }[]>;
};
const iphones = Object.values(devices.devices)
  .flat()
  .filter((d) => d.name.startsWith("iPhone"));
const device = iphones.find((d) => d.state === "Booted") ?? iphones.at(-1);
if (!device)
  throw new Error("No iPhone simulator. Add one in Xcode › Window › Devices and Simulators.");
if (device.state !== "Booted") run("xcrun", ["simctl", "boot", device.udid]);
try {
  run("open", ["-a", "Simulator"]);
} catch {
  // No Simulator window (a headless session, or T3's Device panel is showing it).
}

run("xcodebuild", [
  "-project",
  NodePath.join(root, "apps/ios/OtterMail.xcodeproj"),
  "-scheme",
  "OtterMail",
  "-destination",
  `platform=iOS Simulator,id=${device.udid}`,
  "-derivedDataPath",
  derived,
  "-quiet",
  "build",
]);
run("xcrun", ["simctl", "install", device.udid, app]);
run(
  "xcrun",
  ["simctl", "launch", "--terminate-running-process", device.udid, "dev.otterware.mail.dev"],
  local ? { SIMCTL_CHILD_OTTER_RELAY_URL: "http://localhost:8787" } : {},
);
