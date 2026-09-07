import type { NextConfig } from "next";

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
};

export default nextConfig;
