import "server-only";

import { isValidSupabaseUserId } from "./access-policy";

export const AUTH_RETURN_TO_COOKIE = "faylo_auth_return_to";

export type SupabaseEnvironment = {
  url: string;
  publishableKey: string;
};

function isServiceRoleKey(value: string): boolean {
  if (value.startsWith("sb_secret_")) return true;
  const tokenPayload = value.split(".")[1];
  if (!tokenPayload) return false;

  try {
    const payload: unknown = JSON.parse(Buffer.from(tokenPayload, "base64url").toString("utf8"));
    return typeof payload === "object" && payload !== null && "role" in payload && payload.role === "service_role";
  } catch {
    return false;
  }
}

export function getSupabaseEnvironment(): SupabaseEnvironment | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !publishableKey || isServiceRoleKey(publishableKey)) return null;

  try {
    const url = new URL(rawUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const isSecure = url.protocol === "https:";
    const isLocalHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && isLoopback;
    if (
      (!isSecure && !isLocalHttp) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return { url: url.origin, publishableKey };
  } catch {
    return null;
  }
}

export function getAppOrigin(): string | null {
  const configuredUrl = process.env.APP_URL?.trim();
  const rawUrl = configuredUrl || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const isSecure = url.protocol === "https:";
    const isLocalHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && isLoopback;
    if (
      (!isSecure && !isLocalHttp) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function getConfiguredOwnerUserId(): string | null {
  const ownerUserId = process.env.SUPABASE_OWNER_USER_ID?.trim();
  return isValidSupabaseUserId(ownerUserId) ? ownerUserId : null;
}

export function isOAuthConfigured(): boolean {
  return getSupabaseEnvironment() !== null && getAppOrigin() !== null;
}

export function getAuthCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
