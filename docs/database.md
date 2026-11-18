# Faylo database foundation

This schema implements the financial tables and RPCs for account balance projection and transaction entry/reporting. It is a PostgreSQL/Supabase database foundation, not a hosted deployment.

## Schema

| Table | Purpose and lifecycle |
|---|---|
| `user_preferences` | One row per approved Auth user; default base currency `JPY`, timezone `Asia/Tokyo`. |
| `accounts` | Bank, cash, and investment balance-tracked accounts. The opening amount and inclusive `opening_as_of` date are immutable. Currency and account kind are also immutable; archive instead of deleting a referenced account. Credit cards are not accounts. |
| `payment_methods` | Cash, debit, credit-card, bank-transfer, and other payment methods. A credit card cannot link to an account. Method type and linked account are immutable; archive instead of deleting a referenced method. |
| `categories` | Income or expense categories with an optional same-owner, same-kind parent. Kind and parent are immutable; archive instead of deleting a referenced category. |
| `category_budgets` | Owner-scoped monthly JPY limits for exact expense categories; same-owner/category-kind FK, whole-yen validation, unique owner/month/category key, RLS, and update timestamp. |
| `transactions` | Immutable economic events with a per-owner idempotency key; `occurred_at` is the economic effective instant and `occurred_on` its local booking/reporting date. |
| `account_entries` | Immutable, signed balance movements. The composite foreign keys bind each entry to the same owner's transaction and to the account's currency. `recorded_at` is persistence time, not event time; entries are written only by `post_transaction`. |
| `transaction_corrections` | Immutable owner-scoped audit linkage from a voided original transaction to its posted replacement, including the correction reason. |
| `fx_rate_cache` | Owner-scoped cache of exact Frankfurter v2 observations and provider provenance for requested currency pairs/dates. |
| `transaction_reporting_fx_snapshots` | Owner-scoped, append-only JPY reporting conversions and manual revision audit for transactions. |

Every user-owned row references `auth.users`. Composite `(user_id, id)` foreign keys prevent cross-owner account, category, payment-method, transaction, and entry references. Foreign keys restrict deletion of referenced financial records; no cascade can silently erase a posted event.

### Event semantics

- Account movements are dated inclusively: `occurred_on >= accounts.opening_as_of`. The opening date is interpreted in the configured user timezone.
- The RPC accepts `p_occurred_on` and optional `p_occurred_at`. The user's timezone (default `Asia/Tokyo`) determines the local date. If the timestamp is omitted, it is local midnight on `p_occurred_on`; if supplied, it must fall on that date in the configured timezone. Send explicit timestamps with a timezone offset. Date-only events on the same day share the midnight fallback and have no finer ordering; provide an exact time when ordering against a same-day valuation matters.
- Balance-as-of queries include only `posted` transactions with `occurred_on >= opening_as_of` and `occurred_at <= as_of`; the as-of value is an instant (normally the current time for the current balance). Future-effective posted events are excluded until their effective time. Never use `recorded_at` or transaction `created_at` as economic time.
- For a future investment valuation query, select the latest snapshot with `valued_at <= as_of`, then add posted account entries with `transaction.occurred_at > valued_at AND transaction.occurred_at <= as_of`. The strict lower bound makes an exact-time tie part of the absolute snapshot, not an additional movement. Valuation storage is not part of this issue.
- Income requires one positive entry when assigned. Expenses paid by cash/debit or another assigned method require one matching negative entry. An intentionally unassigned income/expense is represented by a null payment method and no entries; it still counts in income/expense reports and must be surfaced for reconciliation. A no-entry event cannot predate the earliest account opening date.
- A credit-card expense requires a credit-card payment method and has no account entry. It remains an expense, not a liability balance.
- A `card_settlement` requires an active credit-card payment method owned by the caller, one negative bank/cash entry, and no category. Its exact amount and currency must match the funded account entry. The account balance reflects it from its payment date; it is excluded from income and expense totals.
- A transfer has exactly two entries, one positive and one negative, on distinct accounts. Same-currency legs must net to zero; cross-currency legs retain the actual debit and credit amounts independently. Transfers are not income or expenses.
- A balance adjustment has exactly one entry, a signed amount, and a non-empty reason. It is excluded from income/expense reports.
- Investment accounts participate in transfers and account movements. Expenses and card settlements cannot debit an investment account. Manual valuation snapshots are outside this issue.

