import { describe, expect, it } from "vite-plus/test";

import { unsubscribeEmail } from "./unsubscribe.ts";

describe("unsubscribeEmail", () => {
  it("writes the email a mailto link asks for", () => {
    const { to, subject, raw } = unsubscribeEmail(
      "mailto:leave@list.example.com?subject=Stop%20it&body=Bye&cc=spy@x.com",
      "Me <me@example.com>",
    );
    expect(to).toBe("leave@list.example.com");
    expect(subject).toBe("Stop it");
    expect(raw).toContain("To: leave@list.example.com\r\n");
    expect(raw).toContain("Subject: Stop it\r\n");
    expect(raw).not.toContain("spy@x.com");
  });

  it("refuses header injection and anything but one address", () => {
    const from = "me@example.com";
    for (const link of [
      "mailto:a@b.com%0D%0ABcc:%20victim@x.com",
      "mailto:a@b.com,c@d.com",
      "mailto:Ann%20%3Ca@b.com%3E",
      "mailto:?to=a@b.com",
      "mailto:a@b.com?subject=Hi%0ABcc:%20victim@x.com",
    ]) {
      expect(() => unsubscribeEmail(link, from), link).toThrow();
    }
  });

  it("keeps line breaks in the body inside it", () => {
    const { raw } = unsubscribeEmail("mailto:a@b.com?body=one%0D%0ABcc:%20x@y.com", "me@x.com");
    expect(raw).not.toMatch(/^Bcc:/m);
  });
});
