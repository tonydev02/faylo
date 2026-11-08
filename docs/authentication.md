# Google OAuth and Supabase setup

Faylo uses Supabase Auth with Google OAuth. Sign-in creates a Supabase Auth user, but the application grants access only when the server verifies that user's Supabase UUID against `SUPABASE_OWNER_USER_ID`. There is no email allowlist and no default owner. If the owner ID is absent or invalid, access is denied.

## 1. Create a Supabase project

1. Create a project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. In **Project Settings → API** (or the project's **Connect** panel), copy the Project URL and the **publishable** key. A legacy `anon` key is also a public key; either is safe for browser use. Faylo currently reads it only from server-only code.
3. Do not use a `sb_secret_...` key or legacy `service_role` key. Faylo does not need a service-role key, and the application rejects one in the publishable-key setting.

## 2. Configure Google OAuth

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the Google Auth Platform consent screen, audience, and test users if the app is still in testing. Request only the `openid`, `email`, and `profile` scopes.
3. Create an OAuth client with application type **Web application**.
4. Add the Faylo site origins under **Authorized JavaScript origins**:
   - Local: `http://localhost:3000`
   - Production: `https://your-domain.example`
5. Add the Supabase Auth callback shown on Supabase's **Authentication → Sign-in providers → Google** page under **Authorized redirect URIs**. It normally has this form:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
   - Use the exact callback shown for your project, especially if you use a custom Supabase Auth domain.
6. Copy the Google OAuth client ID and client secret into the Supabase Google provider settings. Keep the client secret in Supabase only; it is not an application environment variable.
7. Enable Google sign-in and save the provider configuration.

Google redirects to Supabase's `/auth/v1/callback`; Supabase then redirects to Faylo's `/auth/callback`. These are different URLs and both parts of the flow must be configured.

## 3. Configure Supabase Auth URLs

In **Authentication → URL Configuration**:

- Set **Site URL** to the Faylo app origin (`APP_URL`), for example `http://localhost:3000` locally or `https://your-domain.example` in production.
- Add the exact Faylo callback URLs to **Redirect URLs**:
  - `http://localhost:3000/auth/callback`
  - `https://your-domain.example/auth/callback`
- Do not add broad production wildcards. Add a separate exact callback for each deployed origin.

## 4. Set local environment variables

From the repository root:

```bash
cp .env.example .env.local
```

Set these values in `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-public-key>
APP_URL=http://localhost:3000
SUPABASE_OWNER_USER_ID=
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` identify the public Supabase project. Do not paste a secret/service-role key into either variable. `APP_URL` is the server's canonical origin; it must be an origin without a path, query, or fragment. `SUPABASE_OWNER_USER_ID` is private server configuration, not a `NEXT_PUBLIC_` variable.

Run `npm ci` if needed, then `npm run dev`.

### Approve the owner UUID (first-time bootstrap)

The owner UUID does not exist until Google creates the Supabase Auth user. Bootstrap is deliberately deny-first:

1. With `SUPABASE_OWNER_USER_ID` blank, complete Google sign-in once. Supabase creates the Auth user, but Faylo denies the callback, clears its local session cookies, and does not render the private app.
2. In **Supabase Dashboard → Authentication → Users**, find that Google user and copy the Supabase **User UID**.
3. Set `SUPABASE_OWNER_USER_ID=<copied-uuid>` in `.env.local` and restart the dev server.
4. Sign in again. The server calls Supabase `auth.getUser()` and compares its verified user ID with this exact UUID.
5. After creating the owner, disable additional sign-ups in Supabase Auth if that option is enabled for your project. Existing owner sign-in must continue to work after the change.

Do not substitute a client-supplied email, user ID, or user metadata for this server-side UUID. If the wrong UUID is configured, Faylo denies access; update it only from the trusted Supabase Auth Users dashboard.

## 5. Configure production

In the production hosting provider's server environment, set:

- `NEXT_PUBLIC_SUPABASE_URL` — the production Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the project's publishable key (or legacy `anon` key).
- `APP_URL` — the canonical HTTPS origin, such as `https://your-domain.example`.
- `SUPABASE_OWNER_USER_ID` — the approved Supabase Auth UUID.

Set the values in the server's Production environment and redeploy. Keep `SUPABASE_OWNER_USER_ID` server-only. Never define a service-role key for Faylo or commit `.env.local`. If preview deployments are enabled, configure their exact OAuth callback URLs and use an intentionally approved test user; do not copy production owner access into an untrusted preview environment.

## 6. Verify the complete flow

1. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
2. With configuration present, open `APP_URL` in a private browser session. The private root route must redirect to `/login`.
3. Sign in with the approved Google account. Faylo should return to the local app origin and show the private workspace and a sign-out action.
4. Sign out; the browser session should be cleared and the login page should be shown.
5. Sign in with a different Google account. It must be rejected, signed out, and never shown the dashboard.
6. Request `/api/auth/session`: anonymous/expired/invalid sessions receive `401`; authenticated but unapproved users receive `403`; only the approved owner receives `200` with `{ "authenticated": true }`. Responses are `private, no-store`.
7. Confirm production uses HTTPS and inspect the Supabase auth cookie: it is `HttpOnly`, `Secure` in production, and `SameSite=Lax`.

Faylo's proxy refreshes Supabase cookies, but the private page and API also verify the user server-side with `auth.getUser()`. OAuth callback redirects use the configured `APP_URL`, never the request `Host` or forwarded-host headers. The optional return path is stored in an HttpOnly cookie and reduced to a same-origin application path.

## Architecture and scope

- `src/proxy.ts` uses Supabase's current App Router SSR pattern to refresh cookie sessions with `auth.getClaims()` and preserve refreshed cookies/cache headers.
- The root dashboard, account pages, and account Server Actions call `requireOwner()` before reading or writing account data. `GET /api/auth/session` uses the same owner verification and returns no user data.
- `src/app/auth/callback/route.ts` exchanges the OAuth PKCE code, obtains the verified Supabase user with `auth.getUser()`, enforces the configured UUID, and clears rejected sessions.
- Google email and browser-provided identity values are not authorization inputs. No Supabase service-role key is used.
- Missing, expired, invalid, unapproved, and unavailable sessions fail closed. Account onboarding and account balance projections use the verified owner's RLS-protected session; transaction entry and reporting UI remain outside Issue #4.

## Owner setup still required

No Supabase or Google project credentials are stored in this repository. The product owner must create/configure both projects, provide the local and production environment values, bootstrap the owner UUID, and authorize the deployment domain. Live Google OAuth cannot be verified until those external steps are complete.

## Official references

- [Supabase SSR authentication for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase JavaScript `auth.getUser()`](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Next.js authentication and authorization](https://nextjs.org/docs/app/guides/authentication)
- [Next.js `proxy.ts` convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
