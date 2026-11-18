import { DashboardView } from "@/components/dashboard/dashboard-view";
import { monthStartForTimezone, parseMonthParameter } from "@/lib/dashboard/presentation";
import { listMonthlyCategorySpending, listMonthlyDashboardTotals } from "@/lib/dashboard/repository";
import { requireOwner } from "@/lib/auth/server";
import { getUserTimezone, listTransactionSetup, listTransactions, type TransactionFilters } from "@/lib/transactions/repository";
import { tokyoDateToday } from "@/lib/transactions/fx-types";

export const dynamic = "force-dynamic";

const RECENT_ACTIVITY_FILTERS: TransactionFilters = { search: "", kind: "all", status: "posted", occurredFrom: "", occurredThrough: "" };

type DashboardSearchParams = Promise<{ month?: string | string[] }>;

export default async function HomePage({ searchParams }: { searchParams: DashboardSearchParams }) {
  const owner = await requireOwner();
  const timezone = await getUserTimezone(owner.id);
  const currentMonthStart = monthStartForTimezone(new Date(), timezone);
  const params = await searchParams;
  const requestedMonth = typeof params.month === "string" ? params.month : undefined;
  const monthStart = parseMonthParameter(requestedMonth, currentMonthStart);
  const [totalsResult, categoryResult, setupResult, historyResult] = await Promise.all([
    listMonthlyDashboardTotals(owner.id, monthStart, 6),
    listMonthlyCategorySpending(owner.id, monthStart),
    listTransactionSetup(owner.id),
    listTransactions(owner.id, RECENT_ACTIVITY_FILTERS, 1),
  ]);

  // Month selection scopes monthly reports; this setup lookup returns the latest account projections.
  return <DashboardView
    accounts={setupResult.ok ? setupResult.value.accounts : null}
    categories={setupResult.ok ? setupResult.value.categories : []}
    categoryRows={categoryResult.ok ? categoryResult.value : null}
    currentMonthStart={currentMonthStart}
    email={owner.email}
    monthStart={monthStart}
    monthlyTotals={totalsResult.ok ? totalsResult.value : null}
    recentFxToday={tokyoDateToday()}
    recentTransactions={historyResult.ok ? historyResult.value.rows : null}
    timezone={timezone}
  />;
}
