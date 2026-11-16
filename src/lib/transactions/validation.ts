import { currencyFractionDigits } from "../accounts/money.ts";

export type TransactionKind = "income" | "expense";
export type TransactionEventKind = TransactionKind | "card_settlement" | "transfer" | "balance_adjustment";
export type TransactionStatus = "posted" | "voided";
export type PaymentMethodKind = "cash" | "debit_card" | "credit_card" | "bank_transfer" | "other";
export type TransactionField = "transactionKind" | "amount" | "currencyCode" | "occurredOn" | "categoryId" | "paymentMethodId" | "merchant" | "note";
export type TransactionFormState = { message?: string; errors?: Partial<Record<TransactionField, string>> };
export type CategoryFormState = { message?: string; errors?: Partial<Record<"kind" | "name" | "parentId", string>> };
export type PaymentMethodFormState = { message?: string; errors?: Partial<Record<"name" | "methodKind" | "linkedAccountId", string>> };
export type CardSettlementField = "amount" | "currencyCode" | "occurredOn" | "paymentMethodId" | "accountId" | "note";
export type CardSettlementFormState = { message?: string; errors?: Partial<Record<CardSettlementField, string>> };
export type AccountTransferField = "sourceAccountId" | "destinationAccountId" | "sentAmount" | "receivedAmount" | "occurredOn" | "note";
export type BalanceAdjustmentField = "accountId" | "amount" | "occurredOn" | "reason";
export type AccountMovementField = AccountTransferField | BalanceAdjustmentField;
export type AccountMovementFormState = { message?: string; errors?: Partial<Record<AccountMovementField, string>> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const MAX_NUMERIC_INTEGER_DIGITS = 131_072;
const PAYMENT_METHOD_KINDS: readonly PaymentMethodKind[] = ["cash", "debit_card", "credit_card", "bank_transfer", "other"];

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

function hasNonzeroDigit(value: string): boolean {
  return /[1-9]/.test(value);
}

export type TransactionInput = {
  transactionKind: TransactionKind;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  categoryId: string;
  paymentMethodId: string | null;
  merchant: string | null;
  note: string | null;
  idempotencyKey: string;
};

export type CardSettlementInput = {
  amount: string;
  currencyCode: string;
  occurredOn: string;
  paymentMethodId: string;
  accountId: string;
  note: string | null;
  idempotencyKey: string;
};
export type AccountTransferInput = {
  sourceAccountId: string;
  destinationAccountId: string;
  sentAmount: string;
  receivedAmount: string;
  occurredOn: string;
  note: string | null;
  idempotencyKey: string;
};

export type BalanceAdjustmentInput = {
  accountId: string;
  amount: string;
  occurredOn: string;
  reason: string;
  idempotencyKey: string;
};

export type AccountMovementValidation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Partial<Record<AccountMovementField, string>>; message?: string };

export type CardSettlementValidation =
  | { ok: true; value: CardSettlementInput }
  | { ok: false; errors: Partial<Record<CardSettlementField, string>> };

export type TransactionValidation =
  | { ok: true; value: TransactionInput }
  | { ok: false; errors: Partial<Record<TransactionField, string>> };

export function validateTransactionInput(fields: Record<string, unknown>): TransactionValidation {
  const errors: Partial<Record<TransactionField, string>> = {};
  const transactionKind = fields.transactionKind;
  if (transactionKind !== "income" && transactionKind !== "expense") {
    errors.transactionKind = "Choose income or expense.";
  }

  const amount = typeof fields.amount === "string" ? fields.amount : "";
  const amountMatch = AMOUNT_PATTERN.exec(amount);
  const currencyCode = typeof fields.currencyCode === "string" ? fields.currencyCode : "";
  const fractionDigits = currencyFractionDigits(currencyCode);
  if (!amountMatch || !hasNonzeroDigit(amount)) {
    errors.amount = "Enter a positive decimal amount without commas or exponent notation.";
  } else {
    const whole = amount.split(".", 1)[0] ?? "0";
    const fraction = amountMatch[2] ?? "";
    if (whole.length > MAX_NUMERIC_INTEGER_DIGITS) {
      errors.amount = "This amount is too large for the database.";
    } else if (fractionDigits === null) {
      errors.currencyCode = "Choose a supported ISO currency.";
    } else if (fraction.length > fractionDigits) {
      errors.amount = fractionDigits === 0
        ? `${currencyCode} amounts must be whole numbers.`
        : `${currencyCode} allows at most ${fractionDigits} decimal places.`;
    }
  }
  if (fractionDigits === null) errors.currencyCode = "Choose a supported ISO currency.";

  const occurredOn = typeof fields.occurredOn === "string" ? fields.occurredOn : "";
  if (!isValidDateOnly(occurredOn)) errors.occurredOn = "Enter a real transaction date.";

  const categoryId = typeof fields.categoryId === "string" ? fields.categoryId : "";
  if (!UUID_PATTERN.test(categoryId)) errors.categoryId = "Choose an active category.";

  const rawPaymentMethodId = fields.paymentMethodId;
  const paymentMethodId = rawPaymentMethodId === "" || rawPaymentMethodId === null
    ? null
    : typeof rawPaymentMethodId === "string" ? rawPaymentMethodId : "invalid";
  if (paymentMethodId !== null && !UUID_PATTERN.test(paymentMethodId)) {
    errors.paymentMethodId = "Choose an active payment method or mark this transaction unassigned.";
  }

  const idempotencyKey = typeof fields.idempotencyKey === "string" ? fields.idempotencyKey : "";
  if (!UUID_PATTERN.test(idempotencyKey)) errors.amount = "Refresh the page before submitting this transaction.";

  const merchant = typeof fields.merchant === "string" ? fields.merchant.trim() || null : null;
  const note = typeof fields.note === "string" ? fields.note.trim() || null : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      transactionKind: transactionKind as TransactionKind,
      amount,
      currencyCode,
      occurredOn,
      categoryId,
      paymentMethodId,
      merchant,
      note,
      idempotencyKey,
    },
  };
}

