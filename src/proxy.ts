import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthCookieOptions, getSupabaseEnvironment } from "@/lib/auth/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const environment = getSupabaseEnvironment();

  if (environment) {
    const supabase = createServerClient(environment.url, environment.publishableKey, {
      cookieOptions: getAuthCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        },
      },
    });

    try {
      // Refresh the cookie session; protected pages and APIs independently verify with auth.getUser().
      await supabase.auth.getClaims();
    } catch {
      // Unavailable or invalid sessions never grant access in the server-side owner guard.
    }
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
