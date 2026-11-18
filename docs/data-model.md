# Faylo — Initial Data Model v0.2

**Status:** Conceptual PostgreSQL schema for design review, with current database semantics noted where implemented. This model includes opening balances, payment-method-only credit cards, manual investment valuations, and reference FX overrides.

## 1. Modeling approach

- **Transactions** represent economic events; **account entries** represent balance movement in actual tracked bank/cash/investment accounts.
- Most cash/debit expenses have one account entry. **Credit-card expenses deliberately have no account entry** because a card is only a payment method in v1.
- Credit-card payments have a negative bank/cash account entry but are **not** categorized as expense, to avoid duplicate spending.
- Transfers have two balance movements (often different currencies); investment funding is a transfer.
- Opening balances and investment valuations are dated snapshots; adjustments record subsequent corrections.
- Money is stored in currency-specific minor units or exact decimal format, not JS floating point. Use a precise decimal rate for FX and keep conversion provenance.

## 2. Entities and suggested fields

### Identity and configuration

**`user_preferences`**
- `user_id` PK/FK to Supabase Auth user
- `base_currency` default `JPY`
- `timezone` default `Asia/Tokyo`
- `created_at`, `updated_at`

### Balance-tracked accounts (not credit cards)

**`accounts`**
- `id` UUID PK, `user_id` FK
- `name`
- `type`: `bank` | `cash` | `investment`
- `currency_code` (e.g. JPY/VND/USD)
- `opening_balance_minor` (or exact decimal in native units)
- `opening_as_of` date (the baseline from which transactions are tracked; no time-of-day)
- `include_in_assets` boolean default true
- `status`: `active` | `archived`
- `created_at`, `updated_at`

**`account_entries`** (formerly conceptual `ledger_entries`)
- `id` UUID PK, `user_id` FK
- `transaction_id` FK
- `account_id` FK to `accounts`
- `amount_minor` signed: positive in, negative out
- `currency_code` matching the account
- `recorded_at` server timestamp for persistence; use the parent transaction's `occurred_at` for economic ordering

**Balance boundary, all account types:** Before midnight at the start of `opening_as_of` in the user's configured timezone, the balance is unavailable; on and after that local instant, the opening snapshot becomes effective.

**Balance formula, bank/cash:** At an as-of instant on or after the opening boundary, `opening_balance + SUM(account_entries)` for posted transactions with `occurred_on >= opening_as_of` and `occurred_at <= as_of`.

**Balance formula, investment:** Latest manual valuation snapshot at or before `as_of` (or opening balance) + account entries whose parent transaction occurred after that snapshot and no later than `as_of`. The cutoff is strict (`occurred_at > valued_at`); an entry at the exact snapshot instant is treated as already reflected in the absolute snapshot.

### Payment methods (no tracked credit-card balances)

**`payment_methods`**
- `id` UUID PK, `user_id` FK
- `name` (e.g. cash, debit card, credit card name)
- `type`: `cash` | `debit_card` | `credit_card` | `bank_transfer` | `other`
- `linked_account_id` nullable FK to `accounts` (used for immediately funded methods)
- `archived_at` nullable

For `credit_card`, `linked_account_id` is not treated as an automatic debit source; purchases don't reduce a bank account. Card payment amounts are reflected only when a separate `card_settlement` is recorded.

### Categories and financial events

**`categories`**
- `id` UUID PK, `user_id` FK
- `kind`: `income` | `expense`
- `name`, `parent_id` nullable self-FK
- `archived_at` nullable

**`transactions`**
- `id` UUID PK, `user_id` FK
- `type`: `income` | `expense` | `transfer` | `card_settlement` | `balance_adjustment`
- `occurred_at` exact economic effective instant and `occurred_on` local booking/reporting date in the user's configured timezone. Date-only input maps to local midnight, not a supplied time of day; `created_at` is the actual transaction recording timestamp. When both `occurred_at` and `occurred_on` are supplied, the date must match the instant in that timezone.
- `amount_minor`, `currency_code` for original expense/income amount (nullable for multi-leg transfer)
- `category_id` nullable FK, only for income/expense
- `payment_method_id` nullable FK
- `merchant` nullable, `note` nullable
- `source`: `manual` | `telegram` | `import`
- `status`: `posted` | `voided`
- Historical reporting FX is stored in append-only transaction snapshots; it is not a mutable field on the immutable transaction.
- `created_at`, `updated_at`

