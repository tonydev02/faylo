"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnPath } from "./access-policy";
import {
  AUTH_RETURN_TO_COOKIE,
  getAppOrigin,
  getAuthCookieOptions,
  getSupabaseEnvironment,
} from "./config";
import {
  clearOAuthAttemptCookies,
  clearSupabaseAuthCookies,
  createSupabaseServerClient,
} from "./server";

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const environment = getSupabaseEnvironment();
  const appOrigin = getAppOrigin();
  if (!environment || !appOrigin) redirect("/login?error=configuration");

  const returnPath = safeReturnPath(String(formData.get("next") ?? ""));
  let authorizationUrl: URL | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const callbackUrl = new URL("/auth/callback", appOrigin).toString();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl },
    });

    if (!error && data.url) {
      const candidate = new URL(data.url);
      if (
        candidate.origin === new URL(environment.url).origin &&
        candidate.pathname === "/auth/v1/authorize"
      ) {
        authorizationUrl = candidate;
      }
    }
  } catch {
    authorizationUrl = null;
  }

  if (!authorizationUrl) {
    await clearOAuthAttemptCookies();
    redirect("/login?error=oauth");
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_RETURN_TO_COOKIE, returnPath, {
    ...getAuthCookieOptions(),
    maxAge: 10 * 60,
  });
  redirect(authorizationUrl.toString());
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Always clear this browser's session cookies, even if Supabase is temporarily unavailable.
  }

  await clearSupabaseAuthCookies();
  redirect("/login?signed-out=1");
}
