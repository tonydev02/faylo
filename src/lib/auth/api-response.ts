import type { OwnerAccessResult } from "./access-policy";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export function createAuthSessionHandler(resolveAccess: () => Promise<OwnerAccessResult>) {
  return async function GET(): Promise<Response> {
    let access: OwnerAccessResult;
    try {
      access = await resolveAccess();
    } catch {
      access = { status: "unavailable" };
    }

    if (access.status === "allowed") {
      return Response.json({ authenticated: true }, { headers: NO_STORE_HEADERS });
    }

    const response = {
      unauthenticated: { status: 401, error: "unauthorized" },
      forbidden: { status: 403, error: "forbidden" },
      misconfigured: { status: 503, error: "auth_unavailable" },
      unavailable: { status: 503, error: "auth_unavailable" },
    }[access.status];

    return Response.json({ error: response.error }, { status: response.status, headers: NO_STORE_HEADERS });
  };
}
