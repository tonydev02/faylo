import Link from "next/link";
import { AppShell, Icon } from "@/components/app-shell";
import { BudgetEditor, AddBudgetForm } from "@/components/dashboard/budget-forms";
import { formatEffectiveBalance } from "@/lib/accounts/presentation";
import { formatMoney } from "@/lib/accounts/money";
import type { TrackedAccount } from "@/lib/accounts/repository";
import {
  calculateBudgetProgress,
  compareNativeTotals,
  monthLabel,
  previousMonthStart,
  sumByCurrency,
  type CurrencyAmount,
} from "@/lib/dashboard/presentation";
import type { MonthlyCategorySpending, MonthlyDashboardTotal } from "@/lib/dashboard/repository";
import { categoryPath, formatRecordingTime, formatSignedAmount, formatTransactionAmount, formatTransactionDate } from "@/lib/transactions/presentation";
import type { TransactionCategory, TransactionRecord } from "@/lib/transactions/repository";

export type DashboardViewProps = {
  email: string | null;
  monthStart: string;
  currentMonthStart: string;
  timezone: string;
  monthlyTotals: MonthlyDashboardTotal[] | null;
  categoryRows: MonthlyCategorySpending[] | null;
  accounts: TrackedAccount[] | null;
  categories: TransactionCategory[];
  recentTransactions: TransactionRecord[] | null;
  recentFxToday: string;
};

type MonthSummary = {
  coverageStatus: MonthlyDashboardTotal["coverageStatus"];
  comparableToPrevious: boolean;
  resolvedJpyTotal: string | null;
  unresolvedTransactionCount: number;
  includedTransactionCount: number;
  asOf: string;
};

type CategorySummary = Omit<MonthlyCategorySpending, "currencyCode" | "nativeTotal" | "transactionCount"> & {
  nativeTotals: CurrencyAmount[];
};

function rowsForMonth(totals: MonthlyDashboardTotal[], monthStart: string, kind: "income" | "expense"): MonthlyDashboardTotal[] {
  return totals.filter((row) => row.monthStart === monthStart && row.kind === kind);
}

function summarizeMonth(rows: MonthlyDashboardTotal[]): MonthSummary | null {
  const first = rows[0];
  if (!first) return null;
  return {
    coverageStatus: first.coverageStatus,
    comparableToPrevious: rows.every((row) => row.comparableToPrevious),
    resolvedJpyTotal: first.resolvedJpyTotal,
    unresolvedTransactionCount: first.unresolvedTransactionCount,
    includedTransactionCount: first.includedTransactionCount,
    asOf: first.asOf,
  };
}

function groupCategoryRows(rows: MonthlyCategorySpending[]): CategorySummary[] {
  const grouped = new Map<string, { summary: MonthlyCategorySpending; nativeAmounts: CurrencyAmount[] }>();
  for (const row of rows) {
    let group = grouped.get(row.categoryId);
    if (!group) {
      group = { summary: row, nativeAmounts: [] };
      grouped.set(row.categoryId, group);
    }
    if (row.currencyCode !== null && row.nativeTotal !== null) {
      group.nativeAmounts.push({ currencyCode: row.currencyCode, amount: row.nativeTotal });
    }
  }
  return [...grouped.values()].map(({ summary, nativeAmounts }) => ({
    ...summary,
    nativeTotals: sumByCurrency(nativeAmounts),
  }));
}

function monthComparison(
  currentRows: MonthlyDashboardTotal[],
  previousRows: MonthlyDashboardTotal[],
  monthStart: string,
  currentMonthStart: string,
): { status: "current" | "insufficient" | "coverage" | "ready"; changes: CurrencyAmount[] } {
  if (monthStart >= currentMonthStart) return { status: "current", changes: [] };
  const current = summarizeMonth(currentRows);
  const previous = summarizeMonth(previousRows);
  if (!current || !previous || current.coverageStatus === "insufficient_history" || previous.coverageStatus === "insufficient_history") {
    return { status: "insufficient", changes: [] };
  }
  if (!current.comparableToPrevious) return { status: "coverage", changes: [] };
  return { status: "ready", changes: compareNativeTotals(currentRows, previousRows) };
}

