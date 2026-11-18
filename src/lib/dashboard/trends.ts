import { previousMonthStart } from "./presentation.ts";
import type { MonthlyDashboardTotal } from "./repository";

export type MonthlyTrendValueState =
  | "complete"
  | "incomplete_fx"
  | "partial_coverage"
  | "insufficient_history"
  | "unavailable";

export type MonthlyTrendValue = {
  state: MonthlyTrendValueState;
  valueJpy: string | null;
  resolvedSubtotalJpy: string | null;
  resolvedCount: number;
  unresolvedCount: number;
  includedCount: number;
};

export type MonthlyTrendPoint = {
  monthStart: string;
  monthToDate: boolean;
  coverageStatus: MonthlyDashboardTotal["coverageStatus"];
  income: MonthlyTrendValue;
  spending: MonthlyTrendValue;
  comparison: "matching_coverage" | "coverage_mismatch" | "insufficient_history" | "incomplete_data" | "month_to_date" | "window_start";
};

function unavailableValue(): MonthlyTrendValue {
  return {
    state: "unavailable",
    valueJpy: null,
    resolvedSubtotalJpy: null,
    resolvedCount: 0,
    unresolvedCount: 0,
    includedCount: 0,
  };
}

function trendValue(rows: MonthlyDashboardTotal[], coverageStatus: MonthlyTrendPoint["coverageStatus"]): MonthlyTrendValue {
  const first = rows[0];
  if (!first || rows.some((row) => row.resolvedJpyTotal !== first.resolvedJpyTotal
    || row.resolvedTransactionCount !== first.resolvedTransactionCount
    || row.unresolvedTransactionCount !== first.unresolvedTransactionCount
    || row.includedTransactionCount !== first.includedTransactionCount
    || row.coverageStatus !== first.coverageStatus)) return unavailableValue();

  const base = {
    resolvedSubtotalJpy: first.resolvedJpyTotal,
    resolvedCount: first.resolvedTransactionCount,
    unresolvedCount: first.unresolvedTransactionCount,
    includedCount: first.includedTransactionCount,
  };
  if (coverageStatus === "insufficient_history") return { ...base, state: "insufficient_history", valueJpy: null };
  if (first.includedTransactionCount === 0) {
    return coverageStatus === "fully_tracked"
      ? { ...base, state: "complete", valueJpy: "0" }
      : { ...base, state: "partial_coverage", valueJpy: null };
  }
  if (first.unresolvedTransactionCount !== 0
    || first.resolvedTransactionCount !== first.includedTransactionCount
    || first.resolvedJpyTotal === null) {
    return { ...base, state: "incomplete_fx", valueJpy: null };
  }
  return { ...base, state: "complete", valueJpy: first.resolvedJpyTotal };
}

function hasCompletePair(point: MonthlyTrendPoint): boolean {
  return point.income.valueJpy !== null && point.spending.valueJpy !== null;
}

export function buildMonthlyTrendPoints(
  totals: readonly MonthlyDashboardTotal[],
  currentMonthStart: string,
): MonthlyTrendPoint[] {
  const months = [...new Set(totals.map((row) => row.monthStart))].sort();
  const points = months.map((monthStart) => {
    const monthRows = totals.filter((row) => row.monthStart === monthStart);
    const incomeRows = monthRows.filter((row) => row.kind === "income");
    const spendingRows = monthRows.filter((row) => row.kind === "expense");
    const coverageStatus = monthRows.length > 0
      && monthRows.every((row) => row.coverageStatus === monthRows[0].coverageStatus)
      ? monthRows[0].coverageStatus
      : "insufficient_history";
    return {
      monthStart,
      monthToDate: monthStart === currentMonthStart,
      coverageStatus,
      income: trendValue(incomeRows, coverageStatus),
      spending: trendValue(spendingRows, coverageStatus),
      comparison: "window_start" as MonthlyTrendPoint["comparison"],
    };
  });

  return points.map((point, index) => {
    if (point.monthToDate) return { ...point, comparison: "month_to_date" };
    const previous = points[index - 1];
    if (!previous || previousMonthStart(point.monthStart) !== previous.monthStart) {
      return { ...point, comparison: "window_start" };
    }
    if (point.coverageStatus === "insufficient_history" || previous.coverageStatus === "insufficient_history") {
      return { ...point, comparison: "insufficient_history" };
    }
    const rows = totals.filter((row) => row.monthStart === point.monthStart);
    if (!rows.length || !rows.every((row) => row.comparableToPrevious)) {
      return { ...point, comparison: "coverage_mismatch" };
    }
    if (!hasCompletePair(point) || !hasCompletePair(previous)) {
      return { ...point, comparison: "incomplete_data" };
    }
    return { ...point, comparison: "matching_coverage" };
  });
}
