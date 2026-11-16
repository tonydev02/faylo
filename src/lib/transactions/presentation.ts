import { formatMoney } from "../accounts/money.ts";
import type { TransactionEventKind } from "./validation";

export function formatTransactionAmount(amount: string, currencyCode: string, kind: TransactionEventKind): string {
  return `${kind === "income" ? "+" : "−"}${formatMoney(amount, currencyCode)}`;
}

export function formatTransactionDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function formatRecordingTime(value: string, timezone = "Asia/Tokyo"): string {
  let resolvedTimezone = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: resolvedTimezone });
  } catch {
    resolvedTimezone = "Asia/Tokyo";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: resolvedTimezone,
  }).format(new Date(value));
}

export function dateInTimezone(now = new Date(), timezone = "Asia/Tokyo"): string {
  let resolvedTimezone = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: resolvedTimezone });
  } catch {
    resolvedTimezone = "Asia/Tokyo";
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function currentMonthLabel(now = new Date(), timezone = "Asia/Tokyo"): string {
  let resolvedTimezone = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: resolvedTimezone });
  } catch {
    resolvedTimezone = "Asia/Tokyo";
  }
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: resolvedTimezone }).format(now);
}

export function categoryPath(categoryName: string, parentName: string | null): string {
  return parentName ? `${parentName} / ${categoryName}` : categoryName;
}
