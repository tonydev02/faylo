# Faylo — Product Requirements v0.2

**Status:** Planning baseline (decisions accepted 2026-11-08). Implement changes only through scoped, reviewed GitHub issues.

## 1. Product goal

A DAAK-inspired, minimalist and mobile-first personal finance web application for **one user**. It tracks financial activity and the user's financial position reliably, then adds natural-language Telegram entry and eventually a decision-support assistant. The app must remain fully functional without AI.

## 2. Confirmed decisions

| Area | Decision |
|---|---|
| User | Single person, not a public SaaS |
| Authentication | Google sign-in via Supabase Auth; access restricted to approved user |
| Client | Responsive Next.js web app; PWA-friendly for phone and desktop |
| Backend | Next.js server-side API/business services; Supabase PostgreSQL + RLS; no separate Go/FastAPI backend initially |
| Onboarding | Enter **current opening balances** for each balance-tracked account with an effective date; only record transactions from that date onward |
| Cards | Credit cards are **payment methods**, not liability accounts; no outstanding-card-balance tracking in v1 |
| Investment tracking | Manually enter **whole investment-account valuations**; no per-security cost basis, trades, or return calculations in v1 |
| Currency | JPY reporting base; store original currency amounts; support VND, USD, and other supported currency codes; automatic dated reference FX rates with manual override |
| Transaction entry | Manual quick entry first, Telegram natural-language messages in MVP M3 |
| Core features | Income, expenses, categories, accounts, transfers, budgets, analytics, scheduled/recurring items, investment valuations, tracked assets |
| AI roadmap | Purchase affordability, effects on bills/savings, investment-affordability trade-offs, weekly/monthly financial reviews |
| Product style | DAAK-like functionality, simpler and more modern visual design |

## 3. MVP delivery milestones

### M1 — Transaction foundation

- Google OAuth and single-user allowlist; robust row-level authorization.
- Account setup: bank, cash, and investment accounts with an **opening amount, currency, and opening-date snapshot**. No historical backfill required.
- Create, edit, delete, search, and filter transactions; distinguish `expense`, `income`, `transfer`, `card_settlement`, and `balance_adjustment`.
- Custom income/expense categories, optionally nested.
- Payment methods, including **credit cards that are not balance-tracked accounts**.
- Transfer between own tracked accounts, including cross-currency transfers with actual sent/received amounts.
- Account balances derived from opening balances, movements, and reconciliation adjustments.
- Reference currency conversion for reporting (JPY), with rate/date/source and manual override preserved.
- Responsive, fast, low-friction manual entry and transaction history.

### M2 — Financial overview

- Per-month category budgets (JPY reporting) with spending converted at an appropriate transaction-date/reporting rate.
- Income, expense, budget, and month-over-month charts.
- Scheduled one-time and recurring items for future bills and expected income (forecasts are **not** posted transactions).
- Manual investment-account total valuations; track investments via total account values, not individual holdings.
- Tracked-assets overview and **estimated net worth** with an explicit warning that unpaid card balances and other untracked liabilities are excluded.
- Show balance/valuation as-of timestamps and identify stale valuations.

### M3 — Telegram expense entry

- Explicit Telegram account linking to the already-authenticated user; reject messages from all other Telegram identities.
- Natural-language message -> structured draft (amount, currency, category, merchant, date, payment method, account when relevant).
- Ask for missing/ambiguous information, present preview, then confirm/edit/cancel.
- **Never post financial transactions based only on the LLM output**; require explicit confirmation.
- Idempotent handling of webhook retries and duplicate user confirmations.
- All confirmed transactions use the same domain-service validations and data model as the web app.

## 4. Later phases (not MVP)

**Phase 2 — Planning:** savings goals, minimum cash buffer, available-to-spend model, projected end-of-month cash, future obligations and scenario comparisons.

**Phase 3 — AI decision support:** structured financial context prepared by deterministic services, then AI explanation of purchase/investment affordability, alternatives, trade-offs, and regular reports. AI must communicate uncertainty and never guarantee investment outcomes.

**Phase 4 — Automation/deeper analytics:** CSV imports, receipt OCR, bank integration where available, portfolio holdings and performance, more advanced reconciliations, durable AI/background jobs and observability.

## 5. Critical financial semantics

