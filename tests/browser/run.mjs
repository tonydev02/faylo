import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { APP_ORIGIN } from "./constants.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

const status = run("npx", ["--yes", "supabase@2.122.1", "status", "--output", "env"]);
if (status.status !== 0) {
  process.stderr.write(status.stderr);
  throw new Error("Local Supabase is unavailable. Start it with `npx --yes supabase@2.122.1 start` first.");
}

const values = new Map();
for (const line of status.stdout.split(/\r?\n/)) {
  const match = /^([A-Z_]+)="(.*)"$/.exec(line);
  if (match) values.set(match[1], match[2]);
}
const url = values.get("API_URL");
const publishableKey = values.get("PUBLISHABLE_KEY") ?? values.get("ANON_KEY");
const serviceRoleKey = values.get("SERVICE_ROLE_KEY");
if (!url || !publishableKey || !serviceRoleKey) throw new Error("Supabase local status did not return the required test settings.");
const parsedUrl = new URL(url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname)) {
  throw new Error("Browser smoke tests accept loopback Supabase URLs only; hosted projects are not supported.");
}

const testOwnerId = process.env.FAYLO_BROWSER_TEST_OWNER_ID ?? randomUUID();
const testEmail = process.env.FAYLO_BROWSER_TEST_EMAIL ?? `issue6-browser-${testOwnerId}@local.test`;
const env = {
  ...process.env,
  LOCAL_SUPABASE_URL: parsedUrl.origin,
  LOCAL_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  NEXT_PUBLIC_SUPABASE_URL: parsedUrl.origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  FAYLO_BROWSER_TEST_OWNER_ID: testOwnerId,
  FAYLO_BROWSER_TEST_EMAIL: testEmail,
  SUPABASE_OWNER_USER_ID: testOwnerId,
  APP_URL: APP_ORIGIN,
};
const result = run("npx", ["playwright", "test", ...process.argv.slice(2)], { env, stdio: "inherit" });
if (result.status !== 0) process.exitCode = result.status ?? 1;