function formatDelta(amount: string, currencyCode: string): string {
  const formatted = formatMoney(amount, currencyCode);
  return amount.startsWith("-") ? formatted : `+${formatted}`;
}

function ComparisonNote({
  totals,
  kind,
  monthStart,
  currentMonthStart,
}: {
  totals: MonthlyDashboardTotal[];
  kind: "income" | "expense";
  monthStart: string;
  currentMonthStart: string;
}) {
  const currentRows = rowsForMonth(totals, monthStart, kind);
  const previousRows = rowsForMonth(totals, previousMonthStart(monthStart), kind);
  const comparison = monthComparison(currentRows, previousRows, monthStart, currentMonthStart);
  if (comparison.status === "current") {
    return <p className="mt-4 text-[12px] leading-5 text-muted">Month to date · full-month comparison is not available.</p>;
  }
  if (comparison.status === "insufficient") {
    return <p className="mt-4 text-[12px] leading-5 text-muted">Insufficient tracking history for a direct comparison with the previous month.</p>;
  }
  if (comparison.status === "coverage") {
    return <p className="mt-4 text-[12px] leading-5 text-muted">Previous month has different account coverage · direct comparison omitted.</p>;
  }
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-[11px] font-medium text-muted">Change from previous month · same account coverage</p>
      {comparison.changes.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted">No currency-level activity to compare.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {comparison.changes.map((change) => <li className="text-[12px] tabular-nums text-ink" key={change.currencyCode}>{change.currencyCode} {formatDelta(change.amount, change.currencyCode)}</li>)}
        </ul>
      )}
    </div>
  );
}

function MonthlySummaryCard({
  title,
  kind,
  monthStart,
  currentMonthStart,
  totals,
}: {
  title: string;
  kind: "income" | "expense";
  monthStart: string;
  currentMonthStart: string;
  totals: MonthlyDashboardTotal[];
}) {
  const rows = rowsForMonth(totals, monthStart, kind);
  const summary = summarizeMonth(rows);
  const nativeTotals = sumByCurrency(rows.flatMap((row) =>
    row.currencyCode && row.totalAmount !== null ? [{ currencyCode: row.currencyCode, amount: row.totalAmount }] : [],
  ));
  const isIncome = kind === "income";
  return (
    <section aria-label={`${title} report`} className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted">{title}</h2>
        <span className={isIncome ? "size-1.5 rounded-full bg-mint" : "size-1.5 rounded-full bg-muted/70"} />
      </div>
      <p className="mt-1 text-[11px] text-muted">Posted {kind} · original currency</p>
      <section aria-label={`${title} in original currencies`}>
      {nativeTotals.length === 0 ? (
        <p className="mt-5 text-[14px] text-muted">
          {summary?.includedTransactionCount === 0
            ? kind === "expense" && summary.coverageStatus === "fully_tracked"
              ? "No spending recorded in this completely tracked month."
              : kind === "expense" && summary.coverageStatus === "partial_account_coverage"
                ? "No recorded spending; account coverage was partial."
                : kind === "expense"
                  ? "No recorded spending; tracking history is insufficient to confirm zero activity."
                  : "No income recorded this month."
            : `No ${kind} recorded this month.`}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {nativeTotals.map((row) => {
            const count = rows.find((entry) => entry.currencyCode === row.currencyCode)?.transactionCount ?? 0;
            return <li className="flex items-baseline justify-between gap-3" key={row.currencyCode}><span className="text-[12px] text-muted">{row.currencyCode} · {count} {count === 1 ? "event" : "events"}</span><span className={isIncome ? "text-[20px] font-semibold tabular-nums text-mint" : "text-[20px] font-medium tabular-nums text-ink"}>{formatMoney(row.amount, row.currencyCode)}</span></li>;
          })}
        </ul>
      )}
      </section>
      <div className="mt-5 border-t border-border pt-3">
        <h3 className="text-[12px] font-medium text-ink">JPY reference · stored transaction snapshots</h3>
        {summary?.resolvedJpyTotal !== null && summary?.resolvedJpyTotal !== undefined ? (
          <p className="mt-2 text-[18px] font-semibold tabular-nums text-ink">{formatMoney(summary.resolvedJpyTotal, "JPY")}</p>
        ) : summary?.includedTransactionCount === 0 ? (
          <p className="mt-2 text-[13px] text-muted">No included transactions · no subtotal.</p>
        ) : (
          <p className="mt-2 text-[13px] text-muted">No resolved JPY subtotal is available.</p>
        )}
        {summary?.unresolvedTransactionCount ? (
          <div className="mt-2 rounded-xl border border-[#5a3b34] bg-[#241a16] p-3 text-[12px] leading-5 text-[#e6b6a1]">
            <p>Incomplete reference · {summary.unresolvedTransactionCount} included {summary.unresolvedTransactionCount === 1 ? "transaction has" : "transactions have"} no resolved JPY conversion. Unknown conversions are not treated as zero.</p>
            <p className="mt-1">Future-effective transactions become eligible on their economic date. Open transaction history and retry eligible lookups from each transaction detail.</p>
            <Link className="mt-2 inline-flex min-h-9 items-center font-medium text-mint underline underline-offset-4" href="/transactions">Open transaction history</Link>
          </div>
        ) : summary?.includedTransactionCount ? (
          <p className="mt-2 text-[12px] leading-5 text-muted">Complete · all {summary.includedTransactionCount} included transactions have a resolved per-transaction JPY snapshot.</p>
        ) : null}
      </div>
      <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted">Credit-card settlements are excluded. Transfers, balance adjustments, and voided events remain outside income and spending.</p>
      <ComparisonNote totals={totals} kind={kind} monthStart={monthStart} currentMonthStart={currentMonthStart} />
    </section>
  );
}

