import "server-only";

import { randomUUID } from "node:crypto";
import { isPositiveDecimal } from "./fx-decimal";
import { lookupFrankfurterRate, type FrankfurterLookup } from "./fx-provider";
import { parseReportingFxSnapshot, tokyoDateToday } from "./fx-types";
import type { ReportingFxSnapshot } from "./fx-types";
import { createSupabaseServerClient } from "@/lib/auth/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export type ReportingFxResolutionResult =
  | { ok: true; snapshotId: string }
  | { ok: false; message: string };

type ResolverTransaction = {
  id: string;
  kind: "income" | "expense";
  occurredOn: string;
  currencyCode: string;
  amount: string;
  status: "posted" | "voided";
  snapshot: ReportingFxSnapshot | null;
};

type CacheHit = { rate: string; effectiveOn: string; fetchedAt: string; providers: string[] };

const inFlightLookups = new Map<string, Promise<FrankfurterLookup>>();

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value;
}

function dateMinusSevenDays(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

async function coalescedLookup(currencyCode: string, occurredOn: string): Promise<FrankfurterLookup> {
  const key = `${currencyCode}:${occurredOn}`;
  const existing = inFlightLookups.get(key);
  if (existing) return existing;
  const lookup = lookupFrankfurterRate(currencyCode, occurredOn);
  inFlightLookups.set(key, lookup);
  try {
    return await lookup;
  } finally {
    if (inFlightLookups.get(key) === lookup) inFlightLookups.delete(key);
  }
}

async function loadTransactionFxInput(transactionId: string): Promise<ResolverTransaction | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_transactions", {
    p_search: null,
    p_kind: null,
    p_status: null,
    p_occurred_from: null,
    p_occurred_through: null,
    p_transaction_id: transactionId,
    p_limit: 1,
    p_offset: 0,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as {
    transaction_id?: unknown;
    transaction_kind?: unknown;
    occurred_on?: unknown;
    amount?: unknown;
    currency_code?: unknown;
    status?: unknown;
    reporting_fx?: unknown;
  };
  if (row.transaction_id !== transactionId
    || (row.transaction_kind !== "income" && row.transaction_kind !== "expense")
    || typeof row.occurred_on !== "string" || !isDateOnly(row.occurred_on)
    || typeof row.amount !== "string" || !DECIMAL_PATTERN.test(row.amount)
    || typeof row.currency_code !== "string" || !/^[A-Z]{3}$/.test(row.currency_code)
    || (row.status !== "posted" && row.status !== "voided")) return null;
  const snapshot = parseReportingFxSnapshot(row.reporting_fx);
  if (snapshot === undefined) return null;
  return {
    id: transactionId,
    kind: row.transaction_kind,
    occurredOn: row.occurred_on,
    currencyCode: row.currency_code,
    amount: row.amount,
    status: row.status,
    snapshot,
  };
}

async function cachedRate(currencyCode: string, occurredOn: string): Promise<CacheHit | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_cached_reporting_fx_rate", {
      p_base_currency: currencyCode,
      p_requested_on: occurredOn,
    });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as {
      rate?: unknown;
      effective_on?: unknown;
      fetched_at?: unknown;
      provider_metadata?: unknown;
    };
    if (typeof row.rate !== "string" || !isPositiveDecimal(row.rate)
      || typeof row.effective_on !== "string" || !isDateOnly(row.effective_on)
      || typeof row.fetched_at !== "string"
      || typeof row.provider_metadata !== "object" || row.provider_metadata === null || Array.isArray(row.provider_metadata)) return null;
    const metadata = row.provider_metadata as { providers?: unknown };
    const providers = Array.isArray(metadata.providers) && metadata.providers.every((provider) => typeof provider === "string")
      ? metadata.providers as string[] : [];
    if (row.effective_on < dateMinusSevenDays(occurredOn) || row.effective_on > occurredOn) return null;
    return { rate: row.rate, effectiveOn: row.effective_on, fetchedAt: row.fetched_at, providers };
  } catch {
    return null;
  }
}

async function recordAutomaticSnapshot(
  transaction: ResolverTransaction,
  input: {
    status: "resolved" | "pending_future" | "unavailable" | "unresolved";
    rate: string | null;
    sourceKind: "frankfurter_blended" | "identity" | "unresolved";
    providerCode: "frankfurter" | null;
    effectiveOn: string | null;
    fetchedAt: string | null;
    providerSources: string[];
    reason: string | null;
    lookup?: Extract<FrankfurterLookup, { kind: "found" | "unavailable" }>;
    failureReason?: string;
  },
): Promise<string | null> {
  try {
    const cacheObservations = input.lookup?.observations ?? [];
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("record_transaction_reporting_fx_snapshot", {
      p_transaction_id: transaction.id,
      p_idempotency_key: randomUUID(),
      p_status: input.status,
      p_rate_to_jpy: input.rate,
      p_source_kind: input.sourceKind,
      p_provider_code: input.providerCode,
      p_rate_effective_on: input.effectiveOn,
      p_fetched_at: input.fetchedAt,
      p_provider_metadata: input.failureReason ? { failure: input.failureReason } : { providers: input.providerSources },
      p_resolution_reason: input.reason,
      p_cache_rates: cacheObservations.map((observation) => ({
        effective_on: observation.effectiveOn,
        rate: observation.rate,
        providers: observation.providers,
      })),
      p_cache_requested_from: cacheObservations.length > 0 ? input.lookup?.requestedFrom ?? null : null,
      p_cache_requested_through: cacheObservations.length > 0 ? input.lookup?.requestedThrough ?? null : null,
    });
    return !error && typeof data === "string" && UUID_PATTERN.test(data) ? data : null;
  } catch {
    return null;
  }
}

