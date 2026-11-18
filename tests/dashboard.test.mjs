import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBudgetProgress,
  compareNativeTotals,
  monthStartForTimezone,
  parseMonthParameter,
  previousMonthStart,
  sumByCurrency,
} from "../src/lib/dashboard/presentation.ts";
import { buildMonthlyTrendPoints } from "../src/lib/dashboard/trends.ts";
import { parseBudgetFormInput, parseBudgetRemovalInput } from "../src/lib/dashboard/validation.ts";

test("native balances and report comparisons use exact per-currency arithmetic", () => {
  assert.deepEqual(sumByCurrency([
    { currencyCode: "JPY", amount: "9007199254740993" },
    { currencyCode: "JPY", amount: "7" },
    { currencyCode: "USD", amount: "1.10" },
    { currencyCode: "USD", amount: "2.22" },
  ]), [
    { currencyCode: "JPY", amount: "9007199254741000" },
    { currencyCode: "USD", amount: "3.32" },
  ]);
  assert.deepEqual(compareNativeTotals(
    [{ currencyCode: "JPY", totalAmount: "200" }, { currencyCode: "USD", totalAmount: "5.50" }],
    [{ currencyCode: "JPY", totalAmount: "100" }, { currencyCode: "VND", totalAmount: "40" }],
  ), [
    { currencyCode: "JPY", amount: "100" },
    { currencyCode: "USD", amount: "5.50" },
    { currencyCode: "VND", amount: "-40" },
  ]);
});

test("reporting month boundaries follow the owner timezone and reject future month navigation", () => {
  const boundary = new Date("2026-01-31T15:30:00.000Z");
  assert.equal(monthStartForTimezone(boundary, "Asia/Tokyo"), "2026-02-01");
  assert.equal(monthStartForTimezone(boundary, "America/Los_Angeles"), "2026-01-01");
  assert.equal(previousMonthStart("2026-01-01"), "2025-12-01");
  assert.equal(parseMonthParameter("2026-02", "2026-01-01"), "2026-01-01");
  assert.equal(parseMonthParameter("2025-13", "2026-01-01"), "2026-01-01");
});

test("budget progress distinguishes complete zero, over-budget, and unresolved FX states", () => {
  assert.deepEqual(calculateBudgetProgress({
    limitJpy: "2000",
    resolvedJpyTotal: null,
    resolvedTransactionCount: 0,
    unresolvedTransactionCount: 0,
    includedTransactionCount: 0,
  }), {
    status: "complete",
    spentJpy: "0",
    limitJpy: "2000",
    remainingJpy: "2000",
    fillPercent: 0,
    percentageLabel: "0.00%",
  });

  const overBudget = calculateBudgetProgress({
    limitJpy: "2000",
    resolvedJpyTotal: "3000",
    resolvedTransactionCount: 2,
    unresolvedTransactionCount: 0,
    includedTransactionCount: 2,
  });
  assert.equal(overBudget.status, "complete");
  if (overBudget.status !== "complete") return;
  assert.equal(overBudget.remainingJpy, "-1000");
  assert.equal(overBudget.fillPercent, 100);
  assert.equal(overBudget.percentageLabel, "150.00%");

  const incomplete = calculateBudgetProgress({
    limitJpy: "2000",
    resolvedJpyTotal: "1200",
    resolvedTransactionCount: 1,
    unresolvedTransactionCount: 1,
    includedTransactionCount: 2,
  });
  assert.deepEqual(incomplete, { status: "incomplete", resolvedJpyTotal: "1200", unresolvedCount: 1 });
  assert.equal("remainingJpy" in incomplete, false);

  assert.equal(calculateBudgetProgress({
    limitJpy: "0",
    resolvedJpyTotal: null,
    resolvedTransactionCount: 0,
    unresolvedTransactionCount: 0,
    includedTransactionCount: 0,
  }).status, "zero_limit");
});

test("budget form parsing accepts whole-yen limits and rejects malformed identity or month values", () => {
  const categoryId = "d9110000-0000-4000-8000-000000000001";
  assert.deepEqual(parseBudgetFormInput({ categoryId, monthStart: "2026-11-01", limitJpy: "0" }), {
    ok: true,
    categoryId,
    monthStart: "2026-11-01",
    limitJpy: "0",
  });
  assert.deepEqual(parseBudgetFormInput({ categoryId, monthStart: "2026-11-01", limitJpy: "1.5" }), { ok: false, field: "limitJpy" });
  assert.deepEqual(parseBudgetFormInput({ categoryId: "not-a-uuid", monthStart: "2026-11-01", limitJpy: "5" }), { ok: false, field: "categoryId" });
  assert.deepEqual(parseBudgetFormInput({ categoryId, monthStart: "2026-11-02", limitJpy: "5" }), { ok: false, field: "monthStart" });
  assert.deepEqual(parseBudgetRemovalInput({ categoryId, monthStart: "2026-11-01" }), { ok: true, categoryId, monthStart: "2026-11-01" });
});
function trendRow(monthStart, kind, overrides = {}) {
  const includedCount = overrides.includedTransactionCount ?? 1;
  return {
    monthStart,
    kind,
    currencyCode: overrides.currencyCode ?? (includedCount === 0 ? null : "JPY"),
    totalAmount: Object.hasOwn(overrides, "totalAmount") ? overrides.totalAmount : (includedCount === 0 ? null : "1"),
    transactionCount: includedCount,
    resolvedJpyTotal: Object.hasOwn(overrides, "resolvedJpyTotal") ? overrides.resolvedJpyTotal : "1000",
    resolvedTransactionCount: overrides.resolvedTransactionCount ?? 1,
    unresolvedTransactionCount: overrides.unresolvedTransactionCount ?? 0,
    includedTransactionCount: includedCount,
    coverageStatus: overrides.coverageStatus ?? "fully_tracked",
    comparableToPrevious: overrides.comparableToPrevious ?? false,
    asOf: "2026-11-19T00:00:00.000Z",
  };
}

