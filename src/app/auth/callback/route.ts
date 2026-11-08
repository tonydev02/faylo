import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { determineOwnerAccess, safeReturnPath } from "@/lib/auth/access-policy";
import {
  AUTH_RETURN_TO_COOKIE,
  getAppOrigin,
  getConfiguredOwnerUserId,
} from "@/lib/auth/config";
import {
  clearOAuthAttemptCookies,
  clearSupabaseAuthCookies,
  createSupabaseServerClient,
} from "@/lib/auth/server";

function redirectToLogin(origin: string, error: string): NextResponse {
  const destination = new URL("/login", origin);
  destination.searchParams.set("error", error);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function redirectToApp(origin: string, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const appOrigin = getAppOrigin();
  if (!appOrigin) {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const providerError = searchParams.get("error");
  const cookieStore = await cookies();
  const returnPath = safeReturnPath(cookieStore.get(AUTH_RETURN_TO_COOKIE)?.value);
  cookieStore.delete(AUTH_RETURN_TO_COOKIE);

  if (!code || providerError) {
    await clearOAuthAttemptCookies();
    return redirectToLogin(appOrigin, "callback");
  }

  let codeExchanged = false;

  try {
    const supabase = await createSupabaseServerClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      await clearOAuthAttemptCookies();
      return redirectToLogin(appOrigin, "callback");
    }
    codeExchanged = true;

    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) {
      await supabase.auth.signOut({ scope: "local" });
      await clearSupabaseAuthCookies();
      return redirectToLogin(appOrigin, "callback");
    }

    const access = determineOwnerAccess(
      { kind: "verified", userId: data.user.id },
      getConfiguredOwnerUserId(),
    );

    if (access !== "allowed") {
      await supabase.auth.signOut({ scope: "local" });
      await clearSupabaseAuthCookies();
      return redirectToLogin(appOrigin, access === "misconfigured" ? "owner-not-configured" : "not-authorized");
    }

    return redirectToApp(appOrigin, returnPath);
  } catch {
    if (codeExchanged) {
      await clearSupabaseAuthCookies();
    } else {
      await clearOAuthAttemptCookies();
    }
    return redirectToLogin(appOrigin, "callback");
  }
}