**Validation semantics:**
- Income/expense from a funded method has one account entry (unless deliberately recorded as unassigned and surfaced for reconciliation).
- Credit-card expense requires `payment_method.type = credit_card` and normally has **no account entry**.
- `card_settlement` has one negative bank/cash entry, no category, and requires an active, owner-owned credit-card payment method.
- Transfer requires two account entries, one negative and one positive, matching each account's native currency; both legs retain exact actual amounts.
- `balance_adjustment` has one entry and a mandatory reason, excluded from spending/income reports.
- Never rely on global balance equality between the two foreign-currency transfer entries: amounts are in different units.

**`transaction_corrections`**
- `user_id` FK, `original_transaction_id` FK, `replacement_transaction_id` FK
- `reason`, `created_at`
- Each correction links one original to one distinct replacement, with at most one correction per original and one original per replacement.

Corrections preserve the original as a voided audit record and post a new replacement atomically. The immutable linkage and reason remain available for transaction history; corrections never rewrite the original event or entries.

### Historical transaction FX reporting

**`fx_rate_cache`**
- `id`, `user_id`, `base_currency`, `quote_currency` (initially `JPY`), exact positive `rate`, `provider_code` (`frankfurter` only), `effective_on`, covered request window, `fetched_at`, provider attribution metadata, `created_at`
- Unique owner/provider/currency-pair/effective-date key; owner-scoped RLS. Authenticated clients can read only their own cache; writes go through the owner-checked resolver RPC.

**`transaction_reporting_fx_snapshots`**
- `id`, `user_id`, `transaction_id`, per-transaction `revision`, `status`, exact `rate_to_jpy`, per-transaction rounded `converted_amount_jpy`
- `source_kind`, `provider_code`, provider attribution metadata, `requested_on`, actual `rate_effective_on`, `fetched_at`, manual `override_note`, unresolved `resolution_reason`
- Required idempotency key and request fingerprint, `created_at`
- Owner-scoped RLS, composite owner/transaction FK, unique revision and idempotency constraints, append-only trigger. The latest revision is the reporting value; history remains inspectable.

Only posted income/expense transactions receive reporting FX. Original transaction amount/currency and account entries never change. JPY-native events use an exact rate-one identity snapshot. For foreign currency, Frankfurter v2 is the sole initial provider; select the latest direct base-currency-to-JPY observation on or before the transaction's `occurred_on`, and reject a quote more than seven calendar days older. Preserve the quote's actual effective date. Do not substitute a current rate or chain through another currency.

Future-effective foreign-currency events remain `pending_future` and do not trigger a lookup before their economic date begins in `Asia/Tokyo`. An eligible event with no observation in the seven-day window is `unavailable`; transient provider/storage errors remain retryable as `unresolved`. Neither state is zero. Manual overrides require a positive exact decimal, an effective date no earlier than seven days before the economic date and no later than that date, and a non-empty explanation. Each save appends an audited revision; a later automatic resolver cannot replace a latest manual revision. Transaction-row locks, unique revisions, idempotency keys, and request fingerprints serialize concurrent changes and make retries safe.

After a future-effective transaction reaches its economic date in `Asia/Tokyo`, on-demand access to its transaction detail invokes the existing resolver; eligible unresolved/unavailable events can also be retried from the detail view. A successful lookup appends a new reporting snapshot. No scheduler or hosted background job is required.

