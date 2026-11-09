import { currencyFractionDigits } from "./money.ts";

import { ACCOUNT_KINDS, type AccountKind } from "./account-kinds.ts";
export { ACCOUNT_KINDS };
export type { AccountKind };
export type AccountField = "name" | "accountKind" | "currencyCode" | "openingBalance" | "openingAsOf" | "includeInAssets";
export type AccountFieldErrors = Partial<Record<AccountField, string>>;
export type AccountFormState = { message?: string; errors?: AccountFieldErrors };

export type NewAccountInput = {
  name: string;
  accountKind: AccountKind;
  currencyCode: string;
  openingBalance: string;
  openingAsOf: string;
  includeInAssets: boolean;
};

type AccountInputFields = {
  name: unknown;
  accountKind: unknown;
  currencyCode: unknown;
  openingBalance: unknown;
  openingAsOf: unknown;
  includeInAssets: unknown;
};

export type AccountValidation =
  | { ok: true; value: NewAccountInput }
  | { ok: false; errors: AccountFieldErrors };

const AMOUNT_PATTERN = /^([+-]?)(?:([0-9]+)(?:\.([0-9]+))?|\.([0-9]+))$/;
const MAX_NUMERIC_INTEGER_DIGITS = 131_072;

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

export function validateOpeningBalance(value: unknown, currencyCode: string): string | null {
  if (typeof value !== "string" || value.length === 0) return "Enter an opening balance.";

  const match = AMOUNT_PATTERN.exec(value);
  if (!match) return "Use a decimal amount without commas, spaces, or exponent notation.";

  const fractionDigits = currencyFractionDigits(currencyCode);
  if (fractionDigits === null) return "Choose a supported ISO currency code.";
  const wholeDigits = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  if (wholeDigits.length > MAX_NUMERIC_INTEGER_DIGITS) return "This amount is too large for the database.";
  if (fraction.length > fractionDigits) {
    return fractionDigits === 0
      ? `${currencyCode} amounts must be whole numbers.`
      : `${currencyCode} allows at most ${fractionDigits} decimal places.`;
  }

  return null;
}

export function validateAccountInput(fields: AccountInputFields): AccountValidation {
  const errors: AccountFieldErrors = {};
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (!name) errors.name = "Enter an account name.";

  const accountKind = typeof fields.accountKind === "string" ? fields.accountKind : "";
  if (!ACCOUNT_KINDS.includes(accountKind as AccountKind)) errors.accountKind = "Choose bank, cash, or investment.";

  const currencyCode = typeof fields.currencyCode === "string" ? fields.currencyCode : "";
  const openingBalance = typeof fields.openingBalance === "string" ? fields.openingBalance : "";
  const balanceError = validateOpeningBalance(openingBalance, currencyCode);
  if (balanceError) errors.openingBalance = balanceError;
  if (currencyFractionDigits(currencyCode) === null) errors.currencyCode = "Choose a supported ISO currency code.";

  const openingAsOf = typeof fields.openingAsOf === "string" ? fields.openingAsOf : "";
  if (!isValidDateOnly(openingAsOf)) errors.openingAsOf = "Enter a real calendar date in YYYY-MM-DD format.";

  if (typeof fields.includeInAssets !== "boolean") errors.includeInAssets = "Choose whether to include this account in tracked assets.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      accountKind: accountKind as AccountKind,
      currencyCode,
      openingBalance,
      openingAsOf,
      includeInAssets: fields.includeInAssets as boolean,
    },
  };
}

export function validateAccountUpdate(nameValue: unknown, includeInAssetsValue: unknown):
  | { ok: true; value: { name: string; includeInAssets: boolean } }
  | { ok: false; errors: Pick<AccountFieldErrors, "name" | "includeInAssets"> } {
  const errors: Pick<AccountFieldErrors, "name" | "includeInAssets"> = {};
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  if (!name) errors.name = "Enter an account name.";
  if (typeof includeInAssetsValue !== "boolean") {
    errors.includeInAssets = "Choose whether to include this account in tracked assets.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, includeInAssets: includeInAssetsValue as boolean } };
}

export function dateInTokyo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
