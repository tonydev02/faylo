const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORTING_FX_STATUSES: Readonly<Record<string, true>> = {
  resolved: true,
  pending_future: true,
  unavailable: true,
  unresolved: true,
};
const REPORTING_FX_SOURCES: Readonly<Record<string, true>> = {
  frankfurter_blended: true,
  manual: true,
  identity: true,
  unresolved: true,
};

export type ReportingFxStatus = "resolved" | "pending_future" | "unavailable" | "unresolved";
export type ReportingFxSource = "frankfurter_blended" | "manual" | "identity" | "unresolved";

export type ReportingFxSnapshot = {
  id: string;
  revision: number;
  status: ReportingFxStatus;
  rateToJpy: string | null;
  convertedAmountJpy: string | null;
  sourceKind: ReportingFxSource;
  providerCode: "frankfurter" | null;
  providerSources: string[];
  requestedOn: string;
  rateEffectiveOn: string | null;
  fetchedAt: string | null;
  overrideNote: string | null;
  resolutionReason: string | null;
  createdAt: string;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseReportingFxSnapshot(value: unknown): ReportingFxSnapshot | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const row = value as {
    id?: unknown;
    revision?: unknown;
    status?: unknown;
    rate_to_jpy?: unknown;
    converted_amount_jpy?: unknown;
    source_kind?: unknown;
    provider_code?: unknown;
    provider_metadata?: unknown;
    requested_on?: unknown;
    rate_effective_on?: unknown;
    fetched_at?: unknown;
    override_note?: unknown;
    resolution_reason?: unknown;
    created_at?: unknown;
  };
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.status !== "string" || !Object.hasOwn(REPORTING_FX_STATUSES, row.status)
    || (row.rate_to_jpy !== null && (typeof row.rate_to_jpy !== "string" || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(row.rate_to_jpy)))
    || (row.converted_amount_jpy !== null && (typeof row.converted_amount_jpy !== "string" || !/^(0|[1-9][0-9]*)$/.test(row.converted_amount_jpy)))
    || typeof row.source_kind !== "string" || !Object.hasOwn(REPORTING_FX_SOURCES, row.source_kind)
    || (row.status === "resolved" && (row.rate_to_jpy === null || row.converted_amount_jpy === null || row.rate_effective_on === null))
    || (row.provider_code !== null && row.provider_code !== "frankfurter")
    || typeof row.provider_metadata !== "object" || row.provider_metadata === null || Array.isArray(row.provider_metadata)
    || typeof row.requested_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.requested_on)
    || (row.rate_effective_on !== null && (typeof row.rate_effective_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.rate_effective_on)))
    || !nullableString(row.fetched_at) || !nullableString(row.override_note)
    || !nullableString(row.resolution_reason) || typeof row.created_at !== "string") return undefined;

  const metadata = row.provider_metadata as { providers?: unknown };
  const providers = Array.isArray(metadata.providers) && metadata.providers.every((provider) => typeof provider === "string")
    ? metadata.providers as string[] : [];
  return {
    id: row.id,
    revision: row.revision,
    status: row.status as ReportingFxStatus,
    rateToJpy: row.rate_to_jpy as string | null,
    convertedAmountJpy: row.converted_amount_jpy as string | null,
    sourceKind: row.source_kind as ReportingFxSource,
    providerCode: row.provider_code as "frankfurter" | null,
    providerSources: providers,
    requestedOn: row.requested_on,
    rateEffectiveOn: row.rate_effective_on as string | null,
    fetchedAt: row.fetched_at,
    overrideNote: row.override_note,
    resolutionReason: row.resolution_reason,
    createdAt: row.created_at,
  };
}

export function parseReportingFxHistory(value: unknown): ReportingFxSnapshot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const snapshots: ReportingFxSnapshot[] = [];
  for (const item of value) {
    const snapshot = parseReportingFxSnapshot(item);
    if (!snapshot) return undefined;
    snapshots.push(snapshot);
  }
  return snapshots;
}

export function tokyoDateToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
