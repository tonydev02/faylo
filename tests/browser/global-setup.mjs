import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_ORIGIN, AUTH_STATE_PATH, TEST_EMAIL, TEST_OWNER_ID, TEST_PASSWORD } from "./constants.mjs";

function requireLoopbackUrl(value) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Browser smoke setup is restricted to a loopback Supabase project.");
  }
  return url.origin;
}

async function readResponse(response, description) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new Error(`${description}: ${message}`);
  }
  return body;
}

export default async function globalSetup() {
  const url = requireLoopbackUrl(process.env.LOCAL_SUPABASE_URL ?? "");
  const publishableKey = process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? "";
  const serviceRoleKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!publishableKey || !serviceRoleKey) throw new Error("Run `npm run test:browser` to provide local Supabase test keys.");

  const adminHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const existingResponse = await fetch(`${url}/auth/v1/admin/users/${TEST_OWNER_ID}`, { headers: adminHeaders });
  if (existingResponse.status === 404) {
    await readResponse(await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ id: TEST_OWNER_ID, email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
    }), "Could not create synthetic local Auth user");
  } else {
    await readResponse(existingResponse, "Could not inspect synthetic local Auth user");
    await readResponse(await fetch(`${url}/auth/v1/admin/users/${TEST_OWNER_ID}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
    }), "Could not refresh synthetic local Auth user");
  }

  const sql = `INSERT INTO private.owner_allowlist (singleton, owner_user_id) VALUES (true, '${TEST_OWNER_ID}') ON CONFLICT (singleton) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id;`;
  const allowlist = spawnSync("npx", ["--yes", "supabase@2.122.1", "db", "query", "--local", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (allowlist.error) throw allowlist.error;
  if (allowlist.status !== 0) throw new Error(`Could not provision the local-only owner allowlist: ${allowlist.stderr || allowlist.stdout}`);

  const signIn = await readResponse(await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  }), "Could not sign in synthetic local browser user");
  if (typeof signIn.access_token !== "string" || typeof signIn.refresh_token !== "string") {
    throw new Error("Local Supabase Auth returned an incomplete browser session.");
  }

  // @supabase/ssr stores the JSON Auth session as a base64url-encoded cookie named from the local project host.
  const cookieValue = `base64-${Buffer.from(JSON.stringify(signIn)).toString("base64url")}`;
  const storageState = {
    cookies: [{
      name: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`,
      value: cookieValue,
      domain: new URL(APP_ORIGIN).hostname,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + Number(signIn.expires_in ?? 3600),
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }],
    origins: [],
  };
  const statePath = path.resolve(process.cwd(), AUTH_STATE_PATH);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(storageState));
}
