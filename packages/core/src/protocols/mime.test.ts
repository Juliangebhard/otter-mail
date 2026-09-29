import { describe, expect, it } from "vite-plus/test";
import { utf8Decode } from "../bytes.ts";
import { parseMessage } from "./mime.ts";

const message = [
  "From: Ann <ann@example.com>",
  "Subject: =?UTF-8?Q?Caf=C3=A9?=",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  'Content-Type: multipart/related; boundary="b2"',
  "",
  "--b2",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Hi <img src="cid:logo@x"></p>',
  "--b2",
  "Content-Type: image/png",
  "Content-ID: <logo@x>",
  "Content-Disposition: inline",
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0K",
  "--b2--",
  "--b1",
  'Content-Type: text/plain; name="notes.txt"',
  'Content-Disposition: attachment; filename="notes.txt"',
  "",
  "hello",
  "--b1--",
  "",
].join("\r\n");

describe("parseMessage", () => {
  it("gives the body, attachments with their bytes, and the headers", async () => {
    const parsed = await parseMessage(message);
    expect(parsed.html).toContain('<img src="cid:logo@x">');
    expect(parsed.headers.find((h) => h.name === "subject")?.value).toBe("=?UTF-8?Q?Caf=C3=A9?=");
    expect(
      parsed.attachments.map(({ bytes, ...rest }) => ({ ...rest, size: bytes.length })),
    ).toEqual([
      {
        filename: null,
        mimeType: "image/png",
        contentId: "logo@x",
        disposition: "inline",
        size: 6,
      },
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        contentId: null,
        disposition: "attachment",
        size: 6, // "hello" and its line end
      },
    ]);
    expect(utf8Decode(parsed.attachments[1]!.bytes).trimEnd()).toBe("hello");
  });
});
