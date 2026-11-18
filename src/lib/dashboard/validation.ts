export type BudgetActionState = { kind?: "success" | "error"; message?: string };

const WHOLE_YEN_PATTERN = /^(0|[1-9][0-9]*)$/;
const MONTH_START_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBudgetFormInput(input: {
  categoryId: unknown;
  monthStart: unknown;
  limitJpy: unknown;
}): { ok: true; categoryId: string; monthStart: string; limitJpy: string }
  | { ok: false; field: "categoryId" | "monthStart" | "limitJpy" } {
  if (typeof input.categoryId !== "string" || !UUID_PATTERN.test(input.categoryId)) return { ok: false, field: "categoryId" };
  if (typeof input.monthStart !== "string" || !MONTH_START_PATTERN.test(input.monthStart)
    || Number.isNaN(Date.parse(`${input.monthStart}T00:00:00.000Z`))) return { ok: false, field: "monthStart" };
  if (typeof input.limitJpy !== "string" || !WHOLE_YEN_PATTERN.test(input.limitJpy)) return { ok: false, field: "limitJpy" };
  return { ok: true, categoryId: input.categoryId, monthStart: input.monthStart, limitJpy: input.limitJpy };
}

export function parseBudgetRemovalInput(input: {
  categoryId: unknown;
  monthStart: unknown;
}): { ok: true; categoryId: string; monthStart: string }
  | { ok: false; field: "categoryId" | "monthStart" } {
  if (typeof input.categoryId !== "string" || !UUID_PATTERN.test(input.categoryId)) return { ok: false, field: "categoryId" };
  if (typeof input.monthStart !== "string" || !MONTH_START_PATTERN.test(input.monthStart)
    || Number.isNaN(Date.parse(`${input.monthStart}T00:00:00.000Z`))) return { ok: false, field: "monthStart" };
  return { ok: true, categoryId: input.categoryId, monthStart: input.monthStart };
}
