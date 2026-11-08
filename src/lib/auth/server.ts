import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  determineOwnerAccess,
  type OwnerAccessResult,
  type SessionVerification,
} from "./access-policy";
import {
  AUTH_RETURN_TO_COOKIE,
  getAuthCookieOptions,
  getConfiguredOwnerUserId,
  getSupabaseEnvironment,
} from "./config";

export async function createSupabaseServerClient() {
  const environment = getSupabaseEnvironment();
  if (!environment) throw new Error("Supabase server configuration is unavailable.");

  const cookieStore = await cookies();
  return createServerClient(environment.url, environment.publishableKey, {
    cookieOptions: getAuthCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies; src/proxy.ts persists refreshed sessions.
        }
      },
    },
  });
}

function isRetryableAuthFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return true;
  const status = error.status;
  return typeof status !== "number" || status === 0 || status === 429 || status >= 500;
}

export async function getOwnerAccess(): Promise<OwnerAccessResult> {
  const ownerUserId = getConfiguredOwnerUserId();
  const environment = getSupabaseEnvironment();
  if (!environment || !ownerUserId) return { status: "misconfigured" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    let session: SessionVerification;

    if (error) {
      session = isRetryableAuthFailure(error) ? { kind: "unavailable" } : { kind: "invalid" };
    } else if (!data.user) {
      session = { kind: "missing" };
    } else {
      session = { kind: "verified", userId: data.user.id };
    }

    const status = determineOwnerAccess(session, ownerUserId);
    if (status !== "allowed") return { status };
    if (!data.user) return { status: "unauthenticated" };
    return { status: "allowed", user: { id: data.user.id, email: data.user.email ?? null } };
  } catch {
    return { status: "unavailable" };
  }
}

export async function requireOwner(): Promise<{ id: string; email: string | null }> {
  const access = await getOwnerAccess();
  if (access.status === "allowed") return access.user;

  const error = {
    unauthenticated: "session",
    forbidden: "not-authorized",
    misconfigured: "configuration",
    unavailable: "auth-unavailable",
  }[access.status];
  redirect(`/login?error=${error}`);
}

export async function clearOAuthAttemptCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-") && /-code-verifier(?:\.\d+)?$/.test(name)) cookieStore.delete(name);
  }
  cookieStore.delete(AUTH_RETURN_TO_COOKIE);
}

export async function clearSupabaseAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-") && name.includes("-auth-token")) cookieStore.delete(name);
  }
  cookieStore.delete(AUTH_RETURN_TO_COOKIE);
}
