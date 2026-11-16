import assert from "node:assert/strict";
import test from "node:test";
import { formatSignedAmount, formatTransactionAmount, formatTransactionDate, dateInTimezone } from "../src/lib/transactions/presentation.ts";
import {
  validateAccountTransferInput,
  validateBalanceAdjustmentInput,
  validateCategoryInput,
  validateCardSettlementInput,
  validatePaymentMethodInput,
  validateTransactionInput,
  validateVoidReason,
} from "../src/lib/transactions/validation.ts";

const id = "a1111111-1111-4111-8111-111111111111";
const key = "b2222222-2222-4222-8222-222222222222";

function validTransaction(overrides = {}) {
  return {
    transactionKind: "expense",
    amount: "1200",
    currencyCode: "JPY",
    occurredOn: "2026-11-10",
    categoryId: id,
    paymentMethodId: null,
    merchant: "Cafe",
    note: null,
    idempotencyKey: key,
    ...overrides,
  };
}

function validSettlement(overrides = {}) {
  return {
    amount: "10000",
    currencyCode: "JPY",
    occurredOn: "2026-11-01",
    paymentMethodId: id,
    accountId: "c3333333-3333-4333-8333-333333333333",
    note: "  October card bill  ",
    idempotencyKey: key,
    ...overrides,
  };
}

function validTransfer(overrides = {}) {
  return {
    sourceAccountId: id,
    destinationAccountId: "c3333333-3333-4333-8333-333333333333",
    sentAmount: "30000",
    receivedAmount: "30000",
    occurredOn: "2026-11-10",
    note: "  Move to savings  ",
    idempotencyKey: key,
    ...overrides,
  };
}

function validAdjustment(overrides = {}) {
  return {
    accountId: id,
    amount: "-500",
    occurredOn: "2026-11-10",
    reason: "  Reconciled statement  ",
    idempotencyKey: key,
    ...overrides,
  };
}

test("income and expense preserve exact native decimal strings and positive form amounts", () => {
  for (const [currencyCode, amount] of [["JPY", "1200"], ["VND", "9007199254740993"], ["USD", "9007199254740993.45"]]) {
    const result = validateTransactionInput(validTransaction({ amount, currencyCode }));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.amount, amount);
  }
  assert.equal(validateTransactionInput(validTransaction({ transactionKind: "income", amount: "250.75", currencyCode: "USD" })).ok, true);
});

test("JPY/VND whole-unit and USD cent precision are enforced", () => {
  const jpy = validateTransactionInput(validTransaction({ amount: "1200.01" }));
  assert.equal(jpy.ok, false);
  if (!jpy.ok) assert.match(jpy.errors.amount ?? "", /whole numbers/);
  const vnd = validateTransactionInput(validTransaction({ currencyCode: "VND", amount: "1.5" }));
  assert.equal(vnd.ok, false);
  if (!vnd.ok) assert.match(vnd.errors.amount ?? "", /whole numbers/);
  const usd = validateTransactionInput(validTransaction({ currencyCode: "USD", amount: "1.001" }));
  assert.equal(usd.ok, false);
  if (!usd.ok) assert.match(usd.errors.amount ?? "", /at most 2 decimal places/);
});

test("card settlement validation preserves exact amounts and rejects invalid date, currency, and references", () => {
  const valid = validateCardSettlementInput(validSettlement());
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.amount, "10000");
    assert.equal(valid.value.note, "October card bill");
  }

  const exactUsd = validateCardSettlementInput(validSettlement({ currencyCode: "USD", amount: "9007199254740993.45" }));
  assert.equal(exactUsd.ok, true);
  if (exactUsd.ok) assert.equal(exactUsd.value.amount, "9007199254740993.45");

  for (const amount of ["", "0", "0.00", "1e3", "1,000", "01", "-1", "1.001"]) {
    assert.equal(validateCardSettlementInput(validSettlement({ amount, currencyCode: "USD" })).ok, false, amount);
  }
  assert.equal(validateCardSettlementInput(validSettlement({ currencyCode: "JPY", amount: "1.5" })).ok, false);
  assert.equal(validateCardSettlementInput(validSettlement({ occurredOn: "2026-02-30" })).ok, false);
  assert.equal(validateCardSettlementInput(validSettlement({ paymentMethodId: "not-a-uuid" })).ok, false);
  assert.equal(validateCardSettlementInput(validSettlement({ accountId: "not-a-uuid" })).ok, false);
  assert.equal(validateCardSettlementInput(validSettlement({ currencyCode: "ZZZ" })).ok, false);
});

test("transaction form rejects non-decimal, zero, malformed date, and invalid identifiers", () => {
  for (const amount of ["", "0", "0.00", "1e3", "1,200", "01", ".5", "1.", "-1", "+1"]) {
    assert.equal(validateTransactionInput(validTransaction({ amount })).ok, false, amount);
  }
  for (const occurredOn of ["2026-02-30", "2026-2-01", "2026-01-01T12:00:00Z"]) {
    assert.equal(validateTransactionInput(validTransaction({ occurredOn })).ok, false, occurredOn);
  }
  assert.equal(validateTransactionInput(validTransaction({ categoryId: "not-a-uuid" })).ok, false);
  assert.equal(validateTransactionInput(validTransaction({ idempotencyKey: "not-a-uuid" })).ok, false);
  assert.equal(validateTransactionInput(validTransaction({ currencyCode: "ZZZ" })).ok, false);
});