export function validateCardSettlementInput(fields: Record<string, unknown>): CardSettlementValidation {
  const errors: Partial<Record<CardSettlementField, string>> = {};
  const amount = typeof fields.amount === "string" ? fields.amount : "";
  const amountMatch = AMOUNT_PATTERN.exec(amount);
  const currencyCode = typeof fields.currencyCode === "string" ? fields.currencyCode : "";
  const fractionDigits = currencyFractionDigits(currencyCode);

  if (!amountMatch || !hasNonzeroDigit(amount)) {
    errors.amount = "Enter a positive decimal amount without commas or exponent notation.";
  } else {
    const whole = amount.split(".", 1)[0] ?? "0";
    const fraction = amountMatch[2] ?? "";
    if (whole.length > MAX_NUMERIC_INTEGER_DIGITS) {
      errors.amount = "This amount is too large for the database.";
    } else if (fractionDigits === null) {
      errors.currencyCode = "Choose a supported ISO currency.";
    } else if (fraction.length > fractionDigits) {
      errors.amount = fractionDigits === 0
        ? `${currencyCode} amounts must be whole numbers.`
        : `${currencyCode} allows at most ${fractionDigits} decimal places.`;
    }
  }
  if (fractionDigits === null) errors.currencyCode = "Choose a supported ISO currency.";

  const occurredOn = typeof fields.occurredOn === "string" ? fields.occurredOn : "";
  if (!isValidDateOnly(occurredOn)) errors.occurredOn = "Enter a real payment date.";

  const paymentMethodId = typeof fields.paymentMethodId === "string" ? fields.paymentMethodId : "";
  if (!UUID_PATTERN.test(paymentMethodId)) errors.paymentMethodId = "Choose an active credit card.";

  const accountId = typeof fields.accountId === "string" ? fields.accountId : "";
  if (!UUID_PATTERN.test(accountId)) errors.accountId = "Choose an active bank or cash account.";

  const idempotencyKey = typeof fields.idempotencyKey === "string" ? fields.idempotencyKey : "";
  if (!UUID_PATTERN.test(idempotencyKey)) errors.amount = "Refresh the page before submitting this settlement.";

  const rawNote = fields.note;
  const note = typeof rawNote === "string" ? rawNote.trim() || null : null;
  if (typeof rawNote === "string" && rawNote.length > 4000) errors.note = "Keep the note to 4,000 characters or fewer.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { amount, currencyCode, occurredOn, paymentMethodId, accountId, note, idempotencyKey },
  };
}
function movementAmountError(value: string, signed: boolean): string | null {
  const pattern = signed ? /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/ : AMOUNT_PATTERN;
  const match = pattern.exec(value);
  if (!match || !hasNonzeroDigit(value)) return signed
    ? "Enter a non-zero signed decimal amount without commas or exponent notation."
    : "Enter a positive decimal amount without commas or exponent notation.";
  const whole = value.replace(/^-/, "").split(".", 1)[0] ?? "0";
  if (whole.length > MAX_NUMERIC_INTEGER_DIGITS) return "This amount is too large for the database.";
  return null;
}