1. **Expense recognition**: expense reports and budgets count an expense once, at its transaction date, regardless of when the cash is eventually settled.
2. **Cash/debit purchase**: records an expense and decreases its linked bank/cash account.
3. **Credit-card purchase**: records an expense with payment method `credit_card` but does **not** decrease a bank/cash account and does **not** create a liability balance (intentional v1 simplification).
4. **Credit-card bill payment**: a `card_settlement` event reduces a bank/cash balance, but is excluded from income/expense and budget totals. This prevents double-counting expenses. It does not create a tracked card balance.
5. **Net worth caveat**: while credit-card bills remain unpaid, tracked assets are higher than true net worth. Label the financial overview **Tracked Assets**; only display **Estimated Net Worth** with a caveat that outstanding card obligations and any other untracked liabilities are excluded. Do **not** imply it is precise.
6. **Own-account transfers**: not income or expenses; both accounts' balances change. For FX transfers, retain actual currency amounts on each side, not a fictitious equal-value amount.
7. **Investment contribution/withdrawal**: movement between a cash account and a tracked investment account, not spending or salary income. Next manual valuation supersedes the prior investment valuation as the authoritative market-value snapshot.
8. **FX reporting**: store original amounts unchanged. Keep the conversion rate actually used for historical reports and manual overrides with timestamps and provenance. Live net-worth valuation may use a more recent FX rate and must disclose its as-of date.
9. **Future bills**: schedules/forecasts should never affect real balances or spending until recorded as an actual transaction; prevent accidentally recording them twice.
10. **Reconciliation**: balance corrections must be recorded as explicit audited adjustments, not silently rewrite opening balances or past transactions.

## 6. Non-functional requirements

- Sensitive financial records require Supabase row-level security for the allowed Google user; secrets and service-role keys remain server-side.
- Enforce validation and authentication in the service layer for both web and Telegram inputs.
- Exact amounts: integer minor units or exact decimal types, **never binary floating point for money**. Support currency-specific scale (for example JPY has no decimals).
- Use Asia/Tokyo as the default display timezone while preserving correct event instants and the user's local transaction date.
- Audit/edit history sufficient to understand balance changes; no silent AI writes.
- Provide data export and backup/recovery capability before relying on the app as a sole financial record.
- Automated tests: transfers, card purchases and settlement, reconciliation adjustments, budget totals, conversion overrides, investment valuations, webhook idempotency, and authorization.

## 7. Acceptance scenarios (must pass before MVP sign-off)

- An opening cash account of ¥100,000 plus a cash expense of ¥1,200 displays ¥98,800; spending for the month rises ¥1,200.
- A credit-card purchase of ¥10,000 increases expense reports by ¥10,000 but leaves tracked bank balances unchanged; its later ¥10,000 bank settlement decreases bank cash by ¥10,000 and **does not** increase expense reports again.
- A ¥30,000 transfer from Bank A to Bank B changes both balances but not income, expenses, or tracked total assets.
- A ¥50,000 transfer from a bank to an investment account does not count as an expense; a later manual investment valuation reflects the broker's current total without double-counting the contribution.
- A USD transaction retains USD as the source amount while reporting its JPY equivalent at the saved dated rate (or saved manual override).
- A Telegram message cannot generate a posted transaction until the owner confirms it; replaying the same webhook/confirmation cannot duplicate the posting.

## 8. Deferred design choices (not blockers for this planning baseline)

- Pick the FX-rate data source, update cadence, handling of missing historical rates and source attribution.
- Decide whether cards need optional spending labels/statement reminders in addition to basic payment-method designation.
- Decide how account balances are initialized for cash invested in assets that cannot be represented as a tradable account (physical gold, etc.).
- Specify how CSV export, backups, retention and account recovery will be provided.
- Choose the final hosting/deployment setup and cost limits before implementation.

## 9. Explicit exclusions for version 1

No historical transaction reconstruction; no tracked credit-card liabilities, statement reconciliation or debt amortization; no individual securities, cost-basis calculation or tax reporting; no bank account scraping; no automated trading; no separate AI orchestration infrastructure; no other users or shared households.

## 10. Approved product identity

- **Product name:** Faylo; company-umbrella concept: Momentum (not incorporated or a legal claim).
- **Brand personality:** calm, intelligent, approachable; friendly personal-finance companion.
- **UI direction (updated 2026-11-08):** minimalist, mobile-first, **black-first with green accents**: near-black canvas `#0B0B0C`, charcoal surfaces `#171717`, off-white text `#F1F3F2`, forest accent `#174A39`, restrained mint highlights `#80C7A2`. See [Design System v0.2.1](design-system.md), which supersedes the earlier all-green canvas interpretation.
- **Design skill:** OMP must locate/read/use the installed Taste skill before creating or revising user-facing UI, and report if not available.
- **Finance semantics beat decoration:** accessible contrast, mobile ergonomics, legible numbers and obvious warnings take priority over visual effects.