async function applyFrankfurterResult(transaction: ResolverTransaction, result: FrankfurterLookup): Promise<void> {
  if (result.kind === "found") {
    await recordAutomaticSnapshot(transaction, {
      status: "resolved",
      rate: result.selected.rate,
      sourceKind: "frankfurter_blended",
      providerCode: "frankfurter",
      effectiveOn: result.selected.effectiveOn,
      fetchedAt: result.fetchedAt,
      providerSources: result.selected.providers,
      reason: null,
      lookup: result,
    });
    return;
  }
  if (result.kind === "unavailable") {
    await recordAutomaticSnapshot(transaction, {
      status: "unavailable",
      rate: null,
      sourceKind: "unresolved",
      providerCode: "frankfurter",
      effectiveOn: null,
      fetchedAt: result.fetchedAt,
      providerSources: [],
      reason: "No Frankfurter observation was available within seven calendar days before the economic date.",
      lookup: result,
    });
    return;
  }
  await recordAutomaticSnapshot(transaction, {
    status: "unresolved",
    rate: null,
    sourceKind: "unresolved",
    providerCode: "frankfurter",
    effectiveOn: null,
    fetchedAt: null,
    providerSources: [],
    reason: "The historical rate lookup could not be completed. Retry or enter a manual reporting rate.",
    failureReason: result.reason,
  });
}

export async function resolveTransactionReportingFx(
  ownerId: string,
  transactionId: string,
  retryUnavailable = false,
): Promise<void> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(transactionId)) return;
  try {
    const transaction = await loadTransactionFxInput(transactionId);
    if (!transaction || transaction.status !== "posted") return;
    const current = transaction.snapshot;
    if (current?.status === "resolved" || (current?.status === "unavailable" && !retryUnavailable)) return;

    const isFuture = transaction.occurredOn > tokyoDateToday();
    if (transaction.currencyCode === "JPY") {
      await recordAutomaticSnapshot(transaction, {
        status: "resolved",
        rate: "1",
        sourceKind: "identity",
        providerCode: null,
        effectiveOn: transaction.occurredOn,
        fetchedAt: null,
        providerSources: [],
        reason: null,
      });
      return;
    }
    if (isFuture) {
      if (current?.status === "pending_future") return;
      await recordAutomaticSnapshot(transaction, {
        status: "pending_future",
        rate: null,
        sourceKind: "unresolved",
        providerCode: null,
        effectiveOn: null,
        fetchedAt: null,
        providerSources: [],
        reason: "This foreign-currency transaction is future-effective. Historical lookup starts on its economic date in Asia/Tokyo.",
      });
      return;
    }
    if (current?.status === "unavailable" && !retryUnavailable) return;

    const cached = await cachedRate(transaction.currencyCode, transaction.occurredOn);
    if (cached) {
      await recordAutomaticSnapshot(transaction, {
        status: "resolved",
        rate: cached.rate,
        sourceKind: "frankfurter_blended",
        providerCode: "frankfurter",
        effectiveOn: cached.effectiveOn,
        fetchedAt: cached.fetchedAt,
        providerSources: cached.providers,
        reason: null,
      });
      return;
    }

    let lookup: FrankfurterLookup;
    try {
      lookup = await coalescedLookup(transaction.currencyCode, transaction.occurredOn);
    } catch {
      lookup = { kind: "unresolved", reason: "frankfurter_request_failed" };
    }
    await applyFrankfurterResult(transaction, lookup);
  } catch {
    // FX is a reporting sidecar. Missing or failed FX storage never invalidates the native event.
  }
}

export async function overrideTransactionReportingFx(input: {
  ownerId: string;
  transactionId: string;
  idempotencyKey: string;
  rate: string;
  effectiveOn: string;
  note: string;
}): Promise<ReportingFxResolutionResult> {
  if (!UUID_PATTERN.test(input.ownerId) || !UUID_PATTERN.test(input.transactionId)
    || !UUID_PATTERN.test(input.idempotencyKey) || !isPositiveDecimal(input.rate)
    || !isDateOnly(input.effectiveOn) || input.note.trim().length === 0 || input.note.trim().length > 500) {
    return { ok: false, message: "Enter a positive reporting rate, its effective date, and an explanation." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("override_transaction_reporting_fx", {
      p_transaction_id: input.transactionId,
      p_idempotency_key: input.idempotencyKey,
      p_rate_to_jpy: input.rate,
      p_rate_effective_on: input.effectiveOn,
      p_override_note: input.note.trim(),
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
      const message = error?.message?.toLowerCase() ?? "";
      return {
        ok: false,
        message: message.includes("seven days") || message.includes("effective")
          ? "Use an eligible effective date no more than seven days before the transaction date."
          : "The reporting rate could not be saved. Check the rate and explanation, then try again.",
      };
    }
    return { ok: true, snapshotId: data };
  } catch {
    return { ok: false, message: "FX revision storage is unavailable. The native transaction was not changed." };
  }
}
