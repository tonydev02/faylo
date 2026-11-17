# Faylo Issue #8 — FX reference rates and JPY reporting

**Status:** Review proposal only. No production database change, hosted deployment, paid subscription, implementation PR, or user-facing UI change is included.

**Review base:** Issue #8 and `main` at `6ba3f55e22e9b3d386a90d7e97ea37bb10a5e458` (Issue #7 merged). Main has the transaction and own-account movement foundation; `docs/database.md` says FX conversion is not implemented. The conceptual `docs/data-model.md` FX fields are proposals, not the current database contract. The implemented transaction amount is PostgreSQL `numeric` in major units, validated at the currency scale, and exposed as exact text; do not implement against the conceptual `amount_minor` field names.

The JPY values described here are **reference reporting conversions**, not bank execution values, forecasts, or settlement instructions.

## 1. FX provider comparison and recommendation

Reviewed first-party provider documentation and pricing; no provider accounts or paid plans were created.

| Provider | Free plan and price | Historical rates, required currencies, cadence | Reliability and limits | Authentication and operations |
| --- | --- | --- | --- | --- |
| [Frankfurter](https://frankfurter.dev/) | Free public API; no key and no published monthly/daily quota. Abuse-prevention rate limiting applies; its threshold is not published. | Daily history back to 1948. The project lists 219 currencies and 112 central-bank/official sources. USD, JPY and VND coverage is documented; VND history is listed from 1998. Source rates publish once or a few times per day; the API updates as sources publish. | No uptime SLA documented. Its terms say rates/API are provided as-is and may be late, missing or revised; blended rates are Frankfurter's calculation, not an official rate. | No account/key. v2 supports date/pair filtering, provider attribution and self-hosting. Cache responses; preserve the returned effective date and provider-contributor metadata. [Providers](https://frankfurter.dev/providers/) · [VND coverage](https://frankfurter.dev/currencies/vnd/) · [terms](https://frankfurter.dev/license/) |
| [currencyapi](https://currencyapi.com/pricing/) | Free: $0, 300 requests/month, 10 requests/minute, one key, no credit card; private use only. Requests beyond quota stop until the next month. Paid plans start at $12.99/month; no paid plan is proposed. | Historical end-of-day rates back to 1999; USD, JPY and VND are listed. Free rates update daily. A historical request can include up to 31 dates, but each date consumes one quota request. | The pricing page lists SLA only on higher paid tiers, not Free. No free-tier SLA is documented. Historical response precision is bounded by the provider's documented precision options; preserve exactly the decimal value it supplies, not a claim of arbitrary-precision market data. | API key required; use the recommended `apikey` header, not a query parameter. Server-only secret; monitor quota and handle 429. [Currency list](https://currencyapi.com/docs/currency-list/) · [historical endpoint](https://currencyapi.com/docs/historical/) · [authentication](https://currencyapi.com/docs/authentication/) · [quotas](https://currencyapi.com/docs/rate-limit/) |
| [CurrencyBeacon](https://currencybeacon.com/pricing) | Free: $0, 5,000 requests/month, no credit card; hourly refresh. Pricing describes Free as a developer sandbox for prototyping. Paid Basic starts at $10/month; no paid plan is proposed. | Historical rates back to 1996; its supported-currency list includes USD, JPY and VND. | API documentation displays a 99.99% uptime claim; the pricing page reserves a guaranteed uptime SLA for Professional ($599/month), not Free. Treat the Free tier as having no contractual SLA. | API key required; docs recommend Bearer authorization. Free tier has a larger quota than currencyapi, but the sandbox positioning makes it a weaker production fallback. [API docs](https://currencybeacon.com/api-documentation) · [supported currencies](https://currencybeacon.com/supported-currencies) |
| [ExchangeRate-API](https://www.exchangerate-api.com/docs/free) | Open Access: $0, no key, daily refresh, rate-limited, attribution required; caching is allowed. Its separate registered Free API offers 1,500 requests/month and daily refresh. | Supported-currency list includes USD, JPY and VND, but historical API access is limited to Pro, Business or Volume plans. Therefore the free offerings do not satisfy historical transaction reporting. | Open Access docs link a public uptime history, but do not state a contractual SLA. Historical lookup returns a no-data/plan-upgrade error on unsupported plans. | Open Access needs no key but requires attribution and prohibits redistribution. The registered Free API needs a key. Useful as a current-rate comparator, not the selected historical-rate source. [Historical endpoint limits](https://www.exchangerate-api.com/docs/historical-data-requests) · [currency codes](https://www.exchangerate-api.com/docs/supported-currencies) |

**Recommendation:** Frankfurter v2 blended reference rates as primary. It covers the required currencies, has dated history, no key or published request quota, and avoids adding a paid dependency. Preserve `Frankfurter blended` as the source label and save the returned source date and contributor keys; do not describe the blend as a central-bank rate.

**Fallback:** First reuse an already-saved matching cache observation. If the primary request fails transiently or lacks the requested pair/date, optionally query currencyapi Free's historical endpoint, but only while Faylo remains a private single-user app and only with an owner-approved server-side key. Store the fallback provider and its own effective date distinctly; never silently substitute its rate for a Frankfurter rate already snapshotted. If no eligible observation is available (or the fallback key is absent/exhausted), leave the transaction unresolved and offer a manual override. Never use a current/latest quote for a past transaction date, interpolate, or invent a rate. This strategy costs nothing and does not subscribe to a paid tier.

## 2. Financial architecture and proposed schema

### Invariants

- Keep the original `transactions.amount` and `currency_code` unchanged. Current posted events are immutable; corrections void the original and create a replacement. FX belongs in an owner-scoped sidecar, not in a rewrite of the financial event.
- Store rates as exact PostgreSQL `numeric`, with direction explicitly defined as `1 <original currency> = <rate> JPY`. Do not use JavaScript `number` for rate parsing, multiplication, totals, or rounding. The current app already sends decimal strings and formats money without binary floating point; keep RPC output as text.
- A resolved historical conversion is a frozen per-transaction snapshot. Later provider refreshes do not change a prior report. A manual override appends a new snapshot revision; prior revisions remain auditable.
- Transfers, card settlements, and balance adjustments are not income/expense reporting conversions. A cross-currency transfer retains the actual sent and received amounts already stored on its two account entries; a reference rate must never replace, equalize, or be presented as either transfer leg.

### Tables to add

**`fx_rate_cache`** — provider observations used to avoid redundant fetches:

- `id`, `user_id`, `base_currency`, `quote_currency`, `rate numeric`, `provider_code`, `effective_on date`, `fetched_at timestamptz`, and minimal provider metadata (for Frankfurter, contributor keys/dates).
- Positive rate and three-letter currency checks; unique provider/pair/effective-date key; owner-scoped RLS and same-owner constraints.
- Cache rows are retrieval aids, not the source of a historical report. Refreshing a cache row must not alter a transaction snapshot.

**`transaction_reporting_fx_snapshots`** — append-only applied conversions:

- `id`, `user_id`, `transaction_id`, `revision`, `status` (`resolved` or `unresolved`), `rate_to_jpy numeric`, `converted_amount_jpy numeric`, `source_kind` (`frankfurter_blended`, `currencyapi`, `manual`, `identity`, or `unresolved`), provider/source details, `requested_on`, `rate_effective_on`, `fetched_at`, `override_note`, and `created_at`.
- Unique `(user_id, transaction_id, revision)` and a composite FK to the same owner's transaction. The current snapshot is the highest revision. Add checks: unresolved rows have no rate/converted amount; resolved rows have a positive rate and a whole-yen converted amount. RLS/immutable-update-and-delete protection follow the existing financial audit-table pattern.
- Copy the rate and converted result into the snapshot; do not depend on a mutable cache row to reproduce a report. No new snapshot is required for a provider to refresh an already-resolved transaction.
- JPY-native income/expense rows can use an `identity` snapshot with rate one and converted amount equal to the original amount; they do not require an external call. Missing sidecar rows also fail closed as unresolved.

The cache may be upserted as provider data changes; snapshots are append-only. A later explicit override or recovery of a previously unresolved rate creates a new revision. A correction creates a new transaction and its own snapshot; the voided original and its snapshot remain intact.

## 3. Rate-fetching and caching strategy

1. Use the transaction's stored `occurred_on` in the owner's `Asia/Tokyo` reporting calendar as the requested date. Ask for the direct `base=<transaction currency>, quote=JPY` rate and request Frankfurter's provider expansion for source attribution.
2. Accept only an observation dated on or before `occurred_on`. Proposed weekend/holiday rule: use the latest available observation no more than seven calendar days old; store and display its actual `rate_effective_on`. If no such observation exists, mark unresolved. This is a proposal, not an already-approved product rule.
3. Resolve in order: existing transaction snapshot; matching cache; Frankfurter; optional currencyapi Free historical lookup; unresolved/manual state. Validate response status, requested pair, positive decimal rate and returned date before storing. Do not accept a future date or substitute `/latest` for a historical request.
4. Make provider calls server-side only. A missing/outage rate must not block posting the user's native-currency transaction. After the idempotent transaction post returns its ID, save an initial resolved/unresolved snapshot through an owner-checked, idempotent RPC. If that second save fails, the transaction remains posted and the UI treats the absent snapshot as unresolved; a retry resolves the snapshot without posting the transaction again.
5. Use a short bounded timeout and at most one jittered retry for network/5xx/429 failures; respect `Retry-After` where available. Do not retry malformed/unsupported requests. Then try the configured fallback once. Never make an unbounded retry loop.
6. Fetch on demand and coalesce concurrent requests for the same provider/pair/date. Keep daily historical observations locally; refresh the latest account-value quote on demand when its cache exceeds an owner-approved staleness threshold. No cron/hosted scheduler is needed for the single-user proposal.
7. Preserve source and exact decimal tokens. Provider APIs return JSON numeric values; parse the decimal token losslessly (not via `JSON.parse` to JS `number`) and persist it as a decimal string/`numeric`. No amount, merchant, account name, or personal transaction details are sent to a provider—only currency pair and requested date.

## 4. Conversion and rounding rules

- Convert in exact decimal arithmetic: `converted JPY = round(original amount × rate_to_jpy, 0)`. The original amount is in major currency units; its existing currency-scale validation stays authoritative (USD two fraction digits; JPY and VND zero).
- Proposed rounding: round each income/expense transaction separately to the nearest whole yen, ties away from zero (`ROUND_HALF_UP`). PostgreSQL documents this behavior for `numeric`; do not round using binary `double precision`. Sum the already-rounded per-transaction JPY snapshots for monthly/category totals so displayed rows reconcile to the chart totals.
- A provider's reference rate is not a bank's executed rate. For an account balance overview, convert the current native balance with a separately fetched latest reference rate and show its source/effective date; do not replace a transaction's historical rate with that newer rate.
- JPY monthly totals include only posted income/expense transactions. Exclude transfers, settlements, and adjustments as current reporting semantics require. Unresolved items are not zero and must make completeness visible.

The source contract uses exact decimals but cannot make a vendor quote more precise than its published rate. Frankfurter also disclaims warranty and notes rates may be revised; the saved transaction snapshot is what makes Faylo's historical result reproducible.

## 5. UI/UX proposal

Follow `docs/design-system.md`: black-first canvas (`#0B0B0C`), neutral charcoal surfaces (`#171717`), off-white text, muted secondary text, and restrained forest/mint accents. Keep most of the view neutral; use readable numeric alignment, explicit labels and accessible status text/icons. Taste (`design-taste-frontend`) was verified installed and readable at `.agents/skills/design-taste-frontend/SKILL.md`; use it before any later UI implementation. No UI was implemented or visually checked for this proposal.

- **Monthly reporting:** retain native-currency totals by currency; never add unlike currencies together. Add distinct JPY-equivalent income and expense summaries/charts based on applied snapshots.
- **Transaction list/detail:** show the original amount/currency as primary. Show the JPY equivalent separately and label it as a reference conversion. Detail reveals rate direction, source, actual effective date, fetched/entered timestamp, and whether it is a manual override. Keep native amounts visible even when conversion is unavailable.
- **Manual override:** provide a clear “Edit reporting rate” action for an eligible transaction. Require a positive decimal rate and effective date; identify it as a manual reporting override, not an actual transfer/settlement rate. Preview the rounded JPY result, explain that only the reporting conversion changes, and append a new revision on save. Keep the prior version inspectable.
- **Unresolved conversion:** show an explicit unavailable/pending state and a retry/manual-override action. Do not show `¥0`, an empty value that looks like zero, or a current-rate estimate as if it were historical. If any transaction is unresolved, show the monthly JPY figure as incomplete; a resolved subtotal may be shown only with an unmistakable “incomplete” label and unresolved count.
- **Account summary:** show native account balance first. Any current JPY equivalent is a separate estimate with “reference rate as of [date]” and source attribution. It must not be confused with actual funds moved or bank settlement amounts.

## 6. Migration and testing strategy

**Migration plan (future Issue #8 implementation only):**

1. Add the two owner-scoped tables, constraints, indexes, RLS policies and immutable snapshot protections in a new forward-only Supabase migration. Do not change transaction amount columns, account-entry amounts, transfer semantics, or existing immutable-event rules.
2. Backfill existing JPY income/expense transactions with identity snapshots and foreign-currency transactions as unresolved snapshots. Do not call a live provider from a schema migration and do not apply a latest rate to old rows. An idempotent server-side resolver can fill eligible historical rates later and preserve source/date; unresolved rows remain visible until resolved.
3. Add owner-checked RPCs for recording an initial snapshot and appending a manual override; update the existing transaction history and monthly-total contracts/callers to return snapshot metadata and exact text totals. Keep existing native-currency totals and transaction posting/idempotency semantics intact; do not add a parallel compatibility API.
4. Update `docs/data-model.md` and `docs/database.md` to match the implemented schema and explain source/date, unresolved state, rounding, and snapshot lifecycle. Deploy only after owner review, backup/recovery readiness, and explicit approval; none of these changes are applied to production by this proposal.

**Tests for the implementation:**

- Exact decimal arithmetic and serialization; currency-scale boundaries for JPY/VND (zero fractional digits) and USD (two); JPY rounding immediately below, at, and above a half-yen boundary; negative account-balance display rounding.
- Snapshot source/effective-date persistence; provider response with a prior eligible date; rejection of a future/stale/missing date; primary outage and fallback attribution; both providers unavailable yields unresolved, never zero or latest-rate conversion.
- Manual override appends a revision and changes only the JPY reporting result; original amount/currency and account entries remain byte-for-byte unchanged; old revision and historical report remain inspectable.
- Native-currency monthly totals remain unchanged; JPY totals include posted income/expenses only; unresolved counts make totals incomplete; transfers retain actual sent/received amounts and are excluded from income/expense conversion totals.
- RLS/non-owner denial, cross-owner FK rejection, immutable snapshot revisions, retry/idempotency without duplicate transactions, and absence of provider keys in client output.
- Use synthetic test fixtures and stubbed provider responses only—no live finance data or real provider secrets. Run local Supabase/pgTAP, unit tests, and the authenticated browser flow after implementation; review the actual UI at 390px and 1440px per the design system and Taste workflow. No checks were run because this task is proposal-only.

## 7. Decisions requiring product-owner approval

1. **Provider and terms:** accept Frankfurter's blended reference-rate methodology and lack of SLA; authorize currencyapi Free as a private-use fallback and approve storing its server-side key. No paid tier or subscription is recommended.
2. **Date policy:** approve the proposed latest-observation-on-or-before-transaction-date rule and seven-calendar-day maximum age, including weekend/holiday behavior and how stale observations display.
3. **Rounding:** approve per-transaction nearest-yen rounding with ties away from zero before aggregation, versus another accounting/reporting convention.
4. **Incomplete totals:** approve showing a resolved subtotal with an explicit incomplete state/count, or suppressing the JPY total until every transaction resolves.
5. **Overrides:** decide whether a manual override requires a source note/reason, whether its effective date must be on/before the transaction date, and whether the UI should allow changing an already-resolved snapshot (the proposal keeps prior versions and requires an explicit new revision).
6. **Existing rows and account summaries:** approve marking existing foreign-currency transactions unresolved for an idempotent post-migration resolver, and set the latest-rate cache/staleness threshold for account-balance estimates.

## Official sources

- [Frankfurter API docs](https://frankfurter.dev/), [providers](https://frankfurter.dev/providers/), [VND coverage](https://frankfurter.dev/currencies/vnd/), and [license/disclaimer](https://frankfurter.dev/license/).
- [currencyapi pricing](https://currencyapi.com/pricing/), [historical endpoint](https://currencyapi.com/docs/historical/), [supported currency list](https://currencyapi.com/docs/currency-list/), [authentication](https://currencyapi.com/docs/authentication/), and [rate limits](https://currencyapi.com/docs/rate-limit/).
- [CurrencyBeacon pricing](https://currencybeacon.com/pricing), [API documentation](https://currencybeacon.com/api-documentation), and [supported currencies](https://currencybeacon.com/supported-currencies).
- [ExchangeRate-API Open Access](https://www.exchangerate-api.com/docs/free), [historical endpoint access](https://www.exchangerate-api.com/docs/historical-data-requests), and [supported currencies](https://www.exchangerate-api.com/docs/supported-currencies).
- [PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html) and [numeric rounding](https://www.postgresql.org/docs/current/functions-math.html).