## Exact monetary representation

Amounts use PostgreSQL `numeric` in **major currency units**, not binary floating point and not a rounded `numeric(p,s)` column. For example, USD `12.34` is stored as `12.34`, while JPY `1234` and VND `1234` are whole units. The database rejects non-finite values and values not exactly representable at the currency's fractional scale; it does not round an over-precise input.

The immutable scale helper uses 0 fraction digits for JPY/VND and other standard zero-digit currencies, 2 for USD and standard two-digit currencies, 3 for standard three-digit currencies, and 4 for CLF/UYW. Other uppercase three-letter codes default to two digits. The schema checks code shape, not membership in a live ISO currency registry; add an explicit scale rule when enabling a code with a nonstandard exponent.

`post_transaction` accepts all amounts as decimal **strings** (`p_amount` text and entry JSON `amount` strings). JSON numeric values and exponent notation are rejected. Application code must pass strings through the Supabase client and must not parse, add, or multiply money using JavaScript `number`. FX rates are stored as exact PostgreSQL `numeric`; the application preserves provider decimal tokens and uses exact decimal arithmetic.

The table schema is not itself a precision-safe read contract. `public.account_balances_as_of(p_as_of)` returns opening amounts and computed balances as decimal text; all addition occurs in PostgreSQL. Never expose raw `numeric` as JSON numbers.

`public.transaction_totals(p_month_start)` preserves exact native-currency totals grouped by kind and currency and returns JPY reporting metadata: resolved JPY subtotal, resolved count, unresolved count, and included count. The JPY subtotal is partial when unresolved rows exist. Both native and JPY report counts use posted transactions with `occurred_at <= statement_timestamp()` and the same owner-local month. The output retains native currency rows and repeats the report-wide JPY metadata on each; callers aggregate that metadata once. An omitted month uses the current month in the owner's configured timezone.

### Dashboard and budget reporting

`public.monthly_dashboard_totals(p_month_start, p_month_count)` returns per-month native income/expense rows plus stored JPY snapshot totals and tracking metadata. The report uses the owner's local `occurred_on` month and the existing `occurred_at <= statement_timestamp()` economic cutoff; it includes only posted income/expense. It keeps valid transactions from before later account openings rather than suppressing all older months. Each month is marked `fully_tracked`, `partial_account_coverage`, or `insufficient_history`, including explicit empty rows; a zero-spending month is complete only when coverage is fully tracked. Historical changes are shown only for adjacent completed months with matching account-coverage signatures; month-to-date and differing-coverage periods are not compared.

`public.monthly_category_spending(p_month_start)` groups posted expenses by their exact assigned category and native currency and exposes the resolved/unresolved JPY snapshot counts and any `category_budgets.limit_jpy`. Budgets cover directly assigned transactions only; descendants are not silently included, and parent rows do not roll up children. These category rows are not re-summed for overall spending. If any included conversion is unresolved, the application omits a definitive progress percentage and remaining budget rather than treating it as zero.

- `public.list_transactions(...)` returns bounded, owner-scoped income, expense, card-settlement, own-account-transfer, and balance-adjustment history. Movement events include exact signed per-account decimal strings, account names, native currencies, recording times, source, and adjustment/void audit fields. Income/expense rows include their current JPY reporting snapshot and revision history. Transfers and adjustments have no category and are excluded from `transaction_totals`; cross-currency transfers retain actual sent and received amounts without an inferred exchange rate. Search covers merchant, note, category, payment method, account names, adjustment reason, and void reason. Date filters use the stored owner-local `occurred_on` date.

