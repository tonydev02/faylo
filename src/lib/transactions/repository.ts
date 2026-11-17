import "server-only";

import { listAccounts, type TrackedAccount } from "@/lib/accounts/repository";
import { currencyFractionDigits } from "@/lib/accounts/money";
import { createSupabaseServerClient } from "@/lib/auth/server";
import type {
  AccountTransferInput,
  BalanceAdjustmentInput,
  CardSettlementInput,
  PaymentMethodKind,
  TransactionEventKind,
  TransactionKind,
  TransactionStatus,
} from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const SIGNED_DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const TRANSACTION_KINDS: Record<TransactionKind, true> = { income: true, expense: true };
const TRANSACTION_EVENT_KINDS: Record<TransactionEventKind, true> = {
  income: true,
  expense: true,
  card_settlement: true,
  transfer: true,
  balance_adjustment: true,
};
const PAYMENT_METHOD_KINDS: Record<PaymentMethodKind, true> = {
  cash: true,
  debit_card: true,
  credit_card: true,
  bank_transfer: true,
  other: true,
};
const TRANSACTION_SOURCES = { manual: true, telegram: true, import: true } as const;
const FUNDING_STATUSES = { funded: true, credit_card: true, unassigned: true } as const;
const TRANSACTION_STATUSES: Record<TransactionStatus, true> = { posted: true, voided: true };

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "unavailable" | "not-found" | "rejected"; field?: string; message?: string };

export type TransactionCategory = {
  id: string;
  kind: TransactionKind;
  name: string;
  parentId: string | null;
  archivedAt: string | null;
};

export type TransactionPaymentMethod = {
  id: string;
  name: string;
  methodKind: PaymentMethodKind;
  linkedAccountId: string | null;
  archivedAt: string | null;
};

export type TransactionAccountMovement = {
  accountId: string;
  accountName: string;
  amount: string;
  currencyCode: string;
  recordedAt: string;
};

export type TransactionRecord = {
  id: string;
  kind: TransactionEventKind;
  occurredAt: string;
  occurredOn: string;
  amount: string | null;
  currencyCode: string | null;
  categoryId: string | null;
  categoryName: string;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentMethodKind: PaymentMethodKind | null;
  fundingAccountId: string | null;
  fundingAccountName: string | null;
  fundingStatus: "funded" | "credit_card" | "unassigned";
  status: TransactionStatus;
  merchant: string | null;
  note: string | null;
  source: keyof typeof TRANSACTION_SOURCES;
  adjustmentReason: string | null;
  accountMovements: TransactionAccountMovement[];
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  recordedAt: string;
  correctedFromTransactionId: string | null;
  correctedByTransactionId: string | null;
  correctionReason: string | null;
  totalCount: number;
};

export type TransactionFilters = {
  search: string;
  kind: TransactionEventKind | "all";
  status: TransactionStatus | "all";
  occurredFrom: string;
  occurredThrough: string;
};

export type TransactionHistory = {
  rows: TransactionRecord[];
  totalCount: number;
  hasMore: boolean;
  hasPrevious: boolean;
  page: number;
};

export type TransactionTotal = {
  kind: TransactionKind;
  currencyCode: string;
  amount: string;
  transactionCount: number;
};

export type TransactionSetup = {
  accounts: TrackedAccount[];
  categories: TransactionCategory[];
  paymentMethods: TransactionPaymentMethod[];
};

type RawAccountMovement = {
  account_id: string;
  account_name: string;
  amount: string;
  currency_code: string;
  recorded_at: string;
};

type RawTransaction = {
  transaction_id: string;
  transaction_kind: TransactionEventKind;
  occurred_at: string;
  occurred_on: string;
  amount: string | null;
  currency_code: string | null;
  category_id: string | null;
  category_name: string | null;
  payment_method_id: string | null;
  payment_method_name: string | null;
  payment_method_kind: PaymentMethodKind | null;
  funding_account_id: string | null;
  funding_account_name: string | null;
  funding_status: keyof typeof FUNDING_STATUSES;
  status: TransactionStatus;
  merchant: string | null;
  note: string | null;
  source: keyof typeof TRANSACTION_SOURCES;
  adjustment_reason: string | null;
  account_movements: RawAccountMovement[];
  void_reason: string | null;
  voided_at: string | null;
  voided_by: string | null;
  created_at: string;
  corrected_from_transaction_id: string | null;
  corrected_by_transaction_id: string | null;
  correction_reason: string | null;
  total_count: number | string;
};