The conversion multiplies exact PostgreSQL `numeric` values and rounds each transaction to whole JPY, ties away from zero, before monthly aggregation. `transaction_totals` preserves the native currency/amount/count rows and adds the resolved JPY subtotal, resolved count, non-resolved count, and included count. It includes only posted income/expense with the stored economic date in the report month and `occurred_at <= statement_timestamp()`. Unresolved, unavailable, and pending-future rows are counted as incomplete only if they pass that same inclusion cutoff. A JPY subtotal is absent when no included transaction has a resolved snapshot; incomplete subtotals must show the non-resolved count.

`monthly_dashboard_totals(month_start, month_count)` returns posted income/expense per owner-local `occurred_on` month, with the existing `occurred_at <= statement_timestamp()` economic cutoff. It preserves transactions before later account-opening dates and labels each period `fully_tracked`, `partial_account_coverage`, or `insufficient_history`; empty periods are explicit rows. A fully tracked empty period is complete zero activity. A direct historical comparison is allowed only for adjacent completed months with matching account-coverage signatures; current month-to-date and differing coverage are not compared.

Account balances remain grouped by native currency. The Issue #9 Tracked Assets aggregate includes only active bank/cash accounts marked for inclusion; investment account ledger balances are displayed separately and are not current market values. No cross-currency account sum or net-worth total is inferred.

### Budgets, future transactions and investments

**`category_budgets`**
- `user_id`, `category_id`, `category_kind` constrained to `expense`, and first-of-month `month_start`
- `limit_jpy numeric`, non-negative whole JPY, plus `created_at` and `updated_at`
- Same-owner/category-kind composite FK; unique `(user_id, month_start, category_id)`; owner-only RLS

Initial budgets apply only to expenses assigned directly to that exact category. Descendant categories are neither included nor excluded silently; parent rows do not roll up children. The dashboard's overall expense total is independently aggregated once per posted expense. `monthly_category_spending` uses stored per-transaction JPY snapshots; if any included conversion is unresolved, it shows the resolved subtotal as incomplete and omits a definitive budget percentage/remaining amount. A future parent-rollup design must define clear inclusion and deduplication rules before implementation.

**`scheduled_items`**
- `id` UUID PK, `user_id` FK
- `kind`: `income` | `expense` | `card_settlement` | `transfer`
- `name`, `amount_minor`, `currency_code`
- `category_id` nullable FK, `account_id` nullable FK, `payment_method_id` nullable FK
- `next_due_date`, `recurrence_rule` nullable (null means one-off)
- `status`: `active` | `paused` | `completed`
- `last_recorded_transaction_id` nullable FK

Scheduling must not post a real transaction automatically; mark a due item as recorded only through an explicit posting action (manually or in a later approved workflow).

**`investment_valuations`** (renamed from `valuation_snapshots`)
- `id` UUID PK, `user_id` FK, `account_id` FK (account type must be investment)
- `total_value_minor`, `currency_code` matching account
- `valued_at`, `source` (e.g. manual), `note`, `created_at`

An investment valuation is an **absolute total**; it is not income, expense, or a cash transfer. Avoid representing portfolio market changes as salary/expense.

### Telegram (M3)

**`telegram_connections`**
- `id` UUID PK, `user_id` unique FK
- `telegram_user_id` unique, `chat_id`, `connected_at`, `revoked_at`

**`telegram_updates`**
- `update_id` unique (Telegram idempotency key), `telegram_user_id`, `received_at`, `processing_state`

**`transaction_drafts`**
- `id` UUID PK, `user_id` FK
- `telegram_update_id` nullable FK
- `proposed_payload` structured JSON (untrusted until validated)
- `status`: `pending` | `confirmed` | `cancelled` | `expired`
- `posted_transaction_id` nullable unique FK
- `created_at`, `confirmed_at`

Posting from a draft must be atomic and idempotent; a repeated confirmation cannot create a second transaction.

## 3. Required relationships and ownership