## Historical JPY reporting FX

Foreign income and expense events retain their original amount and currency. Frankfurter v2 is the sole initial provider; the resolver requests the direct source-currency-to-JPY pair using the event's Tokyo economic date, selects the latest observation on or before that date, and rejects observations more than seven calendar days old. Snapshots retain the rate's actual effective date, provider provenance, fetch time, and exact converted JPY amount. Conversion rounds each transaction to a whole yen, half away from zero, before monthly summation. JPY-native transactions use rate-one identity conversions.

Future-effective conversions remain pending until eligible. Missing, stale, malformed, or unavailable provider data leaves native transaction storage intact and produces an explicitly unresolved state; it is not converted to ¥0 or replaced with today's rate. A manual revision requires an explanation and effective date, is appended to immutable snapshot history, and is serialized/idempotent per transaction. Automatic resolution cannot supersede the latest manual revision.

When a `pending_future` event reaches its Tokyo economic date, opening its transaction detail runs the on-demand resolver; eligible unresolved/unavailable events can be retried from that page. Resolution appends an audited snapshot revision. There is no scheduled worker or hosted FX job.

The FX cache and snapshot history are owner-scoped under forced RLS. Authenticated users can read only their own records; writes and revision logic go through owner-checked RPCs. JPY reporting is presentation/reporting data only: account balances, transfers, and investment values remain in their native currencies.

## Account balance projection

`public.account_balances_as_of(p_as_of)` is an authenticated, invoker-rights read function. It checks the approved owner and queries with that session’s RLS. It returns active and archived accounts, `opening_balance` as exact decimal text, and computed `balance` as nullable exact decimal text; callers do not provide a user ID. Its default as-of instant is the database statement time.

On or after midnight at the start of `opening_as_of` in the user’s configured timezone, the balance is the immutable opening snapshot plus account entries whose parent transaction is currently `posted` (not voided), whose `occurred_on >= opening_as_of`, and whose economic `occurred_at <= p_as_of`. Before that instant, `balance` is `NULL`, not the opening snapshot. PostgreSQL performs the exact `numeric` sum. `recorded_at` is not used. Opening dates are date-only and inclusive; future-effective entries are excluded until their effective instant.

Account onboarding inserts one account row only. It does not create a transaction or an income/expense event. The server uses the authenticated session and the existing owner-scoped RLS grants; active accounts can change only `name` and `include_in_assets`, or transition to archived. The account kind, currency, opening amount, and opening date remain immutable. The current schema permits signed opening balances; this issue adds no nonnegative restriction. Archived accounts remain readable but are immutable after the one-way archive transition, including to direct owner updates.

The owner may delete an active or archived account only when `account_entries` has no rows for it and `payment_methods` has no matching `linked_account_id`. The server-side preflight counts every entry, including entries whose transaction is voided. The final owner-scoped `DELETE` matches the exact name the user confirmed, so a rename between confirmation and deletion leaves the account intact and requests fresh confirmation. The delete also relies on existing `ON DELETE RESTRICT` foreign keys as the final defense against dependencies added after the preflight; a foreign-key violation is returned as a blocked deletion, not retried or bypassed. Future account references must keep restrictive foreign keys and should be added to the preflight if they need a specific user-facing blocker. Deleting an unused archived account performs no update, so the archived-account update guard remains unchanged. No schema migration is required.

The current schema has no investment valuation table. For this issue, an investment account balance is its opening snapshot plus eligible posted account entries; this is not a market valuation.

The dashboard's primary Tracked Assets aggregate includes active bank/cash accounts marked for inclusion, grouped by native currency. Investment account ledgers are shown separately and labeled as ledger balances, not market value, until Issue #11 provides valuations. Account balances are never summed across currencies or converted to estimate net worth without an approved conversion design.

## Atomic posting, idempotency, and voiding

