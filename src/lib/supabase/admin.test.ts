import { afterEach, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "./admin";

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "SUPABASE_SERVICE_ROLE_KEY";
const original = { url: process.env[URL_VAR], key: process.env[KEY_VAR] };

afterEach(() => {
  if (original.url === undefined) delete process.env[URL_VAR];
  else process.env[URL_VAR] = original.url;
  if (original.key === undefined) delete process.env[KEY_VAR];
  else process.env[KEY_VAR] = original.key;
});

describe("createSupabaseAdminClient", () => {
  it("names the missing variable rather than leaving supabase-js to say 'supabaseKey is required.'", () => {
    process.env[URL_VAR] = "https://project.supabase.co";
    delete process.env[KEY_VAR];

    expect(() => createSupabaseAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/);
    expect(() => createSupabaseAdminClient()).toThrow(/\.env\.local/);
  });

  it("names both variables when neither is set", () => {
    delete process.env[URL_VAR];
    delete process.env[KEY_VAR];

    expect(() => createSupabaseAdminClient()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set/,
    );
  });

  it("builds a client once both are set", () => {
    process.env[URL_VAR] = "https://project.supabase.co";
    process.env[KEY_VAR] = "service-role-key";

    expect(createSupabaseAdminClient().storage).toBeDefined();
  });
});
