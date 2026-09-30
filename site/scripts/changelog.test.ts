import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { changelogImageName } from "@otter-mail/shared/changelog";
import { readChangelog } from "./changelog.ts";

describe("changelog", () => {
  const entries = readChangelog();

  it("parses every note", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.title.length, e.version).toBeGreaterThan(0);
      expect(e.body.length, e.version).toBeGreaterThan(0);
    }
  });

  it("finds every image a note shows", () => {
    const images = NodePath.resolve(import.meta.dirname, "../../changelog/images");
    for (const e of entries) {
      for (const [, src] of e.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const name = changelogImageName(src!);
        expect(name, `${e.version}: ${src} should be images/<file>`).not.toBeNull();
        expect(NodeFS.existsSync(NodePath.join(images, name!)), `${e.version}: ${src}`).toBe(true);
      }
    }
  });
});
