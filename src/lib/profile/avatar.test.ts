import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES, avatarUrl, parseAvatarDataUrl } from "./avatar";

const png = (bytes: number) => `data:image/png;base64,${Buffer.alloc(bytes, 1).toString("base64")}`;

describe("parseAvatarDataUrl", () => {
  it("accepts a small raster image and reports its decoded size", () => {
    expect(parseAvatarDataUrl(png(3000))).toMatchObject({ contentType: "image/png", bytes: 3000 });
    expect(parseAvatarDataUrl(`data:image/webp;base64,${Buffer.alloc(10, 2).toString("base64")}`)).toMatchObject({
      contentType: "image/webp",
      bytes: 10,
    });
    expect(parseAvatarDataUrl(png(MAX_AVATAR_BYTES))?.bytes).toBe(MAX_AVATAR_BYTES);
  });

  it("refuses anything that is not a small PNG, JPEG or WebP", () => {
    expect(parseAvatarDataUrl(png(MAX_AVATAR_BYTES + 1))).toBeNull();
    expect(parseAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(parseAvatarDataUrl("data:image/gif;base64,R0lGODlh")).toBeNull();
    expect(parseAvatarDataUrl("data:image/png;base64,not base64!")).toBeNull();
    expect(parseAvatarDataUrl("data:image/png;base64,")).toBeNull();
    expect(parseAvatarDataUrl("https://example.test/a.png")).toBeNull();
    expect(parseAvatarDataUrl(42)).toBeNull();
  });

  it("versions the URL", () => {
    expect(avatarUrl(1789280000000)).toBe("/profile/avatar?v=1789280000000");
  });
});
