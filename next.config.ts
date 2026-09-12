import type { NextConfig } from "next";

/**
 * Response headers for every page, production builds only: development
 * needs eval for hot reloading and nothing here protects a local machine.
 *
 * The policy is deliberately not the strictest possible — Next.js renders
 * inline scripts and styles without nonces, so those stay allowed — but it
 * pins where scripts, workers and network calls may go (this site, Supabase
 * for auth and uploads, the CDN the text-recognition engine loads from and
 * the host its language data comes from), and it shuts the doors that no
 * feature needs: framing by another site, plugins, form posts elsewhere, a
 * rewritten base URL. On a preview deployment Vercel's own toolbar is let
 * through as well.
 */
function securityHeaders(): Array<{ key: string; value: string }> {
  // Supabase hosts auth and uploads. Every project lives under supabase.co,
  // so that is always allowed; a project on its own domain is added from
  // the configured URL. Never rely on the URL alone: the headers are fixed
  // at build time, and a build without it would lock the browser out of
  // signing in.
  const supabase = ["https://*.supabase.co", "wss://*.supabase.co"];
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    if (!origin.endsWith(".supabase.co")) supabase.push(origin, origin.replace(/^https:/, "wss:"));
  } catch {
    // no URL at build time: the wildcard above covers the hosted project
  }
  const preview = process.env.VERCEL_ENV === "preview";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net${preview ? " https://vercel.live" : ""}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase.join(" ")} https://cdn.jsdelivr.net https://tessdata.projectnaptha.com${preview ? " https://vercel.live wss://*.pusher.com" : ""}`,
    `frame-src ${preview ? "https://vercel.live" : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions cap request bodies at 1 MB by default. The workbook
      // import no longer sends the file through a server action at all (see
      // src/app/(shell)/import/actions.ts) — it uploads straight to Storage,
      // since Vercel hard-caps a Serverless Function's request body at
      // 4.5 MB regardless of this setting. This ceiling just covers every
      // other, ordinary server action in the app.
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

export default nextConfig;
