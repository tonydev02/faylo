import "server-only";

import { createSupabaseServerClient } from "@/lib/auth/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_START_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const TRANSACTION_KINDS: Record<"income" | "expense", true> = { income: true, expense: true };
const COVERAGE_STATUSES: Record<"fully_tracked" | "partial_account_coverage" | "insufficient_history", true> = {
  fully_tracked: true,
  partial_account_coverage: true,
  insufficient_history: true,
};

export type DashboardServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "unavailable" | "rejected"; field?: string };

export type MonthlyDashboardTotal = {
  monthStart: string;
  kind: "income" | "expense";
  currencyCode: string | null;
  totalAmount: string | null;
  transactionCount: number;
  resolvedJpyTotal: string | null;
  resolvedTransactionCount: number;
  unresolvedTransactionCount: number;
  includedTransactionCount: number;
  coverageStatus: "fully_tracked" | "partial_account_coverage" | "insufficient_history";
  comparableToPrevious: boolean;
  asOf: string;
};

export type MonthlyCategorySpending = {
  categoryId: string;
  categoryName: string;
  parentCategoryName: string | null;
  currencyCode: string | null;
  nativeTotal: string | null;
  transactionCount: number;
  resolvedJpyTotal: string | null;
  resolvedTransactionCount: number;
  unresolvedTransactionCount: number;
  includedTransactionCount: number;
  budgetLimitJpy: string | null;
  asOf: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCount(value: unknown): number | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value)
    : typeof value === "string" ? value : "";
  if (!INTEGER_PATTERN.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isMonthStart(value: string): boolean {
  return MONTH_START_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function parseMonthlyDashboardTotal(value: unknown): MonthlyDashboardTotal | null {
  if (!isObject(value)) return null;
  const row = value;
  if (typeof row.month_start !== "string" || !isMonthStart(row.month_start)
    || typeof row.transaction_kind !== "string" || !Object.hasOwn(TRANSACTION_KINDS, row.transaction_kind)
    || (row.currency_code !== null && (typeof row.currency_code !== "string" || !/^[A-Z]{3}$/.test(row.currency_code)))
    || (row.total_amount !== null && (typeof row.total_amount !== "string" || !DECIMAL_PATTERN.test(row.total_amount)))
    || (row.resolved_total_jpy !== null && (typeof row.resolved_total_jpy !== "string" || !INTEGER_PATTERN.test(row.resolved_total_jpy)))
    || typeof row.coverage_status !== "string" || !Object.hasOwn(COVERAGE_STATUSES, row.coverage_status)
    || typeof row.comparable_to_previous !== "boolean" || !isTimestamp(row.as_of)) return null;

  const transactionCount = safeCount(row.transaction_count);
  const resolvedTransactionCount = safeCount(row.resolved_transaction_count);
  const unresolvedTransactionCount = safeCount(row.unresolved_transaction_count);
  const includedTransactionCount = safeCount(row.included_transaction_count);
  if (transactionCount === null || resolvedTransactionCount === null || unresolvedTransactionCount === null
    || includedTransactionCount === null
    || (row.currency_code === null && (row.total_amount !== null || transactionCount !== 0))) return null;

  return {
    monthStart: row.month_start,
    kind: row.transaction_kind as "income" | "expense",
    currencyCode: row.currency_code as string | null,
    totalAmount: row.total_amount as string | null,
    transactionCount,
    resolvedJpyTotal: row.resolved_total_jpy as string | null,
    resolvedTransactionCount,
    unresolvedTransactionCount,
    includedTransactionCount,
    coverageStatus: row.coverage_status as MonthlyDashboardTotal["coverageStatus"],
    comparableToPrevious: row.comparable_to_previous,
    asOf: row.as_of,
  };
}

function parseMonthlyCategorySpending(value: unknown): MonthlyCategorySpending | null {
  if (!isObject(value)) return null;
  const row = value;
  if (typeof row.category_id !== "string" || !UUID_PATTERN.test(row.category_id)
    || typeof row.category_name !== "string"
    || (row.parent_category_name !== null && typeof row.parent_category_name !== "string")
    || (row.currency_code !== null && (typeof row.currency_code !== "string" || !/^[A-Z]{3}$/.test(row.currency_code)))
    || (row.native_total !== null && (typeof row.native_total !== "string" || !DECIMAL_PATTERN.test(row.native_total)))
    || (row.resolved_total_jpy !== null && (typeof row.resolved_total_jpy !== "string" || !INTEGER_PATTERN.test(row.resolved_total_jpy)))
    || (row.budget_limit_jpy !== null && (typeof row.budget_limit_jpy !== "string" || !INTEGER_PATTERN.test(row.budget_limit_jpy)))
    || !isTimestamp(row.as_of)) return null;

  const transactionCount = safeCount(row.transaction_count);
  const resolvedTransactionCount = safeCount(row.resolved_transaction_count);
  const unresolvedTransactionCount = safeCount(row.unresolved_transaction_count);
  const includedTransactionCount = safeCount(row.included_transaction_count);
  if (transactionCount === null || resolvedTransactionCount === null || unresolvedTransactionCount === null
    || includedTransactionCount === null
    || (row.currency_code === null && (row.native_total !== null || transactionCount !== 0))) return null;

  return {
    categoryId: row.category_id,
    categoryName: row.category_name,
    parentCategoryName: row.parent_category_name as string | null,
    currencyCode: row.currency_code as string | null,
    nativeTotal: row.native_total as string | null,
    transactionCount,
    resolvedJpyTotal: row.resolved_total_jpy as string | null,
    resolvedTransactionCount,
    unresolvedTransactionCount,
    includedTransactionCount,
    budgetLimitJpy: row.budget_limit_jpy as string | null,
    asOf: row.as_of,
  };
}

export async function listMonthlyDashboardTotals(
  ownerId: string,
  monthStart: string,
  monthCount = 6,
): Promise<DashboardServiceResult<MonthlyDashboardTotal[]>> {
  if (!UUID_PATTERN.test(ownerId) || !isMonthStart(monthStart) || !Number.isInteger(monthCount) || monthCount < 1 || monthCount > 12) {
    return { ok: false, kind: "rejected" };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("monthly_dashboard_totals", {
      p_month_start: monthStart,
      p_month_count: monthCount,
    });
    if (error || !Array.isArray(data)) return { ok: false, kind: "unavailable" };
    const rows = data.map(parseMonthlyDashboardTotal);
    if (rows.some((row) => row === null)) return { ok: false, kind: "unavailable" };
    return { ok: true, value: rows as MonthlyDashboardTotal[] };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function listMonthlyCategorySpending(
  ownerId: string,
  monthStart: string,
): Promise<DashboardServiceResult<MonthlyCategorySpending[]>> {
  if (!UUID_PATTERN.test(ownerId) || !isMonthStart(monthStart)) return { ok: false, kind: "rejected" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("monthly_category_spending", { p_month_start: monthStart });
    if (error || !Array.isArray(data)) return { ok: false, kind: "unavailable" };
    const rows = data.map(parseMonthlyCategorySpending);
    if (rows.some((row) => row === null)) return { ok: false, kind: "unavailable" };
    return { ok: true, value: rows as MonthlyCategorySpending[] };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function saveCategoryBudget(
  ownerId: string,
  categoryId: string,
  monthStart: string,
  limitJpy: string,
): Promise<DashboardServiceResult<null>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(categoryId) || !isMonthStart(monthStart)) {
    return { ok: false, kind: "rejected" };
  }
  if (!INTEGER_PATTERN.test(limitJpy)) return { ok: false, kind: "rejected", field: "limitJpy" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data: category, error: categoryError } = await supabase.from("categories")
      .select("id").eq("user_id", ownerId).eq("id", categoryId).eq("kind", "expense").is("archived_at", null).maybeSingle();
    if (categoryError) return { ok: false, kind: "unavailable" };
    if (!category) return { ok: false, kind: "rejected", field: "categoryId" };
    const { error } = await supabase.from("category_budgets").upsert({
      user_id: ownerId,
      category_id: categoryId,
      month_start: monthStart,
      limit_jpy: limitJpy,
    }, { onConflict: "user_id,month_start,category_id" });
    if (error) return { ok: false, kind: "unavailable" };
    return { ok: true, value: null };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function removeCategoryBudget(
  ownerId: string,
  categoryId: string,
  monthStart: string,
): Promise<DashboardServiceResult<null>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(categoryId) || !isMonthStart(monthStart)) {
    return { ok: false, kind: "rejected" };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("category_budgets").delete()
      .eq("user_id", ownerId).eq("category_id", categoryId).eq("month_start", monthStart);
    if (error) return { ok: false, kind: "unavailable" };
    return { ok: true, value: null };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}
