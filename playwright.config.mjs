import { defineConfig } from "@playwright/test";
import path from "node:path";
import { APP_ORIGIN, AUTH_STATE_PATH } from "./tests/browser/constants.mjs";

const localSupabaseUrl = process.env.LOCAL_SUPABASE_URL ?? "";
if (!localSupabaseUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(localSupabaseUrl).hostname)) {
  throw new Error("Browser tests require `npm run test:browser` and local Supabase; hosted projects are rejected.");
}

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: "list",
  globalSetup: "./tests/browser/global-setup.mjs",
  use: {
    baseURL: APP_ORIGIN,
    storageState: path.resolve(process.cwd(), AUTH_STATE_PATH),
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3115",
    url: `${APP_ORIGIN}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: localSupabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? "",
      SUPABASE_OWNER_USER_ID: process.env.SUPABASE_OWNER_USER_ID ?? "",
      APP_URL: APP_ORIGIN,
      FAYLO_BROWSER_TEST: "1",
    },
  },
});
