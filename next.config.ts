import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions cap request bodies at 1 MB by default, which rejects a
      // real weekly workbook (the current one is ~1.8 MB). The import action
      // enforces its own 25 MB limit and returns a readable error; this ceiling
      // is set just above it so oversized files fail there rather than as a 413.
      bodySizeLimit: "26mb",
    },
  },
};

export default nextConfig;