Clients can read `transactions` and `account_entries`, but cannot insert, update, or delete them directly. The authenticated owner calls `public.post_transaction(...)`; the security-definer RPC validates the caller, event/category/payment-method compatibility, account ownership/currency/opening date, and entry count/sign, then inserts the event and all entries in one PostgreSQL statement/transaction. Any constraint or entry error rolls the entire call back.

The caller supplies a UUID `p_idempotency_key` and must reuse it for retries of the same logical operation. A repeated key with the same normalized event fields, exact `occurred_at`, and exact account legs returns the original transaction ID without adding rows. Reusing a key with different contents—including a different effective timestamp—raises a unique-violation error. A retry after voiding returns the original voided event; it never resurrects it.

Posted events and entries are append-only. `public.void_transaction(id, reason)` permits one `posted` → `voided` transition, records `voided_at`, `voided_by`, and a mandatory reason, and retains the original transaction and entries for audit. A second void fails. `public.correct_transaction(...)` corrects a manual income or expense by atomically voiding it and posting a replacement under a new caller-supplied idempotency key, then preserving the original/replacement link and reason in immutable audit history. A failed replacement rolls the void back. Reusing the key with the same original, reason, and exact replacement payload returns the existing replacement; mismatched retries fail before another void. Standalone voids remain available when no replacement is wanted.

## Database authorization

All user-owned tables have RLS enabled and forced, with policies requiring both `auth.uid() = user_id` and membership in `private.owner_allowlist`. The allowlist has a singleton key, an Auth-user foreign key, no grants to `anon` or `authenticated`, and lives in the `private` schema. The local API schema list exposes `public`, `storage`, and `graphql_public`, not `private`.

This is stricter than `auth.uid() = user_id`: a different authenticated Google user cannot read records or create a Faylo row with their own UUID. Table grants are also explicit; anonymous users have no table access. Posting, voiding, and correction RPCs are executable only by `authenticated` and re-check the allowlisted session inside each function. These security-definer RPCs pin an empty `search_path` and schema-qualify referenced objects. Transaction list and totals RPCs use invoker rights and the same owner check with RLS-backed reads.

The database owner UUID and the server-side `SUPABASE_OWNER_USER_ID` must be the same value. Provisioning is deny-first:

1. Apply the reviewed migrations to the intended Faylo project while the allowlist is empty. All financial access remains denied.
2. Complete the Issue #2 Google sign-in bootstrap once. In Supabase Dashboard → Authentication → Users, copy the approved user's Supabase **User UID**. Do not use email or client metadata.
3. Configure that UUID as the server-only `SUPABASE_OWNER_USER_ID` using the existing authentication setup, then use the trusted Supabase SQL Editor as the project database administrator to provision the database allowlist:

   ```sql
   INSERT INTO private.owner_allowlist (singleton, owner_user_id)
   SELECT true, id
   FROM auth.users
   WHERE id = '<approved-owner-uuid>'::uuid
   RETURNING owner_user_id;
   ```

   Confirm exactly one row is returned and that its UUID matches the server configuration. This placeholder is not an actual Faylo owner ID. The authenticated browser role cannot select or modify the allowlist. Owner changes are a privileged operational decision because the allowlisted identity can access the existing records.
4. Confirm anonymous access and a second authenticated test account remain denied. Disable additional sign-ups as described in `docs/authentication.md` when appropriate.

Account pages and Server Actions use the user's authenticated server-side Supabase session; the browser never accesses Supabase directly. Database RLS remains active for these requests. Never put a `service_role`/secret key in browser or normal server request paths; it is unnecessary here and bypass-capable roles are outside this RLS boundary.

## Migrations and tests

Install the Supabase CLI and Docker using the official Supabase local-development instructions. From the repository root:

