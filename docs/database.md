# Faylo database foundation

This schema implements the six Issue #3 tables only. It is a PostgreSQL/Supabase foundation, not a financial CRUD service or a hosted deployment.

## Schema

| Table | Purpose and lifecycle |
|---|---|
| `user_preferences` | One row per approved Auth user; default base currency `JPY`, timezone `Asia/Tokyo`. |
| `accounts` | Bank, cash, and investment balance-tracked accounts. The opening amount and inclusive `opening_as_of` date are immutable. Currency and account kind are also immutable; archive instead of deleting a referenced account. Credit cards are not accounts. |
| `payment_methods` | Cash, debit, credit-card, bank-transfer, and other payment methods. A credit card cannot link to an account. Method type and linked account are immutable; archive instead of deleting a referenced method. |
| `categories` | Income or expense categories with an optional same-owner, same-kind parent. Kind and parent are immutable; archive instead of deleting a referenced category. |
| `transactions` | Immutable economic events with a per-owner idempotency key. `income`, `expense`, and `card_settlement` have positive amounts; `balance_adjustment` has a signed amount and mandatory reason; `transfer` has no aggregate amount because its legs may use different currencies. |
| `account_entries` | Immutable, signed balance movements. The composite foreign keys bind each entry to the same owner's transaction and to the account's currency. Entries are written only by `post_transaction`. |

Every user-owned row references `auth.users`. Composite `(user_id, id)` foreign keys prevent cross-owner account, category, payment-method, transaction, and entry references. Foreign keys restrict deletion of referenced financial records; no cascade can silently erase a posted event.

### Event semantics

- Account movements are dated inclusively: `occurred_on >= accounts.opening_as_of`. An event posted before an account's opening date is rejected.
- Balances are derived as `opening_balance + SUM(account_entries.amount)` for entries whose parent transaction is `posted`. `voided` events and their retained entries are excluded.
- Income requires one positive entry when assigned. Expenses paid by cash/debit or another assigned method require one matching negative entry. An intentionally unassigned income/expense is represented by a null payment method and no entries; it still counts in income/expense reports and must be surfaced for reconciliation. A no-entry event cannot predate the earliest account opening date.
- A credit-card expense requires a credit-card payment method and has no account entry. It remains an expense, not a liability balance.
- A `card_settlement` requires one negative bank/cash entry and has no category. It changes the account balance but is not an income or expense.
- A transfer has exactly two entries, one positive and one negative, on distinct accounts. Same-currency legs must net to zero; cross-currency legs retain the actual debit and credit amounts independently. Transfers are not income or expenses.
- A balance adjustment has exactly one entry, a signed amount, and a non-empty reason. It is excluded from income/expense reports.
- Investment accounts participate in transfers and account movements. Expenses and card settlements cannot debit an investment account. Manual valuation snapshots are outside this issue.

## Exact monetary representation

Amounts use PostgreSQL `numeric` in **major currency units**, not binary floating point and not a rounded `numeric(p,s)` column. For example, USD `12.34` is stored as `12.34`, while JPY `1234` and VND `1234` are whole units. The database rejects non-finite values and values not exactly representable at the currency's fractional scale; it does not round an over-precise input.

The immutable scale helper uses 0 fraction digits for JPY/VND and other standard zero-digit currencies, 2 for USD and standard two-digit currencies, 3 for standard three-digit currencies, and 4 for CLF/UYW. Other uppercase three-letter codes default to two digits. The schema checks code shape, not membership in a live ISO currency registry; add an explicit scale rule when enabling a code with a nonstandard exponent.

`post_transaction` accepts all amounts as decimal **strings** (`p_amount` text and entry JSON `amount` strings). JSON numeric values and exponent notation are rejected. Application code must pass strings through the Supabase client and must not parse, add, or multiply money using JavaScript `number`. Any later FX rate/provenance fields must also use exact `numeric`; FX conversion itself is not implemented here.

The schema does not add a text-returning read API. Future consumers must expose `numeric` amounts as decimal strings before JavaScript parsing, or keep financial arithmetic in PostgreSQL; raw JSON numeric values are not an exact-money client contract.

## Atomic posting, idempotency, and voiding

Clients can read `transactions` and `account_entries`, but cannot insert, update, or delete them directly. The authenticated owner calls `public.post_transaction(...)`; the security-definer RPC validates the caller, event/category/payment-method compatibility, account ownership/currency/opening date, and entry count/sign, then inserts the event and all entries in one PostgreSQL statement/transaction. Any constraint or entry error rolls the entire call back.

The caller supplies a UUID `p_idempotency_key` and must reuse it for retries of the same logical operation. A repeated key with the same normalized event fields and exact account legs returns the original transaction ID without adding rows. Reusing a key with different contents raises a unique-violation error. A retry after voiding returns the original voided event; it never resurrects it.

Posted events and entries are append-only. `public.void_transaction(id, reason)` permits one `posted` → `voided` transition, records `voided_at`, `voided_by`, and a mandatory reason, and retains the original transaction and entries for audit. A second void fails. Correct a mistake by voiding the original and posting a new event with a new idempotency key; do not edit balances or historical entries.

## Database authorization

