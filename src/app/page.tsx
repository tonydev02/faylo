import Link from "next/link";
import { AppShell, Icon } from "@/components/app-shell";
import { formatEffectiveBalance } from "@/lib/accounts/presentation";
import { listAccounts } from "@/lib/accounts/repository";
import { formatMoney } from "@/lib/accounts/money";
import { requireOwner } from "@/lib/auth/server";
import { currentMonthLabel, formatSignedAmount, formatTransactionAmount, formatTransactionDate } from "@/lib/transactions/presentation";
import { getUserTimezone, listMonthlyTransactionTotals, listTransactions, type TransactionFilters, type TransactionRecord, type TransactionTotal } from "@/lib/transactions/repository";
import { tokyoDateToday } from "@/lib/transactions/fx-types";

export const dynamic = "force-dynamic";

const RECENT_ACTIVITY_FILTERS: TransactionFilters = { search: "", kind: "all", status: "posted", occurredFrom: "", occurredThrough: "" };

function MonthlyTotals({ title, kind, totals }: { title: string; kind: "income" | "expense"; totals: TransactionTotal[] }) {
  const report = totals.find((total) => total.kind === kind);
  const rows = report?.nativeTotals ?? [];
  const includedCount = report?.includedTransactionCount ?? 0;
  const unresolvedCount = report?.unresolvedTransactionCount ?? 0;
  const resolvedJpyTotal = report?.resolvedJpyTotal ?? null;
  const hasResolvedSubtotal = resolvedJpyTotal !== null;
  return (
    <section aria-label={`${title} by currency`} className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted">{title}</h2>
        <span className={kind === "income" ? "size-1.5 rounded-full bg-mint" : "size-1.5 rounded-full bg-muted/70"} />
      </div>
      <div className="mt-4 space-y-4">
        <section aria-label={`${title} in original currencies`}>
          <h3 className="text-[12px] font-medium text-ink">Original currencies</h3>
          {rows.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">No {kind} recorded</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {rows.map((row) => <li className="flex items-baseline justify-between gap-3" key={row.currencyCode}><span className="text-[12px] text-muted">{row.currencyCode} · {row.transactionCount} {row.transactionCount === 1 ? "event" : "events"}</span><span className={kind === "income" ? "text-[18px] font-semibold tabular-nums text-mint" : "text-[18px] font-medium tabular-nums text-ink"}>{formatMoney(row.amount, row.currencyCode)}</span></li>)}
            </ul>
          )}
        </section>
        <section aria-label={`${title} JPY reference subtotal`} className="border-t border-border pt-3">
          <h3 className="text-[12px] font-medium text-ink">JPY reference subtotal</h3>
          {hasResolvedSubtotal ? (
            <p className={kind === "income" ? "mt-2 text-[19px] font-semibold tabular-nums text-mint" : "mt-2 text-[19px] font-semibold tabular-nums text-ink"}>{formatMoney(resolvedJpyTotal, "JPY")}</p>
          ) : (
            <p className="mt-2 text-[13px] text-muted">No resolved JPY subtotal</p>
          )}
          {unresolvedCount > 0 ? (
            <p className="mt-2 text-[12px] leading-5 text-[#d59494]">Incomplete subtotal · {unresolvedCount} included {unresolvedCount === 1 ? "transaction has" : "transactions have"} no resolved JPY conversion.</p>
          ) : includedCount > 0 ? (
            <p className="mt-2 text-[12px] leading-5 text-muted">Complete · all {includedCount} included {includedCount === 1 ? "transaction has" : "transactions have"} a resolved JPY conversion.</p>
          ) : (
            <p className="mt-2 text-[12px] leading-5 text-muted">No included transactions this month.</p>
          )}
        </section>
      </div>
      <p className="mt-4 border-t border-border pt-3 text-[12px] leading-5 text-muted">{kind === "income" ? "Posted income only" : "Posted spending only"} · native amounts stay primary · JPY conversion is rounded per transaction</p>
    </section>
  );
}

