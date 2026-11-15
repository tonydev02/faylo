import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.FAYLO_BROWSER_TEST === "1" ? ".next-browser" : ".next",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
