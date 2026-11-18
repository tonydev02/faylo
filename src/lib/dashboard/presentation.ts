import { currencyFractionDigits } from "../accounts/money.ts";
import { dateInTimezone } from "../transactions/presentation.ts";

const DECIMAL_AMOUNT = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const INTEGER_AMOUNT = /^(0|[1-9][0-9]*)$/;

export type CurrencyAmount = { currencyCode: string; amount: string };
export type BudgetProgress =
  | { status: "unbudgeted" }
  | { status: "incomplete"; resolvedJpyTotal: string | null; unresolvedCount: number }
  | {
      status: "complete" | "zero_limit";
      spentJpy: string;
      limitJpy: string;
      remainingJpy: string;
      fillPercent: number;
      percentageLabel: string | null;
    };

function amountToMinorUnits(amount: string, currencyCode: string): bigint {
  const fractionDigits = currencyFractionDigits(currencyCode);
  const match = DECIMAL_AMOUNT.exec(amount);
  if (fractionDigits === null || !match) throw new Error("Cannot aggregate an invalid currency amount.");

  const [, sign, whole, fraction = ""] = match;
  const retainedFraction = fraction.slice(0, fractionDigits);
  if (/[1-9]/.test(fraction.slice(fractionDigits))) throw new Error("Amount exceeds its currency precision.");
  const scale = BigInt(10) ** BigInt(fractionDigits);
  const minor = BigInt(whole) * scale + BigInt(retainedFraction.padEnd(fractionDigits, "0") || "0");
  return sign === "-" && minor !== BigInt(0) ? -minor : minor;
}

function minorUnitsToAmount(minor: bigint, currencyCode: string): string {
  const fractionDigits = currencyFractionDigits(currencyCode);
  if (fractionDigits === null) throw new Error("Cannot format an invalid currency amount.");
  const negative = minor < BigInt(0);
  const absolute = negative ? -minor : minor;
  const scale = BigInt(10) ** BigInt(fractionDigits);
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const decimal = fractionDigits === 0 ? "" : `.${fraction.toString().padStart(fractionDigits, "0")}`;
  return `${negative ? "-" : ""}${whole}${decimal}`;
}

export function addMoney(left: string, right: string, currencyCode: string): string {
  return minorUnitsToAmount(
    amountToMinorUnits(left, currencyCode) + amountToMinorUnits(right, currencyCode),
    currencyCode,
  );
}

export function subtractMoney(left: string, right: string, currencyCode: string): string {
  return minorUnitsToAmount(
    amountToMinorUnits(left, currencyCode) - amountToMinorUnits(right, currencyCode),
    currencyCode,
  );
}

export function sumByCurrency(amounts: readonly CurrencyAmount[]): CurrencyAmount[] {
  const totals = new Map<string, bigint>();
  for (const entry of amounts) {
    if (!/^[A-Z]{3}$/.test(entry.currencyCode)) throw new Error("Cannot aggregate an invalid currency code.");
    const total = (totals.get(entry.currencyCode) ?? BigInt(0)) + amountToMinorUnits(entry.amount, entry.currencyCode);
    totals.set(entry.currencyCode, total);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, minor]) => ({ currencyCode, amount: minorUnitsToAmount(minor, currencyCode) }));
}

export function monthStartForTimezone(now = new Date(), timezone = "Asia/Tokyo"): string {
  return `${dateInTimezone(now, timezone).slice(0, 7)}-01`;
}

export function previousMonthStart(monthStart: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(monthStart)) throw new Error("Month start must be the first day of a calendar month.");
  const date = new Date(`${monthStart}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
}

export function monthLabel(monthStart: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(monthStart)) throw new Error("Month start must be the first day of a calendar month.");
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${monthStart}T00:00:00.000Z`));
}

export function parseMonthParameter(value: string | undefined, currentMonthStart: string): string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return currentMonthStart;
  const requestedStart = `${value}-01`;
  return requestedStart <= currentMonthStart ? requestedStart : currentMonthStart;
}

export function compareNativeTotals(
  current: readonly { currencyCode: string | null; totalAmount: string | null }[],
  previous: readonly { currencyCode: string | null; totalAmount: string | null }[],
): CurrencyAmount[] {
  const currentTotals = sumByCurrency(current.flatMap((row) =>
    row.currencyCode && row.totalAmount !== null ? [{ currencyCode: row.currencyCode, amount: row.totalAmount }] : [],
  ));
  const previousTotals = sumByCurrency(previous.flatMap((row) =>
    row.currencyCode && row.totalAmount !== null ? [{ currencyCode: row.currencyCode, amount: row.totalAmount }] : [],
  ));
  const currentByCurrency = new Map(currentTotals.map((entry) => [entry.currencyCode, entry.amount]));
  const previousByCurrency = new Map(previousTotals.map((entry) => [entry.currencyCode, entry.amount]));
  const currencies = new Set([...currentByCurrency.keys(), ...previousByCurrency.keys()]);
  return [...currencies].sort().map((currencyCode) => ({
    currencyCode,
    amount: subtractMoney(currentByCurrency.get(currencyCode) ?? "0", previousByCurrency.get(currencyCode) ?? "0", currencyCode),
  }));
}

export function calculateBudgetProgress(input: {
  limitJpy: string | null;
  resolvedJpyTotal: string | null;
  resolvedTransactionCount: number;
  unresolvedTransactionCount: number;
  includedTransactionCount: number;
}): BudgetProgress {
  const { limitJpy, resolvedJpyTotal, resolvedTransactionCount, unresolvedTransactionCount, includedTransactionCount } = input;
  if (limitJpy === null) return { status: "unbudgeted" };
  if (!INTEGER_AMOUNT.test(limitJpy)) throw new Error("JPY budget limits must be non-negative whole yen.");
  if (resolvedJpyTotal !== null && !INTEGER_AMOUNT.test(resolvedJpyTotal)) throw new Error("Resolved JPY totals must be non-negative whole yen.");
  if (![resolvedTransactionCount, unresolvedTransactionCount, includedTransactionCount].every(Number.isSafeInteger)
    || resolvedTransactionCount < 0 || unresolvedTransactionCount < 0 || includedTransactionCount < 0) {
    throw new Error("Budget transaction counts must be non-negative integers.");
  }

  const complete = unresolvedTransactionCount === 0
    && resolvedTransactionCount + unresolvedTransactionCount === includedTransactionCount
    && (includedTransactionCount === 0 || resolvedTransactionCount > 0 && resolvedJpyTotal !== null);
  if (!complete) return { status: "incomplete", resolvedJpyTotal, unresolvedCount: unresolvedTransactionCount };

  const spentJpy = resolvedJpyTotal ?? "0";
  const limit = BigInt(limitJpy);
  const spent = BigInt(spentJpy);
  const remainingJpy = (limit - spent).toString();
  if (limit === BigInt(0)) {
    return { status: "zero_limit", spentJpy, limitJpy, remainingJpy, fillPercent: spent > BigInt(0) ? 100 : 0, percentageLabel: null };
  }
  const fillPercent = Number(spent >= limit ? BigInt(100) : spent * BigInt(100) / limit);
  const percentageHundredths = spent * BigInt(10_000) / limit;
  const percentageLabel = `${percentageHundredths / BigInt(100)}.${(percentageHundredths % BigInt(100)).toString().padStart(2, "0")}%`;
  return { status: "complete", spentJpy, limitJpy, remainingJpy, fillPercent, percentageLabel };
}