function isRawAccountMovement(value: unknown): value is RawAccountMovement {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.account_id === "string" && UUID_PATTERN.test(row.account_id)
    && typeof row.account_name === "string"
    && typeof row.amount === "string" && SIGNED_DECIMAL_PATTERN.test(row.amount)
    && typeof row.currency_code === "string" && /^[A-Z]{3}$/.test(row.currency_code)
    && typeof row.recorded_at === "string";
}

function isRawTransaction(value: unknown): value is RawTransaction {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const isNullableString = (item: unknown) => item === null || typeof item === "string";
  const isNullableUuid = (item: unknown) => item === null || (typeof item === "string" && UUID_PATTERN.test(item));
  const eventKindValid = typeof row.transaction_kind === "string" && Object.hasOwn(TRANSACTION_EVENT_KINDS, row.transaction_kind);
  const eventAmountValid = row.transaction_kind === "transfer"
    ? row.amount === null && row.currency_code === null
    : typeof row.amount === "string"
      && (row.transaction_kind === "balance_adjustment" ? SIGNED_DECIMAL_PATTERN.test(row.amount) : DECIMAL_PATTERN.test(row.amount))
      && typeof row.currency_code === "string" && /^[A-Z]{3}$/.test(row.currency_code);
  return typeof row.transaction_id === "string" && UUID_PATTERN.test(row.transaction_id)
    && eventKindValid
    && typeof row.occurred_at === "string"
    && typeof row.occurred_on === "string"
    && eventAmountValid
    && (row.category_id === null || (typeof row.category_id === "string" && UUID_PATTERN.test(row.category_id)))
    && (row.category_name === null || typeof row.category_name === "string")
    && isNullableUuid(row.payment_method_id)
    && isNullableString(row.payment_method_name)
    && (row.payment_method_kind === null || (typeof row.payment_method_kind === "string" && Object.hasOwn(PAYMENT_METHOD_KINDS, row.payment_method_kind)))
    && isNullableUuid(row.funding_account_id)
    && isNullableString(row.funding_account_name)
    && typeof row.funding_status === "string" && Object.hasOwn(FUNDING_STATUSES, row.funding_status)
    && typeof row.status === "string" && Object.hasOwn(TRANSACTION_STATUSES, row.status)
    && isNullableString(row.merchant)
    && isNullableString(row.note)
    && typeof row.source === "string" && Object.hasOwn(TRANSACTION_SOURCES, row.source)
    && isNullableString(row.adjustment_reason)
    && Array.isArray(row.account_movements) && row.account_movements.every(isRawAccountMovement)
    && isNullableString(row.void_reason)
    && isNullableString(row.voided_at)
    && isNullableUuid(row.voided_by)
    && typeof row.created_at === "string"
    && isNullableUuid(row.corrected_from_transaction_id)
    && isNullableUuid(row.corrected_by_transaction_id)
    && isNullableString(row.correction_reason)
    && (typeof row.total_count === "number" || (typeof row.total_count === "string" && /^\d+$/.test(row.total_count)));
}

function mapTransaction(row: RawTransaction): TransactionRecord {
  const fallbackCategory = row.transaction_kind === "card_settlement" ? "Card settlement"
    : row.transaction_kind === "transfer" ? "Transfer"
      : row.transaction_kind === "balance_adjustment" ? "Balance adjustment" : "Uncategorized";
  return {
    id: row.transaction_id,
    kind: row.transaction_kind,
    occurredAt: row.occurred_at,
    occurredOn: row.occurred_on,
    amount: row.amount,
    currencyCode: row.currency_code,
    categoryId: row.category_id,
    categoryName: row.category_name ?? fallbackCategory,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name,
    paymentMethodKind: row.payment_method_kind,
    fundingAccountId: row.funding_account_id,
    fundingAccountName: row.funding_account_name,
    fundingStatus: row.funding_status,
    status: row.status,
    merchant: row.merchant,
    note: row.note,
    source: row.source,
    adjustmentReason: row.adjustment_reason,
    accountMovements: row.account_movements.map((movement) => ({
      accountId: movement.account_id,
      accountName: movement.account_name,
      amount: movement.amount,
      currencyCode: movement.currency_code,
      recordedAt: movement.recorded_at,
    })),
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    recordedAt: row.created_at,
    correctedFromTransactionId: row.corrected_from_transaction_id,
    correctedByTransactionId: row.corrected_by_transaction_id,
    correctionReason: row.correction_reason,
    totalCount: Number(row.total_count),
  };
}


