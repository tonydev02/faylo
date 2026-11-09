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
- `occurred_at` exact economic effective instant and `occurred_on` local booking/reporting date in the user's configured timezone. Date-only input maps to local midnight; when both are supplied, the date must match the instant in that timezone.
- `amount_minor`, `currency_code` for original expense/income amount (nullable for multi-leg transfer)
- `category_id` nullable FK, only for income/expense
- `payment_method_id` nullable FK
- `merchant` nullable, `note` nullable
- `source`: `manual` | `telegram` | `import`
- `status`: `posted` | `voided`
- `reporting_rate_to_jpy` nullable exact decimal, `reporting_rate_source`, `reporting_rate_as_of`, `reporting_rate_is_override` boolean
- `created_at`, `updated_at`

**Validation semantics:**
- Income/expense from a funded method has one account entry (unless deliberately recorded as unassigned and surfaced for reconciliation).
- Credit-card expense requires `payment_method.type = credit_card` and normally has **no account entry**.
- `card_settlement` has one negative bank/cash entry, no category, and optional `payment_method_id` identifying which card was paid.
- Transfer requires two account entries, one negative and one positive, matching each account's native currency; both legs retain exact actual amounts.
- `balance_adjustment` has one entry and a mandatory reason, excluded from spending/income reports.
- Never rely on global balance equality between the two foreign-currency transfer entries: amounts are in different units.

**`transaction_corrections`**
- `user_id` FK, `original_transaction_id` FK, `replacement_transaction_id` FK
- `reason`, `created_at`
- Each correction links one original to one distinct replacement, with at most one correction per original and one original per replacement.

Corrections preserve the original as a voided audit record and post a new replacement atomically. The immutable linkage and reason remain available for transaction history; corrections never rewrite the original event or entries.

### Currency reference rates

**`fx_rates`**
- `id` UUID PK
- `base_currency`, `quote_currency`
- `rate` exact decimal (`1 base = rate quote`)
- `effective_at`, `source`, `fetched_at`
- unique `(base_currency, quote_currency, effective_at, source)`

Historical transaction reporting stores the **applied** JPY rate snapshot on `transactions`, allowing individual manual override and stable historical totals. For investment/account balances converted to JPY, a selected **as-of** reference FX rate can be used dynamically (with date/source shown). Cross-currency transfers store actual debit/credit legs; a reporting reference rate is not automatically the executed FX rate.

Monthly income and expense totals are grouped by transaction kind and native currency. Amounts remain exact decimal text at the reporting boundary; unlike the conceptual JPY conversion above, no currencies are combined by the current transaction totals function.

### Budgets, future transactions and investments

**`budgets`**
- `id` UUID PK, `user_id` FK
- `month` (`YYYY-MM-01`), `category_id` FK
- `limit_jpy_minor`, `created_at`, `updated_at`
- unique `(user_id, month, category_id)`

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
- Save the JPY reporting conversion rate, effective date/source, and whether it was manually overridden.
- Budget and monthly spending reports use the applied historical conversion, while native account balances remain in VND.

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

## 7. Future-compatible changes, without implementing them now

The event/account-entry model is compatible with later adding a **liability account type** for credit cards, more rigorous reconciliation and portfolio-level transaction accounting. These are intentionally **not included** in v1. The initial schema should not invent card balances or silently treat a credit-card purchase as a bank withdrawal.