function CoverageBanner({ totals, monthStart }: { totals: MonthlyDashboardTotal[]; monthStart: string }) {
  const expense = summarizeMonth(rowsForMonth(totals, monthStart, "expense"));
  if (!expense) return null;
  const coverage = expense.coverageStatus;
  if (coverage === "fully_tracked") {
    return <div className="rounded-2xl border border-[#315c48] bg-[#14231b] px-4 py-3 text-[13px] leading-5 text-[#c2e4cf]"><strong className="font-semibold">Fully tracked month.</strong> Account opening history covers this entire period{expense.includedTransactionCount === 0 ? "; zero posted spending is complete, not missing data." : "."}</div>;
  }
  if (coverage === "partial_account_coverage") {
    return <div className="rounded-2xl border border-[#5a4a2b] bg-[#211e15] px-4 py-3 text-[13px] leading-5 text-[#e2d2a3]"><strong className="font-semibold">Partial account coverage.</strong> Valid historical transactions remain included; not every tracked account was open for the full month. Month-over-month comparisons are shown only when account coverage matches.</div>;
  }
  return <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-[13px] leading-5 text-muted"><strong className="font-medium text-ink">Insufficient tracking history.</strong> This period cannot be treated as a complete zero-activity month.</div>;
}


function CategorySpending({
  monthStart,
  rows,
  categories,
  available,
}: {
  monthStart: string;
  rows: MonthlyCategorySpending[] | null;
  categories: TransactionCategory[];
  available: boolean;
}) {
  if (!available || rows === null) {
    return <p className="account-form-message mt-5" role="alert">Category spending and budgets are unavailable. Check the dashboard reporting migration.</p>;
  }
  const grouped = groupCategoryRows(rows);
  const budgetedIds = new Set(grouped.filter((category) => category.budgetLimitJpy !== null).map((category) => category.categoryId));
  const activeExpenseCategories = categories.filter((category) => category.kind === "expense" && category.archivedAt === null);
  return (
    <>
      <p className="mt-3 max-w-3xl text-[12px] leading-5 text-muted">Budgets cover transactions assigned directly to the exact category shown; descendants are not silently included. Parent categories do not roll up child spending. Overall spending counts each posted expense once. Progress reflects recorded transactions; check the month coverage notice before treating zero as a complete period.</p>
      {grouped.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border px-4 py-6 text-[13px] leading-5 text-muted">No directly categorized posted spending or budgets for this month.</div>
      ) : (
        <ul className="mt-5 space-y-3">
          {grouped.map((category) => {
            const title = categoryPath(category.categoryName, category.parentCategoryName);
            const progress = calculateBudgetProgress({
              limitJpy: category.budgetLimitJpy,
              resolvedJpyTotal: category.resolvedJpyTotal,
              resolvedTransactionCount: category.resolvedTransactionCount,
              unresolvedTransactionCount: category.unresolvedTransactionCount,
              includedTransactionCount: category.includedTransactionCount,
            });
            const sourceCategory = categories.find((item) => item.id === category.categoryId);
            const editable = sourceCategory !== undefined && sourceCategory.archivedAt === null;
            return (
              <li className="rounded-2xl border border-border bg-canvas/45 p-4 sm:p-5" key={category.categoryId}>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-medium text-ink">{title}</h3>
                    <p className="mt-1 text-[11px] text-muted">{category.includedTransactionCount} directly assigned {category.includedTransactionCount === 1 ? "expense" : "expenses"}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 sm:justify-end">
                    {category.nativeTotals.length ? category.nativeTotals.map((total) => <span className="text-[13px] font-medium tabular-nums text-ink" key={total.currencyCode}>{total.currencyCode} {formatMoney(total.amount, total.currencyCode)}</span>) : <span className="text-[12px] text-muted">No spending recorded</span>}
                  </div>
                </div>
                {progress.status === "unbudgeted" ? (
                  category.unresolvedTransactionCount > 0 ? (
                    <p className="mt-3 text-[12px] leading-5 text-[#e6b6a1]">No budget set · JPY reference is incomplete with {category.unresolvedTransactionCount} unresolved conversion{category.unresolvedTransactionCount === 1 ? "" : "s"}.</p>
                  ) : category.resolvedJpyTotal !== null ? (
                    <p className="mt-3 text-[12px] leading-5 text-muted">No budget set · JPY reference {formatMoney(category.resolvedJpyTotal, "JPY")}.</p>
                  ) : null
                ) : progress.status === "incomplete" ? (
                  <p className="mt-4 rounded-xl border border-[#5a3b34] bg-[#241a16] px-3 py-2 text-[12px] leading-5 text-[#e6b6a1]">
                    {progress.resolvedJpyTotal !== null ? `At least ${formatMoney(progress.resolvedJpyTotal, "JPY")} has a resolved JPY snapshot. ` : ""}
                    {progress.unresolvedCount} unresolved conversion{progress.unresolvedCount === 1 ? "" : "s"} · budget progress is incomplete and remaining balance is not shown.
                  </p>
                ) : (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px]">
                      <span className="text-muted">{formatMoney(progress.spentJpy, "JPY")} of {formatMoney(progress.limitJpy, "JPY")} {progress.status === "zero_limit" ? "· zero limit" : `· ${progress.percentageLabel}`}</span>
                      <span className={BigInt(progress.remainingJpy) < BigInt(0) ? "font-medium text-[#f0a4a4]" : "text-muted"}>{BigInt(progress.remainingJpy) < BigInt(0) ? `Over by ${formatMoney((BigInt(progress.remainingJpy) * BigInt(-1)).toString(), "JPY")}` : `${formatMoney(progress.remainingJpy, "JPY")} remaining`}</span>
                    </div>
                    {progress.status === "complete" && <div aria-label={`${title} budget progress`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress.fillPercent} className="mt-2 h-2 overflow-hidden rounded-full bg-raised" role="progressbar"><div className="h-full rounded-full bg-mint" style={{ width: `${progress.fillPercent}%` }} /></div>}
                  </div>
                )}
                {category.budgetLimitJpy !== null && <BudgetEditor categoryId={category.categoryId} categoryName={title} editable={editable} limitJpy={category.budgetLimitJpy} monthStart={monthStart} />}
                {!editable && category.budgetLimitJpy !== null && <p className="mt-2 text-[11px] text-muted">This category is archived; its existing budget can be removed but not edited.</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-[13px] font-medium text-ink">Add a direct-category budget</h3>
        <AddBudgetForm budgetedCategoryIds={[...budgetedIds]} categories={activeExpenseCategories} monthStart={monthStart} />
      </div>
    </>
  );
}

function NativeAccountRows({ accounts, timezone }: { accounts: TrackedAccount[]; timezone: string }) {
  return (
    <ul className="mt-3 divide-y divide-border">
      {accounts.map((account) => <li className="flex min-h-[64px] items-center justify-between gap-4 py-3" key={account.id}>
        <div className="min-w-0"><Link className="truncate text-[13px] font-medium text-ink underline decoration-border underline-offset-4 hover:text-mint" href={`/accounts/${account.id}`}>{account.name}</Link><p className="mt-1 text-[11px] capitalize text-muted">{account.accountKind} · {account.currencyCode} · as of {formatRecordingTime(account.asOf, timezone)}</p></div>
        <p className="shrink-0 text-right text-[15px] font-medium tabular-nums text-ink">{formatEffectiveBalance(account.balance, account.currencyCode)}</p>
      </li>)}
    </ul>
  );
}

function TrackedAssets({ accounts, timezone }: { accounts: TrackedAccount[] | null; timezone: string }) {
  if (accounts === null) return <p className="account-form-message mt-5" role="alert">Account balances are unavailable. Check the account balance projection migration.</p>;
  const active = accounts.filter((account) => account.status === "active");
  const includedCashAndBank = active.filter((account) => account.accountKind !== "investment" && account.includeInAssets);
  const availableBalances = includedCashAndBank.flatMap((account) => account.balance === null ? [] : [{ currencyCode: account.currencyCode, amount: account.balance }]);
  const missingBalances = includedCashAndBank.filter((account) => account.balance === null).length;
  const totals = sumByCurrency(availableBalances);
  const investments = active.filter((account) => account.accountKind === "investment");
  const excludedNonInvestments = active.filter((account) => account.accountKind !== "investment" && !account.includeInAssets);
  return (
    <>
      <p className="mt-3 text-[12px] leading-5 text-muted">Tracked assets include only active bank and cash accounts marked for inclusion. Amounts stay grouped by native currency; no cross-currency total or net worth is calculated.</p>
      {totals.length === 0 ? (
        <p className="mt-4 text-[13px] leading-5 text-muted">No included bank or cash balances are available.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {totals.map((total) => <li className="flex items-baseline justify-between gap-3 border-b border-border pb-3" key={total.currencyCode}><span className="text-[12px] font-medium text-muted">{total.currencyCode}</span><span className="text-[19px] font-semibold tabular-nums text-ink">{formatMoney(total.amount, total.currencyCode)}</span></li>)}
        </ul>
      )}
      {missingBalances > 0 && <p className="mt-3 text-[12px] text-[#e2d2a3]">{missingBalances} included account {missingBalances === 1 ? "balance is" : "balances are"} unavailable; totals omit them.</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div><p className="text-[12px] font-medium text-ink">Investment account ledgers</p><p className="mt-1 text-[11px] leading-5 text-muted">Ledger balances only · not current investment market value · valuation is deferred to Issue #11.</p></div>
      </div>
      {investments.length ? <NativeAccountRows accounts={investments} timezone={timezone} /> : <p className="mt-3 text-[12px] text-muted">No investment account ledgers.</p>}
      {excludedNonInvestments.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-[12px] font-medium text-ink">Other bank and cash accounts · excluded from tracked assets</p>
          <NativeAccountRows accounts={excludedNonInvestments} timezone={timezone} />
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-4">
        {active.length === 0 && <Link className="inline-flex min-h-10 items-center text-[12px] font-medium text-mint underline underline-offset-4" href="/accounts/new">Add an account</Link>}
      </div>
    </>
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
  if (record.kind === "transfer") return record.accountMovements.map((movement) => formatSignedAmount(movement.amount, movement.currencyCode));
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

function MonthControls({ monthStart, currentMonthStart }: { monthStart: string; currentMonthStart: string }) {
  const previous = previousMonthStart(monthStart);
  const next = new Date(`${monthStart}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const nextStart = next.toISOString().slice(0, 10);
  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
      <div className="flex gap-2">
        <Link aria-label="Previous month" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-raised hover:text-ink" href={`/?month=${previous.slice(0, 7)}`}>←</Link>
        {monthStart < currentMonthStart ? <Link aria-label="Next month" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:bg-raised hover:text-ink" href={`/?month=${nextStart.slice(0, 7)}`}>→</Link> : <button aria-label="Next month" className="inline-flex min-h-11 min-w-11 cursor-not-allowed items-center justify-center rounded-xl border border-border text-muted opacity-40" disabled type="button">→</button>}
      </div>
      <div className="text-right sm:pb-1"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Reporting month</p><p className="mt-1 text-[16px] font-medium text-ink">{monthLabel(monthStart)}</p></div>
      <form action="/" className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:col-span-2" method="get">
        <label className="sr-only" htmlFor="dashboard-month">Choose month</label>
        <input className="account-field-control min-w-0 w-full" id="dashboard-month" max={currentMonthStart.slice(0, 7)} name="month" type="month" defaultValue={monthStart.slice(0, 7)} />
        <button className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl border border-border bg-raised px-3 text-[12px] font-medium text-ink transition-colors hover:bg-[#292929]" type="submit">View</button>
      </form>
    </div>
  );
}

export function DashboardView(props: DashboardViewProps) {
  const {
    email,
    monthStart,
    currentMonthStart,
    timezone,
    monthlyTotals,
    categoryRows,
    accounts,
    categories,
    recentTransactions,
    recentFxToday,
  } = props;
  const totals = monthlyTotals ?? [];
  const expenseSummary = summarizeMonth(rowsForMonth(totals, monthStart, "expense"));
  const incomeSummary = summarizeMonth(rowsForMonth(totals, monthStart, "income"));
  const recent = recentTransactions?.slice(0, 5) ?? [];
  const asOf = expenseSummary?.asOf ?? incomeSummary?.asOf;

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-[1240px] space-y-6 sm:space-y-8">
        <header className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(330px,0.72fr)] xl:items-end">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-[12px] font-medium text-muted"><span className="size-1.5 rounded-full bg-mint" />Monthly overview · private workspace</p>
            <h1 className="mt-3 text-[34px] font-medium leading-[1.08] tracking-[-0.055em] text-ink sm:text-[44px]">Your money, month by month.</h1>
            <p className="mt-3 max-w-xl text-[13px] leading-6 text-muted sm:text-[14px]">Original amounts stay authoritative. Monthly totals use owner-local economic dates; JPY references use each transaction&apos;s stored FX snapshot.</p>
          </div>
          <MonthControls currentMonthStart={currentMonthStart} monthStart={monthStart} />
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
          <span>Month boundaries · {timezone}</span>
          {asOf && <span>Report snapshot · {formatRecordingTime(asOf, timezone)}</span>}
        </div>
        {monthlyTotals === null ? (
          <p className="account-form-message" role="alert">Monthly income and spending are unavailable. Check the dashboard reporting migration.</p>
        ) : <CoverageBanner monthStart={monthStart} totals={totals} />}

        <section aria-label="Monthly income and spending" className="grid gap-3 md:grid-cols-2 sm:gap-4">
          {monthlyTotals === null ? (
            <div className="rounded-3xl border border-border bg-surface p-5 text-[13px] text-muted">Monthly totals could not be loaded.</div>
          ) : (
            <>
              <MonthlySummaryCard currentMonthStart={currentMonthStart} kind="income" title="Income" monthStart={monthStart} totals={totals} />
              <MonthlySummaryCard currentMonthStart={currentMonthStart} kind="expense" title="Spending" monthStart={monthStart} totals={totals} />
            </>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)]">
          <section aria-labelledby="category-spending-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Direct assignment · JPY budget limits</p><h2 className="mt-2 text-[18px] font-medium tracking-[-0.035em] text-ink" id="category-spending-title">Category spending &amp; budgets</h2></div>
              <Link className="inline-flex min-h-11 items-center text-[12px] font-medium text-mint underline underline-offset-4" href="/transactions">Transaction history</Link>
            </div>
            <CategorySpending available={categoryRows !== null} categories={categories} monthStart={monthStart} rows={categoryRows} />
          </section>

          <section aria-labelledby="tracked-assets-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Native-currency balances</p><h2 className="mt-2 text-[18px] font-medium tracking-[-0.035em] text-ink" id="tracked-assets-title">Tracked assets</h2></div>
              <Link className="inline-flex min-h-11 items-center text-[12px] font-medium text-mint underline underline-offset-4" href="/accounts">Manage accounts</Link>
            </div>
            <TrackedAssets accounts={accounts} timezone={timezone} />
          </section>
        </div>

        <section aria-labelledby="recent-activity-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Recent posted activity</p><h2 className="mt-2 text-[18px] font-medium tracking-[-0.035em] text-ink" id="recent-activity-title">Recent activity</h2></div>
            <Link className="inline-flex min-h-11 items-center text-[12px] font-medium text-mint underline underline-offset-4" href="/transactions">See history</Link>
          </div>
          {recentTransactions === null ? (
            <p className="account-form-message mt-5" role="alert">Recent activity is unavailable. Try reloading the transaction history.</p>
          ) : recent.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border px-5 py-8 text-center"><span className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-canvas text-muted"><Icon className="size-[18px]" name="activity" /></span><h3 className="mt-3 text-[13px] font-medium text-ink">No transactions yet</h3><p className="mt-1.5 text-[12px] leading-5 text-muted">Opening balances stay separate. Add income or spending to begin transaction history.</p></div>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {recent.map((record) => {
                const amounts = recentAmounts(record);
                const reportingFx = recentReportingFx(record, recentFxToday);
                return <li key={record.id}>
                  <Link className="transaction-row-link flex min-h-[66px] items-center justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-canvas/70" href={`/transactions/${record.id}`}>
                    <span className="min-w-0"><span className="block truncate text-[13px] font-medium text-ink">{recentTitle(record)}</span><span className="mt-1 block truncate text-[11px] text-muted">{recentSubtitle(record)}</span></span>
                    <span aria-label="Native amount, account movements, and JPY reference" className={record.kind === "income" ? "shrink-0 text-right text-[14px] font-semibold tabular-nums text-mint" : "shrink-0 text-right text-[12px] font-medium tabular-nums text-ink"}>
                      {amounts.map((amount, index) => <span className="block" key={`${record.id}-${index}`}>{amount}</span>)}
                      {reportingFx && <span className="mt-1 block max-w-[190px] text-[10px] font-normal leading-4 text-muted">{reportingFx}</span>}
                    </span>
                  </Link>
                </li>;
              })}
            </ul>
          )}
        </section>

        <footer className="flex flex-col gap-2 border-t border-border pt-5 text-[11px] leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Faylo private workspace</span>
          <span>Card settlements reduce cash, not spending. Outstanding card balances are not tracked; tracked assets can overstate net worth.</span>
        </footer>
      </div>
    </AppShell>
  );
}
