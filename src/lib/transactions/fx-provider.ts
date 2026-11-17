import { expandDecimalExponent, isPositiveDecimal } from "./fx-decimal.ts";

const FRANKFURTER_API = "https://api.frankfurter.dev/v2/rates";
const REQUEST_TIMEOUT_MS = 1800;
const TOTAL_TIMEOUT_MS = 4800;
const MAX_RESPONSE_LENGTH = 200_000;
const DECIMAL_JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

export type FrankfurterObservation = {
  effectiveOn: string;
  rate: string;
  providers: string[];
};

export type FrankfurterLookup =
  | { kind: "found"; selected: FrankfurterObservation; observations: FrankfurterObservation[]; requestedFrom: string; requestedThrough: string; fetchedAt: string }
  | { kind: "unavailable"; reason: string; observations: FrankfurterObservation[]; requestedFrom: string; requestedThrough: string; fetchedAt: string }
  | { kind: "unresolved"; reason: string };

type LookupOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function shiftDate(value: string, days: number): string | null {
  if (!validDate(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}


function preserveRateTokens(text: string): string {
  const pieces: string[] = [];
  let copiedThrough = 0;
  let position = 0;
  while (position < text.length) {
    if (text[position] !== "\"") {
      position += 1;
      continue;
    }
    const keyStart = position;
    position += 1;
    while (position < text.length) {
      if (text[position] === "\\") {
        position += 2;
      } else if (text[position] === "\"") {
        position += 1;
        break;
      } else {
        position += 1;
      }
    }
    if (text.slice(keyStart, position) !== "\"rate\"") continue;
    let valueStart = position;
    while (/\s/.test(text[valueStart] ?? "")) valueStart += 1;
    if (text[valueStart] !== ":") continue;
    valueStart += 1;
    while (/\s/.test(text[valueStart] ?? "")) valueStart += 1;
    let valueEnd = valueStart;
    while (/[0-9eE.+-]/.test(text[valueEnd] ?? "")) valueEnd += 1;
    const token = text.slice(valueStart, valueEnd);
    if (!DECIMAL_JSON_NUMBER.test(token)) continue;
    pieces.push(text.slice(copiedThrough, valueStart), "\"", token, "\"");
    copiedThrough = valueEnd;
    position = valueEnd;
  }
  return pieces.length === 0 ? text : `${pieces.join("")}${text.slice(copiedThrough)}`;
}
function parseRateRows(text: string, baseCurrency: string): FrankfurterObservation[] | null {
  if (text.length > MAX_RESPONSE_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(preserveRateTokens(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const observations: FrankfurterObservation[] = [];
  for (const value of parsed) {
    if (!isRecord(value)
      || typeof value.date !== "string" || !validDate(value.date)
      || typeof value.base !== "string" || value.base.toUpperCase() !== baseCurrency
      || typeof value.quote !== "string" || value.quote.toUpperCase() !== "JPY"
      || typeof value.rate !== "string" || !DECIMAL_JSON_NUMBER.test(value.rate)) return null;
    const rate = expandDecimalExponent(value.rate);
    if (rate === null || !isPositiveDecimal(rate)) return null;
    const providers: string[] = [];
    if (value.providers !== undefined) {
      if (!Array.isArray(value.providers)) return null;
      for (const provider of value.providers) {
        if (!isRecord(provider) || typeof provider.key !== "string" || provider.key.trim().length === 0
          || (provider.excluded !== undefined && typeof provider.excluded !== "boolean")) return null;
        if (provider.excluded !== true) providers.push(provider.key);
      }
    }
    observations.push({ effectiveOn: value.date, rate, providers });
  }
  return observations;
}

function retryAfterMilliseconds(value: string | null, now: number): number | null {
  if (value === null) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.ceil(Number(value.trim()) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function defaultSleep(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

export async function lookupFrankfurterRate(
  baseCurrency: string,
  requestedOn: string,
  options: LookupOptions = {},
): Promise<FrankfurterLookup> {
  const requestedFrom = shiftDate(requestedOn, -7);
  if (!/^[A-Z]{3}$/.test(baseCurrency) || baseCurrency === "JPY" || !requestedFrom || !validDate(requestedOn)) {
    return { kind: "unresolved", reason: "invalid_fx_request" };
  }

  const query = new URLSearchParams({
    base: baseCurrency,
    quotes: "JPY",
    from: requestedFrom,
    to: requestedOn,
    "expand": "providers",
  });
  const url = `${FRANKFURTER_API}?${query.toString()}`;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const deadline = now() + TOTAL_TIMEOUT_MS;
  let response: Response | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      response = null;
    }

    const transient = response === null || response.status === 429 || response.status >= 500;
    if (!transient) break;
    if (attempt === 1) return { kind: "unresolved", reason: "frankfurter_request_failed" };

    const retryAfter = response ? retryAfterMilliseconds(response.headers.get("Retry-After"), now()) : null;
    const jitter = 100 + Math.floor(random() * 151);
    const delay = retryAfter === null ? jitter : retryAfter + jitter;
    const remaining = deadline - now();
    if (delay > remaining || remaining <= 0) return { kind: "unresolved", reason: "frankfurter_request_failed" };
    await sleep(delay);
  }

  if (!response) return { kind: "unresolved", reason: "frankfurter_request_failed" };
  if (!response.ok) {
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      return {
        kind: "unavailable",
        reason: "no_eligible_historical_rate",
        observations: [],
        requestedFrom,
        requestedThrough: requestedOn,
        fetchedAt: new Date(now()).toISOString(),
      };
    }
    return { kind: "unresolved", reason: "frankfurter_request_failed" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { kind: "unresolved", reason: "invalid_frankfurter_response" };
  }
  const parsed = parseRateRows(body, baseCurrency);
  if (parsed === null) return { kind: "unresolved", reason: "invalid_frankfurter_response" };

  const observations = parsed
    .filter((observation) => observation.effectiveOn >= requestedFrom && observation.effectiveOn <= requestedOn)
    .sort((left, right) => left.effectiveOn.localeCompare(right.effectiveOn));
  const selected = observations.at(-1);
  const fetchedAt = new Date(now()).toISOString();
  return selected
    ? { kind: "found", selected, observations, requestedFrom, requestedThrough: requestedOn, fetchedAt }
    : {
      kind: "unavailable",
      reason: "no_eligible_historical_rate",
      observations,
      requestedFrom,
      requestedThrough: requestedOn,
      fetchedAt,
    };
}
