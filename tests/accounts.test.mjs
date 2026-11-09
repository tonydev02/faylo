import assert from "node:assert/strict";
import test from "node:test";
import { formatEffectiveBalance } from "../src/lib/accounts/presentation.ts";
import { formatMoney, supportedCurrencies } from "../src/lib/accounts/money.ts";
import {
  validateAccountInput,
  validateAccountUpdate,
  validateOpeningBalance,
} from "../src/lib/accounts/validation.ts";

function validAccount(overrides = {}) {
  return {
    name: "Daily checking",
    accountKind: "bank",
    currencyCode: "JPY",
    openingBalance: "12000",
    openingAsOf: "2026-11-09",
    includeInAssets: true,
    ...overrides,
  };
}

test("supported currencies include JPY, VND, and USD with the database scale", () => {
  const currencies = new Map(supportedCurrencies().map(({ code, fractionDigits }) => [code, fractionDigits]));
  assert.equal(currencies.get("JPY"), 0);
  assert.equal(currencies.get("VND"), 0);
  assert.equal(currencies.get("USD"), 2);
});

test("account input preserves exact native decimal strings and date-only snapshots", () => {
  for (const currencyCode of ["JPY", "VND", "USD"]) {
    const openingBalance = currencyCode === "USD" ? "9007199254740993.45" : "9007199254740993";
    const result = validateAccountInput(validAccount({ currencyCode, openingBalance }));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.openingBalance, openingBalance);
      assert.equal(result.value.openingAsOf, "2026-11-09");
    }
  }
});

test("currency precision rejects fractional JPY/VND and more than two USD decimals", () => {
  assert.match(validateOpeningBalance("1.01", "JPY") ?? "", /whole numbers/);
  assert.match(validateOpeningBalance("1.5", "VND") ?? "", /whole numbers/);
  assert.match(validateOpeningBalance("1.001", "USD") ?? "", /at most 2 decimal places/);
  assert.equal(validateOpeningBalance("1.00", "USD"), null);
});

test("blank, malformed, exponent, and invalid-currency amounts are rejected", () => {
  for (const amount of ["", " ", "NaN", "1e3", "12,000", "+", "-", ".", "1.", "12.3.4", "1.0 "]) {
    assert.notEqual(validateOpeningBalance(amount, "USD"), null, amount);
  }
  for (const amount of ["0001", ".50", "+1", "-1.25"]) {
    assert.equal(validateOpeningBalance(amount, "USD"), null, amount);
  }
  assert.notEqual(validateOpeningBalance("100", "ZZZ"), null);
  assert.equal(validateAccountInput(validAccount({ currencyCode: "ZZZ" })).ok, false);
});

test("very large exact amounts remain valid up to PostgreSQL numeric limits", () => {
  const large = `1${"0".repeat(130_000)}.99`;
  assert.equal(validateOpeningBalance(large, "USD"), null);
  assert.match(validateOpeningBalance(`${"9".repeat(131_073)}`, "JPY") ?? "", /too large/);
  assert.equal(formatMoney("9007199254740993.45", "USD"), "$9,007,199,254,740,993.45");
  assert.equal(formatMoney("9007199254740993", "JPY"), "¥9,007,199,254,740,993");
  assert.equal(formatMoney("9007199254740993", "VND"), "₫9,007,199,254,740,993");
  assert.equal(formatMoney("-9007199254740993.45", "USD"), "−$9,007,199,254,740,993.45");
});

test("future opening balances show an unavailable state until effective", () => {
  assert.equal(formatEffectiveBalance(null, "USD"), "Not yet effective");
  assert.equal(formatEffectiveBalance("9007199254740993.45", "USD"), "$9,007,199,254,740,993.45");
});

test("date validation rejects timestamps and impossible calendar dates", () => {
  assert.equal(validateAccountInput(validAccount({ openingAsOf: "2024-02-29" })).ok, true);
  for (const openingAsOf of ["2023-02-29", "2026-02-30", "2026-11-09T12:00:00Z", "0000-01-01", "11/09/2026"]) {
    assert.equal(validateAccountInput(validAccount({ openingAsOf })).ok, false, openingAsOf);
  }
});

test("account validation rejects unsupported types and blank names", () => {
  const result = validateAccountInput(validAccount({ accountKind: "credit_card", name: "   " }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.accountKind ?? "", /bank, cash, or investment/);
    assert.match(result.errors.name ?? "", /account name/);
  }
});

test("account updates accept only a name and tracked-assets preference", () => {
  assert.deepEqual(validateAccountUpdate("  Daily checking  ", false), {
    ok: true,
    value: { name: "Daily checking", includeInAssets: false },
  });
  assert.equal(validateAccountUpdate("", true).ok, false);
  assert.equal(validateAccountUpdate("Account", "false").ok, false);
});