```bash
npx --yes supabase@2.122.1 start
npx --yes supabase@2.122.1 db reset --local  # destructive to the local Supabase database only
npm run test:db                              # pgTAP integration tests
npm run test:db:upgrade                 # local-only upgrade test with synthetic pre-Issue #8 transactions
npx playwright install chromium             # once per local browser environment
npm run test:browser                         # authenticated UI smoke test with synthetic local data
SAVE_BROWSER_SCREENSHOTS=1 npm run test:browser -- --grep "Issue 8" # Issue 8 resolved/pending/incomplete desktop and mobile screenshots
npx --yes supabase@2.122.1 stop --no-backup
```

`supabase db reset --local` rebuilds the database from versioned migrations and is the clean-database migration check. Never add `--linked` to a local reset command. `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` cover application checks. GitHub Actions also runs local Supabase/PostgreSQL integration and authenticated browser smoke tests on pull requests.

`npm run test:db:upgrade` deliberately rebuilds only the local database to the last pre-Issue #8 migration, inserts synthetic historical/current/future transactions, applies the FX migration, and runs pgTAP assertions against the pre-existing rows. It then restores a clean current local schema; it never targets a linked or hosted project.

The browser setup accepts loopback Supabase URLs only. Each invocation creates a unique synthetic Auth user, updates the local owner allowlist, and writes its session to ignored test artifacts; it does not reset or delete local database state. The service-role key is confined to that local test fixture, while app routes and financial changes use the user's authenticated session. Existing transaction browser flows exercise the UI; the Issue 8 FX regression seeds synthetic rows through authenticated local RPCs, applies manual revisions in the UI, and captures desktop/mobile reporting states. Do not run it against hosted Faylo.

Issue #9 browser regressions cover authenticated budget creation/progress, month coverage messaging, transaction-summary invariants, native-currency Tracked Assets, the separate investment ledger label, and a 390px mobile viewport. The fixtures and screenshots use synthetic local data only.

The test suite verifies provider-response parsing, transaction posting, and FX snapshot storage separately; it does not exercise the complete `post_transaction` → automatic resolver → Frankfurter HTTP lookup → snapshot persistence path. Deterministic end-to-end coverage would require provider transport injection or external HTTP interception in the Next.js server test process, so this issue records the gap rather than adding test-only networking infrastructure.

The pgTAP suite uses only synthetic Auth identities and financial values inside a rolled-back transaction. It covers RLS for owner, non-owner, and anonymous roles; cross-owner FKs; exact JPY/VND/USD values and text-returning balances; before/on/after opening-date boundaries in the configured timezone; posted, voided, corrected, and future-effective account entries; account creation, rename, asset inclusion, archive, deletion of unused active and archived accounts, and rejection of deletion with linked methods or posted/voided entries; owner-only deletion and foreign-key protection when a dependency appears after preflight; retry conflicts, payment-method/account mismatch, archived accounts and methods, category/payment semantics; cash/debit, credit-card, and unassigned posting; cross-month card purchases and settlements, exact-once account debits, card-settlement history, required active owner-owned credit-card methods, rejection of missing/archived/non-credit-card/foreign-owner methods and currency mismatches, voided settlement balance restoration without spending changes; same- and cross-currency transfers, atomic rollback on a failed transfer leg, investment-account movements, signed reasoned adjustments, transfer/adjustment history and audit search, voided balance reversal, correction rollback/audit/idempotency; native-currency monthly totals, filtered transaction history, standalone voiding, and authorization. Issue 8 FX pgTAP assertions cover exact JPY rounding, owner isolation, actual effective dates, stale/future rejection, cache/snapshot idempotency, manual revision audit and precedence, unchanged native amounts, and future-event exclusion from today's JPY subtotal and unresolved count.

## Safe hosted deployment process

No migration in Issue 8 has been applied to the hosted Faylo project. Do not run a remote migration without explicit owner approval. When approved:

