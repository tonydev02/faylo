import { redirect } from "next/navigation";
import { Icon } from "@/components/app-shell";
import { signInWithGoogle, signOut } from "@/lib/auth/actions";
import { safeReturnPath } from "@/lib/auth/access-policy";
import { getConfiguredOwnerUserId, isOAuthConfigured } from "@/lib/auth/config";
import { getOwnerAccess } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[]; "signed-out"?: string }>;
};

const errorMessages: Record<string, { title: string; message: string }> = {
  callback: {
    title: "Sign-in did not finish",
    message: "Google sign-in could not be completed. Try again; no Faylo session was accepted.",
  },
  configuration: {
    title: "Sign-in is not configured",
    message: "The owner must finish the private Supabase and application configuration before access is available.",
  },
  "owner-not-configured": {
    title: "Owner approval is required",
    message: "Your Google sign-in created an Auth user, but no Supabase user ID is approved yet. The owner must configure the approved ID before anyone can enter Faylo.",
  },
  "not-authorized": {
    title: "This account is not approved",
    message: "This Google account is not the approved Faylo owner account. No private page or API access was granted.",
  },
  "auth-unavailable": {
    title: "Authentication is temporarily unavailable",
    message: "Faylo could not verify your session with Supabase. Try again in a moment.",
  },
  oauth: {
    title: "Google sign-in could not start",
    message: "Faylo could not create a secure Google sign-in request. Check the setup and try again.",
  },
  session: {
    title: "Sign in again",
    message: "Your session is missing, expired, or could not be verified. No private content was returned.",
  },
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnPath = safeReturnPath(typeof params.next === "string" ? params.next : null);
  const access = await getOwnerAccess();
  const oauthConfigured = isOAuthConfigured();
  const ownerConfigured = getConfiguredOwnerUserId() !== null;

  if (access.status === "allowed") redirect(returnPath);

  const requestedError = typeof params.error === "string" ? params.error : "";
  const error = errorMessages[requestedError] ??
    (access.status === "forbidden" ? errorMessages["not-authorized"] : null) ??
    (access.status === "unavailable" ? errorMessages["auth-unavailable"] : null) ??
    (access.status === "misconfigured" && !oauthConfigured ? errorMessages.configuration : null);
  const signedOut = params["signed-out"] === "1";

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-5 py-10 sm:px-8">
      <section aria-labelledby="login-title" className="w-full max-w-[440px] rounded-[28px] border border-border bg-surface p-6 shadow-2xl shadow-black/20 sm:p-9">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-forest text-mint">
            <Icon className="size-6" name="mark" />
          </span>
          <span className="text-[22px] font-semibold tracking-[-0.055em] text-ink">faylo</span>
        </div>

        <p className="mt-10 text-[12px] font-medium uppercase tracking-[0.12em] text-mint">Private workspace</p>
        <h1 id="login-title" className="mt-3 text-[32px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[36px]">
          Sign in to Faylo
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-muted">
          Continue with the Google account approved for this workspace.
        </p>

        {error && (
          <div aria-live="polite" className="mt-6 rounded-2xl border border-border bg-raised p-4" role="alert">
            <p className="text-[13px] font-medium text-ink">{error.title}</p>
            <p className="mt-1.5 text-[12px] leading-5 text-muted">{error.message}</p>
          </div>
        )}

        {signedOut && !error && (
          <p aria-live="polite" className="mt-6 rounded-2xl border border-border bg-raised p-4 text-[13px] text-muted" role="status">
            You have signed out of this browser.
          </p>
        )}

        {access.status === "forbidden" ? (
          <form action={signOut} className="mt-7">
            <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-border bg-raised px-5 text-[14px] font-medium text-ink transition-colors hover:bg-[#282828]" type="submit">
              Sign out to switch accounts
            </button>
          </form>
        ) : (
          <form action={signInWithGoogle} className="mt-7">
            <input name="next" type="hidden" value={returnPath} />
            <button
              className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl bg-forest px-5 text-[14px] font-medium text-ink transition-colors hover:bg-[#205c45] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!oauthConfigured}
              type="submit"
            >
              Continue with Google
              <Icon className="size-4 text-mint" name="arrow" />
            </button>
          </form>
        )}

        {!oauthConfigured && (
          <p className="mt-4 text-[12px] leading-5 text-muted">
            Google sign-in is unavailable until the owner configures the Supabase URL, publishable key, and canonical app URL.
          </p>
        )}

        {oauthConfigured && !ownerConfigured && (
          <p className="mt-4 rounded-xl border border-forest/50 bg-forest/15 p-3 text-[12px] leading-5 text-muted">
            No valid owner ID is approved yet. Sign-in is denied until the owner configures the approved Supabase user UUID.
          </p>
        )}

        <div className="mt-8 border-t border-border pt-5">
          <p className="text-[12px] leading-5 text-muted">
            Access is checked by the Faylo server against one approved Supabase user ID. Google email addresses and browser-provided identity values do not grant access.
          </p>
        </div>
      </section>
    </main>
  );
}