function isRawCategory(value: unknown): value is { id: string; kind: TransactionKind; name: string; parent_id: string | null; archived_at: string | null } {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && UUID_PATTERN.test(row.id)
    && typeof row.kind === "string" && Object.hasOwn(TRANSACTION_KINDS, row.kind)
    && typeof row.name === "string"
    && (row.parent_id === null || (typeof row.parent_id === "string" && UUID_PATTERN.test(row.parent_id)))
    && (row.archived_at === null || typeof row.archived_at === "string");
}

function isRawPaymentMethod(value: unknown): value is { id: string; name: string; method_kind: PaymentMethodKind; linked_account_id: string | null; archived_at: string | null } {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && UUID_PATTERN.test(row.id)
    && typeof row.name === "string"
    && typeof row.method_kind === "string" && Object.hasOwn(PAYMENT_METHOD_KINDS, row.method_kind)
    && (row.linked_account_id === null || (typeof row.linked_account_id === "string" && UUID_PATTERN.test(row.linked_account_id)))
    && (row.archived_at === null || typeof row.archived_at === "string");
}

export async function listTransactionSetup(ownerId: string): Promise<ServiceResult<TransactionSetup>> {
  if (!UUID_PATTERN.test(ownerId)) return { ok: false, kind: "unavailable" };
  try {
    const [accountsResult, supabase] = await Promise.all([listAccounts(ownerId), createSupabaseServerClient()]);
    if (!accountsResult.ok) return { ok: false, kind: "unavailable" };
    const [categoriesResult, methodsResult] = await Promise.all([
      supabase.from("categories").select("id,kind,name,parent_id,archived_at").eq("user_id", ownerId).order("kind").order("name"),
      supabase.from("payment_methods").select("id,name,method_kind,linked_account_id,archived_at").eq("user_id", ownerId).order("name"),
    ]);
    if (categoriesResult.error || !Array.isArray(categoriesResult.data) || !categoriesResult.data.every(isRawCategory)) {
      return { ok: false, kind: "unavailable" };
    }
    if (methodsResult.error || !Array.isArray(methodsResult.data) || !methodsResult.data.every(isRawPaymentMethod)) {
      return { ok: false, kind: "unavailable" };
    }
    return {
      ok: true,
      value: {
        accounts: accountsResult.value,
        categories: categoriesResult.data.map((row) => ({ id: row.id, kind: row.kind, name: row.name, parentId: row.parent_id, archivedAt: row.archived_at })),
        paymentMethods: methodsResult.data.map((row) => ({ id: row.id, name: row.name, methodKind: row.method_kind, linkedAccountId: row.linked_account_id, archivedAt: row.archived_at })),
      },
    };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function listTransactions(
  ownerId: string,
  filters: TransactionFilters,
  page = 1,
  transactionId: string | null = null,
): Promise<ServiceResult<TransactionHistory>> {
  if (!UUID_PATTERN.test(ownerId) || !Number.isSafeInteger(page) || page < 1 || page > 20_000) {
    return { ok: false, kind: "unavailable" };
  }
  if (transactionId !== null && !UUID_PATTERN.test(transactionId)) return { ok: true, value: { rows: [], totalCount: 0, hasMore: false, hasPrevious: false, page } };
  const pageSize = transactionId === null ? 50 : 1;
  const offset = (page - 1) * pageSize;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("list_transactions", {
      p_search: filters.search || null,
      p_kind: filters.kind === "all" ? null : filters.kind,
      p_status: filters.status === "all" ? null : filters.status,
      p_occurred_from: filters.occurredFrom || null,
      p_occurred_through: filters.occurredThrough || null,
      p_transaction_id: transactionId,
      p_limit: pageSize + 1,
      p_offset: offset,
    });
    if (error || !Array.isArray(data) || !data.every(isRawTransaction)) return { ok: false, kind: "unavailable" };
    const totalCount = data[0] ? Number(data[0].total_count) : 0;
    const hasMore = transactionId === null && data.length > pageSize;
    return {
      ok: true,
      value: {
        rows: data.slice(0, pageSize).map(mapTransaction),
        totalCount,
        hasMore,
        hasPrevious: transactionId === null && page > 1,
        page,
      },
    };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function listMonthlyTransactionTotals(ownerId: string): Promise<ServiceResult<TransactionTotal[]>> {
  if (!UUID_PATTERN.test(ownerId)) return { ok: false, kind: "unavailable" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("transaction_totals", {});
    if (error || !Array.isArray(data)) return { ok: false, kind: "unavailable" };
    const totals: TransactionTotal[] = [];
    for (const value of data) {
      if (typeof value !== "object" || value === null) return { ok: false, kind: "unavailable" };
      const row = value as Record<string, unknown>;
      if (typeof row.transaction_kind !== "string" || !Object.hasOwn(TRANSACTION_KINDS, row.transaction_kind)
        || typeof row.currency_code !== "string" || !/^[A-Z]{3}$/.test(row.currency_code)
        || typeof row.total_amount !== "string" || !DECIMAL_PATTERN.test(row.total_amount)
        || (typeof row.transaction_count !== "number" && typeof row.transaction_count !== "string")) {
        return { ok: false, kind: "unavailable" };
      }
      const countText = String(row.transaction_count);
      if (!/^\d+$/.test(countText)) return { ok: false, kind: "unavailable" };
      totals.push({
        kind: row.transaction_kind as TransactionKind,
        currencyCode: row.currency_code,
        amount: row.total_amount,
        transactionCount: Number(countText),
      });
    }
    return { ok: true, value: totals };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

function failureField(error: { message?: string }): { field?: string; message: string } {
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("category")) return { field: "categoryId", message: "Choose an active category that matches this transaction." };
  if (message.includes("currency") || message.includes("fractional scale") || message.includes("amount")) return { field: "amount", message: "Check the amount and currency precision, then try again." };
  if (message.includes("opening balance") || message.includes("predates") || message.includes("local occurrence date")) return { field: "occurredOn", message: "The transaction date is outside the account's tracking period." };
  if (message.includes("payment method") || message.includes("account") || message.includes("credit-card")) return { field: "paymentMethodId", message: "Choose an active payment method linked to a compatible account." };
  if (message.includes("idempotency key")) return { message: "This submission key was already used for different transaction details. Reload the page and try again." };
  return { message: "The transaction could not be saved. Check the category, currency, payment method, and date." };
}

async function transactionEntries(
  ownerId: string,
  transactionKind: TransactionKind,
  amount: string,
  currencyCode: string,
  paymentMethodId: string | null,
): Promise<ServiceResult<{ account_id: string; amount: string; currency_code: string }[]>> {
  if (paymentMethodId === null) return { ok: true, value: [] };
  if (!UUID_PATTERN.test(paymentMethodId)) return { ok: false, kind: "rejected", field: "paymentMethodId" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data: method, error: methodError } = await supabase
      .from("payment_methods")
      .select("id,method_kind,linked_account_id,archived_at")
      .eq("user_id", ownerId)
      .eq("id", paymentMethodId)
      .maybeSingle();
    if (methodError || !method || method.archived_at !== null) return { ok: false, kind: "rejected", field: "paymentMethodId" };
    if (method.method_kind === "credit_card") {
      return transactionKind === "expense"
        ? { ok: true, value: [] }
        : { ok: false, kind: "rejected", field: "paymentMethodId" };
    }
    if (typeof method.linked_account_id !== "string") return { ok: false, kind: "rejected", field: "paymentMethodId" };
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id,account_kind,currency_code,status")
      .eq("user_id", ownerId)
      .eq("id", method.linked_account_id)
      .maybeSingle();
    if (accountError || !account || account.status !== "active") return { ok: false, kind: "rejected", field: "paymentMethodId" };
    if (account.currency_code !== currencyCode) return { ok: false, kind: "rejected", field: "currencyCode", message: `This payment method uses ${account.currency_code}. Choose that currency or another method.` };
    if (transactionKind === "expense" && account.account_kind !== "bank" && account.account_kind !== "cash") {
      return { ok: false, kind: "rejected", field: "paymentMethodId", message: "Expenses can only debit an active bank or cash account." };
    }
    return {
      ok: true,
      value: [{
        account_id: account.id,
        amount: transactionKind === "expense" ? `-${amount}` : amount,
        currency_code: currencyCode,
      }],
    };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function postTransaction(ownerId: string, input: {
  idempotencyKey: string;
  transactionKind: TransactionKind;
  occurredOn: string;
  amount: string;
  currencyCode: string;
  categoryId: string;
  paymentMethodId: string | null;
  merchant: string | null;
  note: string | null;
}): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(input.idempotencyKey)) return { ok: false, kind: "rejected" };
  const entries = await transactionEntries(ownerId, input.transactionKind, input.amount, input.currencyCode, input.paymentMethodId);
  if (!entries.ok) return entries;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("post_transaction", {
      p_idempotency_key: input.idempotencyKey,
      p_transaction_kind: input.transactionKind,
      p_occurred_on: input.occurredOn,
      p_amount: input.amount,
      p_currency_code: input.currencyCode,
      p_category_id: input.categoryId,
      p_payment_method_id: input.paymentMethodId,
      p_entries: entries.value,
      p_source: "manual",
      p_merchant: input.merchant,
      p_note: input.note,
      p_adjustment_reason: null,
      p_occurred_at: null,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) return { ok: false, kind: "rejected", ...failureField(error ?? {}) };
    return { ok: true, value: data };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

function cardSettlementFailure(error: { message?: string }): { field?: string; message: string } {
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("idempotency key")) return { message: "This submission key was already used for different settlement details. Reload the page and try again." };
  if (message.includes("currency")) return { field: "currencyCode", message: "The settlement currency must match the selected account." };
  if (message.includes("amount") || message.includes("fractional scale")) return { field: "amount", message: "Check the settlement amount and currency precision, then try again." };
  if (message.includes("opening balance") || message.includes("predates") || message.includes("local occurrence date")) return { field: "occurredOn", message: "The settlement date is outside the account's tracking period." };
  if (message.includes("payment method") || message.includes("credit-card")) return { field: "paymentMethodId", message: "Choose an active credit card payment method." };
  if (message.includes("account")) return { field: "accountId", message: "Choose an active bank or cash account." };
  return { message: "The card settlement could not be saved. Check the card, account, amount, and date." };
}

export async function postCardSettlement(ownerId: string, input: CardSettlementInput): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId)
    || !UUID_PATTERN.test(input.idempotencyKey)
    || !UUID_PATTERN.test(input.paymentMethodId)
    || !UUID_PATTERN.test(input.accountId)) {
    return { ok: false, kind: "rejected" };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const [methodResult, accountResult] = await Promise.all([
      supabase.from("payment_methods")
        .select("id,method_kind,linked_account_id,archived_at")
        .eq("user_id", ownerId)
        .eq("id", input.paymentMethodId)
        .maybeSingle(),
      supabase.from("accounts")
        .select("id,account_kind,currency_code,status")
        .eq("user_id", ownerId)
        .eq("id", input.accountId)
        .maybeSingle(),
    ]);
    const method = methodResult.data;
    if (methodResult.error || !method || method.archived_at !== null
      || method.method_kind !== "credit_card" || method.linked_account_id !== null) {
      return { ok: false, kind: "rejected", field: "paymentMethodId", message: "Choose an active credit card payment method." };
    }
    const account = accountResult.data;
    if (accountResult.error || !account || account.status !== "active"
      || (account.account_kind !== "bank" && account.account_kind !== "cash")) {
      return { ok: false, kind: "rejected", field: "accountId", message: "Choose an active bank or cash account." };
    }
    if (account.currency_code !== input.currencyCode) {
      return { ok: false, kind: "rejected", field: "currencyCode", message: `This account uses ${account.currency_code}. Its currency must match the settlement.` };
    }

    const { data, error } = await supabase.rpc("post_transaction", {
      p_idempotency_key: input.idempotencyKey,
      p_transaction_kind: "card_settlement",
      p_occurred_on: input.occurredOn,
      p_amount: input.amount,
      p_currency_code: input.currencyCode,
      p_category_id: null,
      p_payment_method_id: input.paymentMethodId,
      p_entries: [{
        account_id: input.accountId,
        amount: `-${input.amount}`,
        currency_code: input.currencyCode,
      }],
      p_source: "manual",
      p_merchant: null,
      p_note: input.note,
      p_adjustment_reason: null,
      p_occurred_at: null,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
      return { ok: false, kind: "rejected", ...cardSettlementFailure(error ?? {}) };
    }
    return { ok: true, value: data };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function correctTransaction(ownerId: string, originalId: string, reason: string, input: {
  idempotencyKey: string;
  transactionKind: TransactionKind;
  occurredOn: string;
  amount: string;
  currencyCode: string;
  categoryId: string;
  paymentMethodId: string | null;
  merchant: string | null;
  note: string | null;
}): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(originalId) || !UUID_PATTERN.test(input.idempotencyKey)) return { ok: false, kind: "not-found" };
  const entries = await transactionEntries(ownerId, input.transactionKind, input.amount, input.currencyCode, input.paymentMethodId);
  if (!entries.ok) return entries;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("correct_transaction", {
      p_transaction_id: originalId,
      p_idempotency_key: input.idempotencyKey,
      p_transaction_kind: input.transactionKind,
      p_occurred_on: input.occurredOn,
      p_amount: input.amount,
      p_currency_code: input.currencyCode,
      p_category_id: input.categoryId,
      p_payment_method_id: input.paymentMethodId,
      p_entries: entries.value,
      p_reason: reason,
      p_merchant: input.merchant,
      p_note: input.note,
      p_occurred_at: null,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) return { ok: false, kind: "rejected", ...failureField(error ?? {}) };
    return { ok: true, value: data };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function voidTransaction(ownerId: string, transactionId: string, reason: string): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(transactionId)) return { ok: false, kind: "not-found" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("void_transaction", { p_transaction_id: transactionId, p_reason: reason });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
      return { ok: false, kind: "rejected", message: "This transaction is unavailable or has already been voided." };
    }
    return { ok: true, value: data };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function createCategory(ownerId: string, input: { kind: TransactionKind; name: string; parentId: string | null }): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId)) return { ok: false, kind: "unavailable" };
  try {
    const supabase = await createSupabaseServerClient();
    if (input.parentId) {
      const { data: parent, error } = await supabase.from("categories").select("id,kind,archived_at").eq("user_id", ownerId).eq("id", input.parentId).maybeSingle();
      if (error || !parent || parent.kind !== input.kind || parent.archived_at !== null) return { ok: false, kind: "rejected", field: "parentId" };
    }
    const { data, error } = await supabase.from("categories")
      .insert({ user_id: ownerId, kind: input.kind, name: input.name, parent_id: input.parentId })
      .select("id").single();
    if (error || typeof data?.id !== "string" || !UUID_PATTERN.test(data.id)) return { ok: false, kind: "unavailable" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function renameCategory(ownerId: string, categoryId: string, name: string): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(categoryId)) return { ok: false, kind: "not-found" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("categories").update({ name }).eq("user_id", ownerId).eq("id", categoryId).is("archived_at", null).select("id").maybeSingle();
    if (error) return { ok: false, kind: "unavailable" };
    if (!data) return { ok: false, kind: "not-found" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function archiveCategory(ownerId: string, categoryId: string): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(categoryId)) return { ok: false, kind: "not-found" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("categories").update({ archived_at: new Date().toISOString() }).eq("user_id", ownerId).eq("id", categoryId).is("archived_at", null).select("id").maybeSingle();
    if (error) return { ok: false, kind: "unavailable" };
    if (!data) return { ok: false, kind: "not-found" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function createPaymentMethod(ownerId: string, input: { name: string; methodKind: PaymentMethodKind; linkedAccountId: string | null }): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId)) return { ok: false, kind: "unavailable" };
  try {
    const supabase = await createSupabaseServerClient();
    if (input.methodKind === "credit_card") {
      if (input.linkedAccountId !== null) return { ok: false, kind: "rejected", field: "linkedAccountId" };
    } else {
      if (!input.linkedAccountId || !UUID_PATTERN.test(input.linkedAccountId)) return { ok: false, kind: "rejected", field: "linkedAccountId" };
      const { data: account, error } = await supabase.from("accounts").select("id,account_kind,status").eq("user_id", ownerId).eq("id", input.linkedAccountId).maybeSingle();
      if (error || !account || account.status !== "active" || (account.account_kind !== "bank" && account.account_kind !== "cash")) {
        return { ok: false, kind: "rejected", field: "linkedAccountId", message: "Choose an active bank or cash account." };
      }
    }
    const { data, error } = await supabase.from("payment_methods")
      .insert({ user_id: ownerId, name: input.name, method_kind: input.methodKind, linked_account_id: input.linkedAccountId })
      .select("id").single();
    if (error || typeof data?.id !== "string" || !UUID_PATTERN.test(data.id)) return { ok: false, kind: "unavailable" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function renamePaymentMethod(ownerId: string, methodId: string, name: string): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(methodId)) return { ok: false, kind: "not-found" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("payment_methods").update({ name }).eq("user_id", ownerId).eq("id", methodId).is("archived_at", null).select("id").maybeSingle();
    if (error) return { ok: false, kind: "unavailable" };
    if (!data) return { ok: false, kind: "not-found" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function archivePaymentMethod(ownerId: string, methodId: string): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(methodId)) return { ok: false, kind: "not-found" };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("payment_methods").update({ archived_at: new Date().toISOString() }).eq("user_id", ownerId).eq("id", methodId).is("archived_at", null).select("id").maybeSingle();
    if (error) return { ok: false, kind: "unavailable" };
    if (!data) return { ok: false, kind: "not-found" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function getUserTimezone(ownerId: string): Promise<string> {
  if (!UUID_PATTERN.test(ownerId)) return "Asia/Tokyo";
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("user_preferences").select("timezone").eq("user_id", ownerId).maybeSingle();
    if (typeof data?.timezone === "string" && data.timezone.trim()) {
      new Intl.DateTimeFormat("en-US", { timeZone: data.timezone });
      return data.timezone;
    }
  } catch {
    return "Asia/Tokyo";
  }
  return "Asia/Tokyo";
}
function amountMatchesCurrencyScale(amount: string, currencyCode: string, signed: boolean): boolean {
  const pattern = signed ? SIGNED_DECIMAL_PATTERN : DECIMAL_PATTERN;
  const match = pattern.exec(amount);
  const fractionDigits = currencyFractionDigits(currencyCode);
  const normalized = amount.replace(/^-/, "");
  return match !== null
    && fractionDigits !== null
    && /[1-9]/.test(normalized)
    && (normalized.split(".", 2)[1]?.length ?? 0) <= fractionDigits;
}

function normalizedPositiveDecimal(value: string): string {
  const [whole, fraction = ""] = value.split(".", 2);
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole!;
}

function accountMovementRpcFailure(error: { message?: string }, amountField: string, fallback: string) {
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("idempotency key")) {
    return { message: "This submission key was already used for different movement details. Reload the page and try again." };
  }
  if (message.includes("opening balance") || message.includes("predates") || message.includes("local occurrence date")) {
    return { field: "occurredOn", message: "The economic date is outside the account's tracking period." };
  }
  if (message.includes("currency") || message.includes("fractional scale") || message.includes("amount")) {
    return { field: amountField, message: "Check the amount and the selected account's currency precision." };
  }
  if (message.includes("distinct")) {
    return { field: "destinationAccountId", message: "Choose a different destination account." };
  }
  return { message: fallback };
}

export async function postAccountTransfer(ownerId: string, input: AccountTransferInput): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(input.idempotencyKey)
    || !UUID_PATTERN.test(input.sourceAccountId) || !UUID_PATTERN.test(input.destinationAccountId)
    || input.sourceAccountId === input.destinationAccountId) {
    return { ok: false, kind: "rejected", field: "destinationAccountId", message: "Choose two different active accounts." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: accounts, error: accountError } = await supabase.from("accounts")
      .select("id,name,currency_code,status,opening_as_of")
      .eq("user_id", ownerId)
      .in("id", [input.sourceAccountId, input.destinationAccountId]);
    if (accountError) return { ok: false, kind: "unavailable" };
    const source = accounts?.find((account) => account.id === input.sourceAccountId);
    const destination = accounts?.find((account) => account.id === input.destinationAccountId);
    if (!source || !destination) {
      return { ok: false, kind: "rejected", field: "sourceAccountId", message: "Choose two accounts owned by you." };
    }
    if (source.status !== "active") return { ok: false, kind: "rejected", field: "sourceAccountId", message: "Choose an active source account." };
    if (destination.status !== "active") return { ok: false, kind: "rejected", field: "destinationAccountId", message: "Choose an active destination account." };
    if (input.occurredOn < source.opening_as_of || input.occurredOn < destination.opening_as_of) {
      return { ok: false, kind: "rejected", field: "occurredOn", message: "The economic date must be on or after both accounts' opening dates." };
    }
    if (!amountMatchesCurrencyScale(input.sentAmount, source.currency_code, false)) {
      return { ok: false, kind: "rejected", field: "sentAmount", message: `Enter a positive amount using ${source.currency_code} precision.` };
    }
    if (!amountMatchesCurrencyScale(input.receivedAmount, destination.currency_code, false)) {
      return { ok: false, kind: "rejected", field: "receivedAmount", message: `Enter a positive amount using ${destination.currency_code} precision.` };
    }
    if (source.currency_code === destination.currency_code
      && normalizedPositiveDecimal(input.sentAmount) !== normalizedPositiveDecimal(input.receivedAmount)) {
      return { ok: false, kind: "rejected", field: "receivedAmount", message: "Same-currency transfers must send and receive the same amount." };
    }

    const { data, error } = await supabase.rpc("post_transaction", {
      p_idempotency_key: input.idempotencyKey,
      p_transaction_kind: "transfer",
      p_occurred_on: input.occurredOn,
      p_amount: null,
      p_currency_code: null,
      p_category_id: null,
      p_payment_method_id: null,
      p_entries: [
        { account_id: source.id, amount: `-${input.sentAmount}`, currency_code: source.currency_code },
        { account_id: destination.id, amount: input.receivedAmount, currency_code: destination.currency_code },
      ],
      p_source: "manual",
      p_merchant: null,
      p_note: input.note,
      p_adjustment_reason: null,
      p_occurred_at: null,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
      return { ok: false, kind: "rejected", ...accountMovementRpcFailure(error ?? {}, "sentAmount", "The transfer could not be saved. Check both accounts, amounts, and date.") };
    }
    return { ok: true, value: data };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function postBalanceAdjustment(ownerId: string, input: BalanceAdjustmentInput): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(input.idempotencyKey) || !UUID_PATTERN.test(input.accountId)) {
    return { ok: false, kind: "rejected", field: "accountId", message: "Choose an active account." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: account, error: accountError } = await supabase.from("accounts")
      .select("id,name,currency_code,status,opening_as_of")
      .eq("user_id", ownerId)
      .eq("id", input.accountId)
      .maybeSingle();
    if (accountError) return { ok: false, kind: "unavailable" };
    if (!account) return { ok: false, kind: "rejected", field: "accountId", message: "Choose an account owned by you." };
    if (account.status !== "active") return { ok: false, kind: "rejected", field: "accountId", message: "Choose an active account." };
    if (input.occurredOn < account.opening_as_of) {
      return { ok: false, kind: "rejected", field: "occurredOn", message: "The economic date must be on or after this account's opening date." };
    }
    if (!amountMatchesCurrencyScale(input.amount, account.currency_code, true)) {
      return { ok: false, kind: "rejected", field: "amount", message: `Enter a non-zero amount using ${account.currency_code} precision.` };
    }

    const { data, error } = await supabase.rpc("post_transaction", {
      p_idempotency_key: input.idempotencyKey,
      p_transaction_kind: "balance_adjustment",
      p_occurred_on: input.occurredOn,
      p_amount: input.amount,
      p_currency_code: account.currency_code,
      p_category_id: null,
      p_payment_method_id: null,
      p_entries: [{ account_id: account.id, amount: input.amount, currency_code: account.currency_code }],
      p_source: "manual",
      p_merchant: null,
      p_note: null,
      p_adjustment_reason: input.reason,
      p_occurred_at: null,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
      return { ok: false, kind: "rejected", ...accountMovementRpcFailure(error ?? {}, "amount", "The adjustment could not be saved. Check the account, amount, and date.") };
    }
    return { ok: true, value: data };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}