1. Confirm the target project reference and environment, check the current migration history/schema, and create and verify a recoverable database backup (including a tested restore or point-in-time recovery plan). Do not rely on a local reset as a hosted backup.
2. Review the exact migration diff and any project-specific objects/privileges with the owner. Issue #3 creates the financial schema and private owner allowlist; Issue #4 adds the owner-checked invoker-rights account balance projection, opening-date effectiveness, and an archived-account immutability guard; Issue #5 adds correction audit linkage and RPCs for correction, transaction history, and native-currency monthly totals; Issue #6 extends transaction history to include card settlements without changing expense totals; Issue #7 adds transfer and balance-adjustment movements plus audit-aware history, without changing `post_transaction` or report semantics; Issue #8 adds owner-scoped historical FX cache/snapshots, audit RPCs, and JPY reporting metadata without changing native transaction amounts or account balances. These migrations do not seed real owner data or alter existing financial rows.
3. Authenticate the Supabase CLI with an approved operator credential, link only the Faylo project (`supabase link --project-ref <project-ref>`), and review `supabase migration list --linked`. Do not copy credentials into the repository or client environment.
4. With approval, apply the pending migrations using `supabase db push --linked` during a controlled change window. Stop on any unexpected migration-history or schema difference; do not use repair/reset commands to force deployment.
5. Provision the allowlist as above, verify owner and non-owner RLS through the API, inspect the resulting schema/migration history, and record the deployment and backup reference. If any step fails, stop and use the verified restore plan; do not improvise a destructive rollback against financial data.

The hosted project was not linked, queried, or changed for Issues #3–#8. The account-balance, transaction-experience, card-settlement-history, own-account-movement-history, and historical FX reporting migrations are not deployed.

The Issue #9 dashboard/budget migration has not been applied to hosted Faylo.

## Known limitations and future integration points

- Historical transaction JPY reference reporting and the Issue #9 dashboard/budget schema are implemented locally. Account balances, cross-currency transfers, and investment valuations are not converted to JPY. Scheduled items, investment valuation snapshots, tracked liabilities, and Telegram integration remain deferred. Transfers retain actual native legs but do not record an executed FX rate.
- Category hierarchy changes and account opening baselines are immutable through ordinary client grants. Use a new category/account or explicit adjustment rather than rewriting financial history.
- Unassigned income/expenses have no balance movement and appear in history marked for reconciliation. Credit-card expenses are distinguished from unassigned expenses and have no tracked card liability or bank movement.
- The currency scale mapping is a static ISO-style exponent map with a two-digit default, not a currency registry. Unknown codes with zero/three/four digits need an explicit mapping before use.
- The schema provides exact-text account balances, native-currency transaction totals, and historical transaction JPY reporting, but no JPY conversion for account/investment balances or historical `updated_by` log for preference/configuration edits. Posted financial events and their voids/correction links are auditable; broader data export/backup workflows remain future work.
- Faylo permits owner-initiated deletion of active or archived accounts only when no account entries (posted or voided) and no linked payment methods exist. Current account references use `ON DELETE RESTRICT`; future account references must retain restrictive foreign keys. Auth user deletion remains restricted while Faylo rows exist, and broader data-retention workflows remain administrator-managed.

## Official references

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS defaults, policy behavior, private helper functions.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) — publishable keys versus secret/service-role bypass-capable keys.
- [Supabase local CLI config](https://supabase.com/docs/guides/local-development/cli/config) — local project configuration and exposed API schemas.
- [Supabase database testing and pgTAP](https://supabase.com/docs/guides/local-development/testing/overview) and [RLS testing](https://supabase.com/docs/guides/database/postgres/testing-row-level-security) — local migration/test workflow and role/JWT test setup.
- [Frankfurter API v2](https://www.frankfurter.dev/) — historical exchange-rate endpoint and provider metadata.
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — table privileges and RLS interaction.
- [PostgreSQL `CREATE FUNCTION`](https://www.postgresql.org/docs/current/sql-createfunction.html) — `SECURITY DEFINER` and safe `search_path` handling.
- [PostgreSQL Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html) — exact decimal versus inexact floating-point values.
- [PostgreSQL Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — check, unique, and foreign-key behavior.
- [PostgreSQL Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html) — all-or-nothing transaction semantics.