export function validateAccountTransferInput(fields: Record<string, unknown>): AccountMovementValidation<AccountTransferInput> {
  const errors: Partial<Record<AccountTransferField, string>> = {};
  const sourceAccountId = typeof fields.sourceAccountId === "string" ? fields.sourceAccountId : "";
  const destinationAccountId = typeof fields.destinationAccountId === "string" ? fields.destinationAccountId : "";
  if (!UUID_PATTERN.test(sourceAccountId)) errors.sourceAccountId = "Choose an active source account.";
  if (!UUID_PATTERN.test(destinationAccountId)) errors.destinationAccountId = "Choose an active destination account.";
  else if (destinationAccountId === sourceAccountId) errors.destinationAccountId = "Choose a different destination account.";

  const sentAmount = typeof fields.sentAmount === "string" ? fields.sentAmount : "";
  const sentAmountError = movementAmountError(sentAmount, false);
  if (sentAmountError) errors.sentAmount = sentAmountError;
  const receivedAmount = typeof fields.receivedAmount === "string" ? fields.receivedAmount : "";
  const receivedAmountError = movementAmountError(receivedAmount, false);
  if (receivedAmountError) errors.receivedAmount = receivedAmountError;

  const occurredOn = typeof fields.occurredOn === "string" ? fields.occurredOn : "";
  if (!isValidDateOnly(occurredOn)) errors.occurredOn = "Enter a real economic date.";
  const rawNote = fields.note;
  const note = typeof rawNote === "string" ? rawNote.trim() || null : null;
  if (typeof rawNote === "string" && rawNote.length > 4000) errors.note = "Keep the note to 4,000 characters or fewer.";
  const idempotencyKey = typeof fields.idempotencyKey === "string" ? fields.idempotencyKey : "";
  const message = UUID_PATTERN.test(idempotencyKey) ? undefined : "Refresh the page before submitting this transfer.";

  if (Object.keys(errors).length > 0 || message) return { ok: false, errors, message };
  return {
    ok: true,
    value: { sourceAccountId, destinationAccountId, sentAmount, receivedAmount, occurredOn, note, idempotencyKey },
  };
}

export function validateBalanceAdjustmentInput(fields: Record<string, unknown>): AccountMovementValidation<BalanceAdjustmentInput> {
  const errors: Partial<Record<BalanceAdjustmentField, string>> = {};
  const accountId = typeof fields.accountId === "string" ? fields.accountId : "";
  if (!UUID_PATTERN.test(accountId)) errors.accountId = "Choose an active account.";

  const amount = typeof fields.amount === "string" ? fields.amount : "";
  const amountError = movementAmountError(amount, true);
  if (amountError) errors.amount = amountError;

  const occurredOn = typeof fields.occurredOn === "string" ? fields.occurredOn : "";
  if (!isValidDateOnly(occurredOn)) errors.occurredOn = "Enter a real economic date.";
  const rawReason = fields.reason;
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!reason) errors.reason = "Explain why this balance is being adjusted.";
  else if (reason.length > 500) errors.reason = "Keep the explanation to 500 characters or fewer.";

  const idempotencyKey = typeof fields.idempotencyKey === "string" ? fields.idempotencyKey : "";
  const message = UUID_PATTERN.test(idempotencyKey) ? undefined : "Refresh the page before submitting this adjustment.";
  if (Object.keys(errors).length > 0 || message) return { ok: false, errors, message };
  return { ok: true, value: { accountId, amount, occurredOn, reason, idempotencyKey } };
}


export function validateTransactionId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function validateVoidReason(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return "Enter a reason before voiding this transaction.";
  return null;
}

export function validateCategoryInput(fields: { kind: unknown; name: unknown; parentId: unknown }):
  | { ok: true; value: { kind: TransactionKind; name: string; parentId: string | null } }
  | { ok: false; errors: Partial<Record<"kind" | "name" | "parentId", string>> } {
  const errors: Partial<Record<"kind" | "name" | "parentId", string>> = {};
  const kind = fields.kind;
  if (kind !== "income" && kind !== "expense") errors.kind = "Choose income or expense.";
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (!name) errors.name = "Enter a category name.";
  const parentValue = fields.parentId;
  const parentId = parentValue === "" || parentValue === null ? null : typeof parentValue === "string" ? parentValue : "invalid";
  if (parentId !== null && !UUID_PATTERN.test(parentId)) errors.parentId = "Choose a category of the same kind.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { kind: kind as TransactionKind, name, parentId } };
}

export function validatePaymentMethodInput(fields: { name: unknown; methodKind: unknown; linkedAccountId: unknown }):
  | { ok: true; value: { name: string; methodKind: PaymentMethodKind; linkedAccountId: string | null } }
  | { ok: false; errors: Partial<Record<"name" | "methodKind" | "linkedAccountId", string>> } {
  const errors: Partial<Record<"name" | "methodKind" | "linkedAccountId", string>> = {};
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (!name) errors.name = "Enter a payment method name.";
  const methodKind = fields.methodKind;
  if (typeof methodKind !== "string" || !PAYMENT_METHOD_KINDS.includes(methodKind as PaymentMethodKind)) {
    errors.methodKind = "Choose a supported payment method.";
  }
  const rawAccountId = fields.linkedAccountId;
  const linkedAccountId = rawAccountId === "" || rawAccountId === null
    ? null
    : typeof rawAccountId === "string" ? rawAccountId : "invalid";
  if (linkedAccountId !== null && !UUID_PATTERN.test(linkedAccountId)) {
    errors.linkedAccountId = "Choose an active bank or cash account.";
  }
  if (methodKind === "credit_card" && linkedAccountId !== null) {
    errors.linkedAccountId = "Credit cards are payment methods, not tracked accounts.";
  } else if (methodKind !== "credit_card" && linkedAccountId === null) {
    errors.linkedAccountId = "Link this method to an active bank or cash account.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, methodKind: methodKind as PaymentMethodKind, linkedAccountId } };
}

export function isValidTransactionDate(value: string): boolean {
  return isValidDateOnly(value);
}
