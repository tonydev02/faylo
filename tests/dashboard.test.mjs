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
