const ZERO_FRACTION_CURRENCIES: Record<string, true> = {
  BIF: true, CLP: true, DJF: true, GNF: true, ISK: true, JPY: true, KMF: true, KRW: true, PYG: true,
  RWF: true, UGX: true, UYI: true, VND: true, VUV: true, XAF: true, XOF: true, XPF: true,
};
const THREE_FRACTION_CURRENCIES: Record<string, true> = {
  BHD: true, IQD: true, JOD: true, KWD: true, LYD: true, OMR: true, TND: true,
};
const FOUR_FRACTION_CURRENCIES: Record<string, true> = { CLF: true, UYW: true };
const PRIMARY_CURRENCY_CODES: Record<string, true> = { JPY: true, VND: true, USD: true };
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export type CurrencyOption = { code: string; fractionDigits: number };

function databaseFractionDigits(code: string): number {
  if (Object.hasOwn(ZERO_FRACTION_CURRENCIES, code)) return 0;
  if (Object.hasOwn(THREE_FRACTION_CURRENCIES, code)) return 3;
  if (Object.hasOwn(FOUR_FRACTION_CURRENCIES, code)) return 4;
  return 2;
}

const SUPPORTED_CURRENCY_SCALES = new Map<string, number>();
for (const code of ISO_CURRENCIES) {
  const fractionDigits = databaseFractionDigits(code);
  const intlScale = new Intl.NumberFormat("en-US", { style: "currency", currency: code })
    .resolvedOptions().maximumFractionDigits;
  if (intlScale === fractionDigits) SUPPORTED_CURRENCY_SCALES.set(code, fractionDigits);
}

const CURRENCY_OPTIONS: readonly CurrencyOption[] = [
  ...Object.keys(PRIMARY_CURRENCY_CODES).flatMap((code) => {
    const fractionDigits = SUPPORTED_CURRENCY_SCALES.get(code);
    return fractionDigits === undefined ? [] : [{ code, fractionDigits }];
  }),
  ...[...SUPPORTED_CURRENCY_SCALES]
    .filter(([code]) => !Object.hasOwn(PRIMARY_CURRENCY_CODES, code))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, fractionDigits]) => ({ code, fractionDigits })),
];

export function currencyFractionDigits(code: string): number | null {
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return SUPPORTED_CURRENCY_SCALES.get(code) ?? null;
}

export function supportedCurrencies(): readonly CurrencyOption[] {
  return CURRENCY_OPTIONS;
}

const AMOUNT_PATTERN = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const CURRENCY_PATTERNS = new Map<string, { prefix: string; suffix: string; decimalSeparator: string }>();
const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  useGrouping: true,
  maximumFractionDigits: 0,
});

function currencyPattern(currencyCode: string, fractionDigits: number) {
  const cached = CURRENCY_PATTERNS.get(currencyCode);
  if (cached) return cached;

  const parts = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).formatToParts(BigInt(0));
  const firstInteger = parts.findIndex((part) => part.type === "integer");
  const lastNumber = parts.findLastIndex((part) => part.type === "integer" || part.type === "fraction");
  const pattern = {
    prefix: parts.slice(0, firstInteger).map((part) => part.value).join(""),
    suffix: parts.slice(lastNumber + 1).map((part) => part.value).join(""),
    decimalSeparator: parts.find((part) => part.type === "decimal")?.value ?? "",
  };
  CURRENCY_PATTERNS.set(currencyCode, pattern);
  return pattern;
}

export function formatMoney(amount: string, currencyCode: string): string {
  const fractionDigits = currencyFractionDigits(currencyCode);
  const match = AMOUNT_PATTERN.exec(amount);
  if (fractionDigits === null || !match) throw new Error("Cannot format an invalid account amount.");

  const [, sign, whole, fraction = ""] = match;
  let displayFraction = fraction;
  if (displayFraction.length > fractionDigits) {
    const extraDigits = displayFraction.slice(fractionDigits);
    if (/[1-9]/.test(extraDigits)) throw new Error("Account amount exceeds its currency precision.");
    displayFraction = displayFraction.slice(0, fractionDigits);
  }
  displayFraction = displayFraction.padEnd(fractionDigits, "0");

  const isNegative = sign === "-" && /[1-9]/.test(`${whole}${fraction}`);
  const pattern = currencyPattern(currencyCode, fractionDigits);
  const groupedWhole = INTEGER_FORMATTER.format(BigInt(whole));
  return `${isNegative ? "−" : ""}${pattern.prefix}${groupedWhole}${fractionDigits > 0 ? `${pattern.decimalSeparator}${displayFraction}` : ""}${pattern.suffix}`;
}