All six user-owned tables have RLS enabled and forced, with policies requiring both `auth.uid() = user_id` and membership in `private.owner_allowlist`. The allowlist has a singleton key, an Auth-user foreign key, no grants to `anon` or `authenticated`, and lives in the `private` schema. The local API schema list exposes `public`, `storage`, and `graphql_public`, not `private`.

This is stricter than `auth.uid() = user_id`: a different authenticated Google user cannot read records or create a Faylo row with their own UUID. Table grants are also explicit; anonymous users have no table access. `post_transaction` and `void_transaction` are executable only by `authenticated` and re-check the allowlisted session inside the function. Both security-definer RPCs pin an empty `search_path` and schema-qualify referenced objects.

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

The browser needs only the Supabase publishable key and the authenticated user's session. Never put a `service_role`/secret key in browser code; it is unnecessary here and bypass-capable roles are outside this RLS boundary. The current app verifies the owner server-side; future financial data services must use the user's authenticated Supabase client so database RLS remains active.

## Migrations and tests

Install the Supabase CLI and Docker using the official Supabase local-development instructions. From the repository root:

```bash
supabase start
supabase db reset       # destructive to the local Supabase database only
npm run test:db         # supabase test db; runs supabase/tests/*.sql
supabase stop --no-backup
```

`supabase db reset` rebuilds the local database from the versioned migrations and is the clean-database migration check. Do not add `--linked` to local reset commands. `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` cover the application checks. GitHub Actions runs a separate local Supabase/PostgreSQL integration job on pull requests. The local SMTP/Mailpit service is disabled in `supabase/config.toml` because the current Google-only authentication flow does not use email; enable it if email-flow tests are added.

The pgTAP suite uses only synthetic Auth identities and financial values inside a rolled-back transaction. It covers RLS for owner, non-owner, and anonymous roles; cross-owner FKs; exact JPY/VND/USD values; opening dates; category/payment semantics; cash/debit and credit-card posting; settlements; same- and cross-currency transfers; atomic rollback; retry conflicts; adjustments; voiding; and the direct-write boundary.

## Safe hosted deployment process

No migration in this issue has been applied to the hosted Faylo project. Do not run a remote migration without explicit owner approval. When approved:

1. Confirm the target project reference and environment, check the current migration history/schema, and create and verify a recoverable database backup (including a tested restore or point-in-time recovery plan). Do not rely on a local reset as a hosted backup.
2. Review the exact migration diff and any project-specific objects/privileges with the owner. The migrations create six financial tables and a private owner allowlist; they do not seed real owner data or alter existing financial rows.
3. Authenticate the Supabase CLI with an approved operator credential, link only the Faylo project (`supabase link --project-ref <project-ref>`), and review `supabase migration list --linked`. Do not copy credentials into the repository or client environment.
4. With approval, apply the pending migrations using `supabase db push --linked` during a controlled change window. Stop on any unexpected migration-history or schema difference; do not use repair/reset commands to force deployment.
5. Provision the allowlist as above, verify owner and non-owner RLS through the API, inspect the resulting schema/migration history, and record the deployment and backup reference. If any step fails, stop and use the verified restore plan; do not improvise a destructive rollback against financial data.

The hosted project was not linked, queried, or changed for Issue #3.

## Known limitations and future integration points

- FX-rate tables, conversion fields, budgets, scheduled items, investment valuation snapshots, tracked liabilities, Telegram, and financial UI/services are deliberately absent. Transfers keep actual native legs but do not record an executed FX rate.
- Category hierarchy changes and account opening baselines are immutable through ordinary client grants. Use a new category/account or explicit adjustment rather than rewriting financial history.
- Unassigned income/expenses have no balance movement. The domain service/reporting UI must surface them for reconciliation and must distinguish credit-card expenses from unassigned expenses.
- The currency scale mapping is a static ISO-style exponent map with a two-digit default, not a currency registry. Unknown codes with zero/three/four digits need an explicit mapping before use.
- The schema has no balance view, FX reporting, or historical `updated_by` log for preference/configuration edits. Posted financial events and their voids are auditable; broader data export/backup workflows remain future work.
- Account deletion is restricted while referenced; Auth user deletion is restricted while Faylo rows exist. Data-retention/deletion requires an explicit administrator-managed process.

## Official references

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS defaults, policy behavior, private helper functions.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) — publishable keys versus secret/service-role bypass-capable keys.
- [Supabase local CLI config](https://supabase.com/docs/guides/local-development/cli/config) — local project configuration and exposed API schemas.
- [Supabase database testing and pgTAP](https://supabase.com/docs/guides/local-development/testing/overview) and [RLS testing](https://supabase.com/docs/guides/database/postgres/testing-row-level-security) — local migration/test workflow and role/JWT test setup.
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — table privileges and RLS interaction.
- [PostgreSQL `CREATE FUNCTION`](https://www.postgresql.org/docs/current/sql-createfunction.html) — `SECURITY DEFINER` and safe `search_path` handling.
- [PostgreSQL Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html) — exact decimal versus inexact floating-point values.
- [PostgreSQL Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — check, unique, and foreign-key behavior.
- [PostgreSQL Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html) — all-or-nothing transaction semantics.
