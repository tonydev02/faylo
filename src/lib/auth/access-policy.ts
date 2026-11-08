export type SessionVerification =
  | { kind: "verified"; userId: string }
  | { kind: "missing" | "invalid" | "expired" | "unavailable" };

export type OwnerAccessStatus =
  | "allowed"
  | "unauthenticated"
  | "forbidden"
  | "misconfigured"
  | "unavailable";

export type OwnerAccessResult =
  | { status: "allowed"; user: { id: string; email: string | null } }
  | { status: Exclude<OwnerAccessStatus, "allowed"> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNAL_ORIGIN = "https://faylo.invalid";

export function isValidSupabaseUserId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function determineOwnerAccess(
  session: SessionVerification,
  ownerUserId: string | null | undefined,
): OwnerAccessStatus {
  if (!isValidSupabaseUserId(ownerUserId)) return "misconfigured";
  if (session.kind === "unavailable") return "unavailable";
  if (session.kind !== "verified") return "unauthenticated";
  return session.userId.toLowerCase() === ownerUserId.trim().toLowerCase() ? "allowed" : "forbidden";
}

export function safeReturnPath(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001F\u007F]/.test(value)
  ) {
    return "/";
  }
  try {
    const target = new URL(value, INTERNAL_ORIGIN);
    if (
      target.origin !== INTERNAL_ORIGIN ||
      target.username ||
      target.password ||
      target.pathname.startsWith("//")
    ) {
      return "/";
    }
    if (target.pathname === "/login" || target.pathname === "/auth/callback" || target.pathname.startsWith("/api/")) {
      return "/";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