test("trend values use fully resolved stored JPY snapshots across native currencies", () => {
  const monthStart = "2026-10-01";
  const totals = [
    trendRow(monthStart, "income", { currencyCode: "USD", totalAmount: "10.00", resolvedJpyTotal: "3250", resolvedTransactionCount: 2, includedTransactionCount: 2 }),
    trendRow(monthStart, "income", { currencyCode: "JPY", totalAmount: "1000", resolvedJpyTotal: "3250", resolvedTransactionCount: 2, includedTransactionCount: 2 }),
    trendRow(monthStart, "expense", { resolvedJpyTotal: "750" }),
  ];
  const [point] = buildMonthlyTrendPoints(totals, "2026-11-01");
  assert.equal(point.income.valueJpy, "3250");
  assert.equal(point.spending.valueJpy, "750");
  assert.equal(point.income.state, "complete");
});

test("unresolved FX keeps a resolved subtotal out of trend bars instead of converting missing data to zero", () => {
  const monthStart = "2026-10-01";
  const point = buildMonthlyTrendPoints([
    trendRow(monthStart, "income", { resolvedJpyTotal: "1500", resolvedTransactionCount: 1, unresolvedTransactionCount: 1, includedTransactionCount: 2 }),
    trendRow(monthStart, "expense", { includedTransactionCount: 0, resolvedJpyTotal: null, resolvedTransactionCount: 0 }),
  ], "2026-11-01")[0];
  assert.equal(point.income.valueJpy, null);
  assert.equal(point.income.state, "incomplete_fx");
  assert.equal(point.income.resolvedSubtotalJpy, "1500");
  assert.equal(point.spending.valueJpy, "0");
});

test("trend points break direct comparisons when account coverage changes", () => {
  const partial = { coverageStatus: "partial_account_coverage", comparableToPrevious: false };
  const totals = [
    trendRow("2026-09-01", "income", partial),
    trendRow("2026-09-01", "expense", partial),
    trendRow("2026-10-01", "income", partial),
    trendRow("2026-10-01", "expense", partial),
  ];
  const points = buildMonthlyTrendPoints(totals, "2026-11-01");
  assert.equal(points[1].income.valueJpy, "1000");
  assert.equal(points[1].comparison, "coverage_mismatch");
});

test("current month values are explicitly month-to-date and never compared with completed periods", () => {
  const monthStart = "2026-11-01";
  const point = buildMonthlyTrendPoints([
    trendRow(monthStart, "income"),
    trendRow(monthStart, "expense", { includedTransactionCount: 0, resolvedJpyTotal: null, resolvedTransactionCount: 0 }),
  ], monthStart)[0];
  assert.equal(point.monthToDate, true);
  assert.equal(point.comparison, "month_to_date");
  assert.equal(point.spending.valueJpy, "0");
});

test("a zero-activity month is charted as zero only with fully tracked coverage", () => {
  const fullyTracked = trendRow("2026-09-01", "expense", {
    includedTransactionCount: 0,
    resolvedJpyTotal: null,
    resolvedTransactionCount: 0,
  });
  const partial = trendRow("2026-10-01", "expense", {
    includedTransactionCount: 0,
    resolvedJpyTotal: null,
    resolvedTransactionCount: 0,
    coverageStatus: "partial_account_coverage",
  });
  const points = buildMonthlyTrendPoints([
    fullyTracked,
    trendRow("2026-09-01", "income", { includedTransactionCount: 0, resolvedJpyTotal: null, resolvedTransactionCount: 0 }),
    partial,
    trendRow("2026-10-01", "income", { ...partial, includedTransactionCount: 0, resolvedJpyTotal: null, resolvedTransactionCount: 0 }),
  ], "2026-11-01");
  assert.equal(points[0].spending.valueJpy, "0");
  assert.equal(points[1].spending.valueJpy, null);
  assert.equal(points[1].spending.state, "partial_coverage");
});