test("credit cards have no account link; funded methods require an account", () => {
  assert.deepEqual(validatePaymentMethodInput({ name: "Visa", methodKind: "credit_card", linkedAccountId: "" }), {
    ok: true,
    value: { name: "Visa", methodKind: "credit_card", linkedAccountId: null },
  });
  assert.equal(validatePaymentMethodInput({ name: "Debit", methodKind: "debit_card", linkedAccountId: "" }).ok, false);
  assert.equal(validatePaymentMethodInput({ name: "Card", methodKind: "credit_card", linkedAccountId: id }).ok, false);
});

test("categories keep their optional parent id and reject malformed parent ids", () => {
  assert.deepEqual(validateCategoryInput({ kind: "expense", name: "  Travel  ", parentId: id }), {
    ok: true,
    value: { kind: "expense", name: "Travel", parentId: id },
  });
  assert.equal(validateCategoryInput({ kind: "expense", name: "Food", parentId: "bad" }).ok, false);
  assert.equal(validateCategoryInput({ kind: "transfer", name: "Transfer", parentId: "" }).ok, false);
});

test("transaction presentation formats exact values with economic sign and date-only semantics", () => {
  assert.equal(formatTransactionAmount("1200", "JPY", "expense"), "−¥1,200");
  assert.equal(formatTransactionAmount("1.23", "USD", "income"), "+$1.23");
  assert.equal(formatTransactionAmount("10000", "JPY", "card_settlement"), "−¥10,000");
  assert.equal(formatTransactionDate("2026-11-10"), "Nov 10, 2026");
  assert.equal(dateInTimezone(new Date("2026-11-10T00:30:00.000Z"), "Asia/Tokyo"), "2026-11-10");
  assert.equal(dateInTimezone(new Date("2026-11-10T00:30:00.000Z"), "America/Los_Angeles"), "2026-11-09");
});

test("voiding requires a nonblank audit reason", () => {
  assert.match(validateVoidReason("  ") ?? "", /reason/);
  assert.equal(validateVoidReason("Duplicate entry"), null);
});

test("own-account transfer validation retains both actual decimal amounts", () => {
  const valid = validateAccountTransferInput(validTransfer({
    sentAmount: "9007199254740993.45",
    receivedAmount: "123456789012345678.90",
  }));
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.sentAmount, "9007199254740993.45");
    assert.equal(valid.value.receivedAmount, "123456789012345678.90");
    assert.equal(valid.value.note, "Move to savings");
  }

  assert.equal(validateAccountTransferInput(validTransfer({ destinationAccountId: id })).ok, false);
  for (const amount of ["", "0", "0.00", "1e3", "1,000", "01", "-1", "+1"]) {
    assert.equal(validateAccountTransferInput(validTransfer({ sentAmount: amount })).ok, false, amount);
  }
  assert.equal(validateAccountTransferInput(validTransfer({ occurredOn: "2026-02-30" })).ok, false);
  assert.equal(validateAccountTransferInput(validTransfer({ sourceAccountId: "not-an-id" })).ok, false);
  assert.equal(validateAccountTransferInput(validTransfer({ idempotencyKey: "not-an-id" })).ok, false);
});

test("balance adjustments preserve signed values and require a concise explanation", () => {
  const negative = validateBalanceAdjustmentInput(validAdjustment());
  assert.equal(negative.ok, true);
  if (negative.ok) {
    assert.equal(negative.value.amount, "-500");
    assert.equal(negative.value.reason, "Reconciled statement");
  }
  assert.equal(validateBalanceAdjustmentInput(validAdjustment({ amount: "500" })).ok, true);
  for (const amount of ["", "0", "0.00", "-0", "-0.00", "1e3", "1,000", "+1"]) {
    assert.equal(validateBalanceAdjustmentInput(validAdjustment({ amount })).ok, false, amount);
  }
  assert.equal(validateBalanceAdjustmentInput(validAdjustment({ reason: "   " })).ok, false);
  assert.equal(validateBalanceAdjustmentInput(validAdjustment({ reason: "x".repeat(501) })).ok, false);
  assert.equal(validateBalanceAdjustmentInput(validAdjustment({ occurredOn: "2026-02-30" })).ok, false);
  assert.equal(validateBalanceAdjustmentInput(validAdjustment({ accountId: "not-an-id" })).ok, false);
});

test("signed adjustment and transfer legs present without numeric conversion", () => {
  assert.equal(formatTransactionAmount("500", "JPY", "balance_adjustment"), "+¥500");
  assert.equal(formatTransactionAmount("-500", "JPY", "balance_adjustment"), "−¥500");
  assert.equal(formatSignedAmount("9007199254740993.45", "USD"), "+$9,007,199,254,740,993.45");
  assert.equal(formatSignedAmount("-30000", "JPY"), "−¥30,000");
});