- Every user-owned record belongs to the authorized Supabase `user_id`, protected with RLS and server-side checks.
- `transactions` -> zero or more `account_entries`.
- `transactions` -> optional `categories`, optional `payment_methods`.
- A correction links one voided original transaction to one posted replacement and retains its reason as immutable audit history.
- `account_entries` -> exactly one `accounts` record.
- `accounts` of type investment -> zero or more absolute `investment_valuations`.
- `budgets` -> one category per month, initially stored in JPY.
- `transaction_drafts` -> at most one posted transaction.
- Record/account ownership must be validated across FKs (no cross-user linking).

## 4. Worked examples

### Example A: expense paid from bank
- Opening bank balance: ¥100,000.
- Record ¥1,200 lunch expense; account entry −¥1,200.
- Balance ¥98,800; spending +¥1,200.

### Example B: credit-card purchase followed by settlement
- Buy ¥10,000 groceries by credit card: `expense` ¥10,000, payment method `credit_card`, **zero account entries**.
- Month's expense total rises ¥10,000; bank balance unchanged.
- Later pay card bill ¥10,000: `card_settlement`, bank entry −¥10,000, no expense category.
- Month's expense total **does not** rise again. No tracked outstanding card payable; tracked-asset total can temporarily overstate true net worth before settlement.

### Example C: bank-to-investment contribution and valuation
- Transfer ¥50,000 from bank to investment account: bank entry −¥50,000; investment entry +¥50,000; not spending.
- Broker reports total investment value ¥630,000 at a later timestamp: save `investment_valuations.total_value = ¥630,000`.
- Display from that snapshot until a later entry/valuation changes it; **do not add the earlier ¥50,000 again**.

### Example D: foreign-currency expense
- Record a VND expense using its original exact amount.
- Resolve a JPY reference conversion using the actual historical Frankfurter effective date, or append a dated manual override with an explanation.
- Keep the original VND amount primary; round the JPY equivalent per transaction before reporting. Native account balances remain VND.

## 5. Important limitations / UI disclosures

1. **No real credit-card liability ledger**: no precise outstanding card debt, true net worth, due statements, or liability-aware future cashflow from card purchases. A future `card_balances`/`liabilities` feature would be a deliberate scope expansion.
2. **Balances begin at opening date**: before that date, transaction history and historical trends are intentionally incomplete.
3. **Investment valuations are manually updated**: stale snapshots can misrepresent current market value. Show `valued_at` and stale-data warnings.
4. **FX rates are reference data**: reported JPY-equivalent value may differ from actual bank execution and settlement fees. Keep manual override support and original monetary values.
5. **Net-worth language**: present **Tracked Assets** by default; **Estimated Net Worth** only with explicit exclusions until liabilities are modeled.

## 6. Core invariants to test

- Credit expense + later settlement -> exactly one expense recognition.
- Income/expense category compatibility and correct reporting inclusion.
- Transferring between tracked accounts changes each balance, not income/expense totals.
- Settlement and reconciliation adjustments do not consume budgets.
- Investment snapshot supersedes earlier contributions; subsequent contributions affect balance exactly once.
- Original money values are exact; FX overrides persist in historical reports.
- No unauthorized user/Telegram identity can read or write data.
- Idempotent Telegram webhook and confirmation handling.
- FX cache and snapshot reads remain owner-isolated; callers cannot write or mutate snapshot history directly.
- JPY-native transactions use rate-one identity conversions. Foreign future-effective transactions remain pending until their Tokyo economic date.
- Provider observations older than seven calendar days or later than the transaction date are rejected; no current-rate substitution is permitted.
- Exact per-transaction JPY rounding occurs before monthly summation. Native currency groups are unchanged; only included non-resolved snapshots contribute to the incomplete count.
- Manual override explanation, effective date, rate, revision, request idempotency, and prior audit history are preserved; concurrent automatic resolution cannot overwrite a manual revision.

## 7. Future-compatible changes, without implementing them now

The event/account-entry model is compatible with later adding a **liability account type** for credit cards, more rigorous reconciliation and portfolio-level transaction accounting. These are intentionally **not included** in v1. The initial schema should not invent card balances or silently treat a credit-card purchase as a bank withdrawal.