function MonthlyJpyComparison({ totals }: { totals: TransactionTotal[] }) {
  const rows = [
    { kind: "income" as const, label: "Income" },
    { kind: "expense" as const, label: "Spending" },
  ].map((item) => ({
    ...item,
    total: totals.find((total) => total.kind === item.kind)?.resolvedJpyTotal ?? null,
  }));
  const resolvedValues = rows.flatMap((row) => row.total === null ? [] : [BigInt(row.total)]);
  const maximum = resolvedValues.reduce((max, value) => value > max ? value : max, BigInt(0));
  return (
    <section aria-label="Monthly JPY reference comparison chart" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-[13px] font-medium text-ink">Resolved JPY comparison</h2>
      <p className="mt-1 text-[12px] leading-5 text-muted">Bars compare resolved subtotals only. Any missing conversions remain explicitly incomplete above.</p>
      <div className="mt-5 space-y-4">
        {rows.map((row) => {
          const width = row.total === null || maximum === BigInt(0) ? 0 : Number((BigInt(row.total) * BigInt(10_000)) / maximum) / 100;
          return (
            <div key={row.kind}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12px] font-medium text-muted">{row.label}</p>
                <p className="text-[13px] font-medium tabular-nums text-ink">{row.total === null ? "No resolved subtotal" : formatMoney(row.total, "JPY")}</p>
              </div>
              {row.total === null ? (
                <p className="mt-1 text-[11px] text-muted">Not charted · no resolved JPY conversion</p>
              ) : (
                <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
                  <span className={row.kind === "income" ? "block h-full rounded-full bg-mint" : "block h-full rounded-full bg-muted/70"} style={{ width: `${width}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function recentTitle(record: TransactionRecord): string {
  if (record.kind === "transfer") {
    const [source, destination] = record.accountMovements;
    return source && destination ? `${source.accountName} → ${destination.accountName}` : "Own-account transfer";
  }
  if (record.kind === "balance_adjustment") return "Balance adjustment";
  return record.merchant ?? record.categoryName;
}

function recentSubtitle(record: TransactionRecord): string {
  if (record.kind === "transfer") return `${formatTransactionDate(record.occurredOn)} · excluded from income and spending`;
  if (record.kind === "balance_adjustment") {
    const account = record.accountMovements[0]?.accountName ?? "Tracked account";
    return `${formatTransactionDate(record.occurredOn)} · ${account} · ${record.adjustmentReason ?? "Reason not available"}`;
  }
  return `${formatTransactionDate(record.occurredOn)} · ${record.categoryName}`;
}

function recentAmounts(record: TransactionRecord): string[] {
  if (record.kind === "transfer") {
    return record.accountMovements.map((movement) => formatSignedAmount(movement.amount, movement.currencyCode));
  }
  if (record.amount === null || record.currencyCode === null) return ["Account movement"];
  return [formatTransactionAmount(record.amount, record.currencyCode, record.kind)];
}

function recentReportingFx(record: TransactionRecord, today: string): string | null {
  if ((record.kind !== "income" && record.kind !== "expense") || !record.currencyCode || record.currencyCode === "JPY") return null;
  if (record.reportingFx?.status === "resolved" && record.reportingFx.convertedAmountJpy !== null) {
    return `JPY reference · ${formatMoney(record.reportingFx.convertedAmountJpy, "JPY")}`;
  }
  if (record.occurredOn > today) return "JPY conversion pending until its economic date";
  if (record.reportingFx?.status === "unavailable") return "JPY conversion unavailable · no eligible historical rate";
  return "JPY conversion unresolved · open transaction for details";
}

export default async function HomePage() {
  const owner = await requireOwner();
  const [accountsResult, totalsResult, historyResult, timezone] = await Promise.all([
    listAccounts(owner.id),
    listMonthlyTransactionTotals(owner.id),
    listTransactions(owner.id, RECENT_ACTIVITY_FILTERS, 1),
    getUserTimezone(owner.id),
  ]);
  const totals = totalsResult.ok ? totalsResult.value : [];
  const activeAccounts = accountsResult.ok ? accountsResult.value.filter((account) => account.status === "active") : [];
  const recent = historyResult.ok ? historyResult.value.rows.slice(0, 5) : [];
  const today = tokyoDateToday();

  return (
    <AppShell email={owner.email}>
      <div className="mx-auto max-w-[1200px] space-y-7 sm:space-y-8">
        <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-[12px] font-medium text-muted"><span className="size-1.5 rounded-full bg-mint" />{currentMonthLabel(new Date(), timezone)} · private workspace</p>
            <h1 className="mt-4 text-[38px] font-medium leading-[1.08] tracking-[-0.055em] text-ink sm:text-[48px]">A clearer view of your money.</h1>
            <p className="mt-4 max-w-xl text-[14px] leading-7 text-muted sm:text-[15px]">Original transaction amounts remain primary. JPY reference subtotals use each transaction&apos;s economic date and stay separate from native-currency totals.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 text-[13px] font-medium text-ink transition-colors hover:bg-raised" href="/transactions/new?kind=income">Add income</Link>
            <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-mint px-4 text-[13px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8]" href="/transactions/new?kind=expense">Add expense <Icon className="size-4" name="arrow" /></Link>
          </div>
        </header>

        {!totalsResult.ok && <p className="account-form-message" role="alert">Monthly income and spending totals are unavailable. Check the transaction database migration.</p>}
        <section aria-label="Monthly income and spending" className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <MonthlyTotals kind="income" title="Income this month" totals={totals} />
          <MonthlyTotals kind="expense" title="Spending this month" totals={totals} />
        </section>

        {totalsResult.ok && <MonthlyJpyComparison totals={totals} />}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <section aria-labelledby="account-balances-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-[12px] font-medium text-muted">Native-currency accounts</p><h2 className="mt-2 text-[18px] font-medium tracking-[-0.035em] text-ink" id="account-balances-title">Account balances</h2></div>
              <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/accounts">Manage accounts</Link>
            </div>
            {!accountsResult.ok ? (
              <p className="account-form-message mt-5" role="alert">Account balances are unavailable. Check the account balance projection migration.</p>
            ) : activeAccounts.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border px-5 py-8 text-center"><h3 className="text-[14px] font-medium text-ink">No active accounts</h3><p className="mt-2 text-[13px] leading-5 text-muted">Add a bank or cash account with its opening balance. The opening snapshot is not income.</p><Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/accounts/new">Add an account</Link></div>
            ) : (
              <ul className="mt-5 divide-y divide-border">
                {activeAccounts.map((account) => <li className="flex min-h-[70px] items-center justify-between gap-4 py-3" key={account.id}><div className="min-w-0"><Link className="truncate text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:text-mint" href={`/accounts/${account.id}`}>{account.name}</Link><p className="mt-1 text-[11px] capitalize text-muted">{account.accountKind} · {account.currencyCode}</p></div><p className="shrink-0 text-right text-[16px] font-medium tabular-nums text-ink">{formatEffectiveBalance(account.balance, account.currencyCode)}</p></li>)}
              </ul>
            )}
            <p className="mt-4 border-t border-border pt-3 text-[12px] leading-5 text-muted">Balances use the opening snapshot plus posted, non-voided account entries. Different currencies are not combined.</p>
          </section>

          <section aria-labelledby="recent-activity-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[12px] font-medium text-muted">Recent posted activity</p><h2 className="mt-2 text-[18px] font-medium tracking-[-0.035em] text-ink" id="recent-activity-title">Recent activity</h2></div>
              <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/transactions">See history</Link>
            </div>
            {!historyResult.ok ? (
              <p className="account-form-message mt-5" role="alert">Recent activity is unavailable. Try reloading the transaction history.</p>
            ) : recent.length === 0 ? (
              <div className="mt-5 flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/90 bg-canvas/25 px-5 text-center"><span className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted"><Icon className="size-[18px]" name="activity" /></span><h3 className="mt-3 text-[13px] font-medium text-ink/90">No transactions yet</h3><p className="mt-1.5 max-w-sm text-[12px] leading-5 text-muted">Opening balances remain separate. Add income or spending to begin your transaction history.</p></div>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {recent.map((record) => {
                  const amounts = recentAmounts(record);
                  const reportingFx = recentReportingFx(record, today);
                  return (
                    <li key={record.id}>
                      <Link className="transaction-row-link flex min-h-[66px] items-center justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-canvas/70" href={`/transactions/${record.id}`}>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-ink">{recentTitle(record)}</span>
                          <span className="mt-1 block truncate text-[11px] text-muted">{recentSubtitle(record)}</span>
                        </span>
                        <span aria-label="Native amount, account movements, and JPY reference" className={record.kind === "income" ? "shrink-0 text-right text-[14px] font-semibold tabular-nums text-mint" : "shrink-0 text-right text-[12px] font-medium tabular-nums text-ink"}>
                          {amounts.map((amount, index) => <span className="block" key={`${record.id}-${index}`}>{amount}</span>)}
                          {reportingFx && <span className="mt-1 block max-w-[180px] text-[10px] font-normal leading-4 text-muted">{reportingFx}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="flex flex-col gap-2 border-t border-border pt-5 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Faylo private workspace</span>
          <span>Card settlements reduce cash, not spending. Outstanding card balances and statements are not tracked; tracked assets can overstate net worth.</span>
        </footer>
      </div>
    </AppShell>
  );
}
