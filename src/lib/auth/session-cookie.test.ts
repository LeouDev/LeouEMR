import { describe, expect, it } from "vitest";
import { accessTokenFromCookies, decodeJwtPayload, isPrefetchRequest, sessionCookieName } from "./session-cookie";

const URL_ = "https://abcdefghij.supabase.co";
const toBase64Url = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const SESSION = JSON.stringify({ access_token: "eyJ.header.sig", refresh_token: "r", user: { id: "u" } });

describe("isPrefetchRequest", () => {
  it("recognises both prefetch headers and nothing else", () => {
    expect(isPrefetchRequest(new Headers({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetchRequest(new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(new Headers({ purpose: "other" }))).toBe(false);
    expect(isPrefetchRequest(new Headers())).toBe(false);
  });
});

describe("accessTokenFromCookies", () => {
  it("names the cookie after the project", () => {
    expect(sessionCookieName(URL_)).toBe("sb-abcdefghij-auth-token");
    expect(sessionCookieName(undefined)).toBeNull();
    expect(sessionCookieName("not a url")).toBeNull();
  });

  it("reads a plain JSON cookie and a base64-prefixed one", () => {
    expect(accessTokenFromCookies([{ name: "sb-abcdefghij-auth-token", value: encodeURIComponent(SESSION) }], URL_)).toBe("eyJ.header.sig");
    expect(accessTokenFromCookies([{ name: "sb-abcdefghij-auth-token", value: `base64-${toBase64Url(SESSION)}` }], URL_)).toBe(
      "eyJ.header.sig",
    );
  });

  it("joins numbered chunks in order", () => {
    const encoded = `base64-${toBase64Url(SESSION)}`;
    const mid = Math.floor(encoded.length / 2);
    const cookies = [
      { name: "sb-abcdefghij-auth-token.1", value: encoded.slice(mid) },
      { name: "other", value: "x" },
      { name: "sb-abcdefghij-auth-token.0", value: encoded.slice(0, mid) },
    ];
    expect(accessTokenFromCookies(cookies, URL_)).toBe("eyJ.header.sig");
  });

  it("gives null for a missing, foreign or unreadable cookie rather than guessing", () => {
    expect(accessTokenFromCookies([], URL_)).toBeNull();
    expect(accessTokenFromCookies([{ name: "sb-other-auth-token", value: SESSION }], URL_)).toBeNull();
    expect(accessTokenFromCookies([{ name: "sb-abcdefghij-auth-token", value: "base64-@@@" }], URL_)).toBeNull();
    expect(accessTokenFromCookies([{ name: "sb-abcdefghij-auth-token", value: JSON.stringify({ nope: 1 }) }], URL_)).toBeNull();
  });
});

describe("decodeJwtPayload", () => {
  it("reads the claims of a token and refuses anything that is not one", () => {
    const token = `${toBase64Url('{"alg":"ES256"}')}.${toBase64Url('{"sub":"u1","aal":"aal2"}')}.sig`;
    expect(decodeJwtPayload(token)).toEqual({ sub: "u1", aal: "aal2" });
    expect(decodeJwtPayload("nope")).toBeNull();
    expect(decodeJwtPayload("a.b.c")).toBeNull();
  });
});
