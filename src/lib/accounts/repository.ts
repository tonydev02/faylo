import "server-only";

import { createSupabaseServerClient } from "@/lib/auth/server";
import type { AccountKind, NewAccountInput } from "./validation";

export type TrackedAccount = {
  id: string;
  name: string;
  accountKind: AccountKind;
  currencyCode: string;
  openingBalance: string;
  openingAsOf: string;
  includeInAssets: boolean;
  status: "active" | "archived";
  balance: string;
  asOf: string;
};

type ServiceResult<T> = { ok: true; value: T } | { ok: false; kind: "unavailable" | "not-found" };

type RawAccount = {
  account_id: string;
  name: string;
  account_kind: AccountKind;
  currency_code: string;
  opening_balance: string;
  opening_as_of: string;
  include_in_assets: boolean;
  status: "active" | "archived";
  balance: string;
  as_of: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_KINDS: Record<AccountKind, true> = { bank: true, cash: true, investment: true };
const ACCOUNT_STATUSES: Record<"active" | "archived", true> = { active: true, archived: true };

function isRawAccount(value: unknown): value is RawAccount {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.account_id === "string"
    && UUID_PATTERN.test(row.account_id)
    && typeof row.name === "string"
    && typeof row.account_kind === "string"
    && Object.hasOwn(ACCOUNT_KINDS, row.account_kind)
    && typeof row.currency_code === "string"
    && typeof row.opening_balance === "string"
    && typeof row.opening_as_of === "string"
    && typeof row.include_in_assets === "boolean"
    && typeof row.status === "string"
    && Object.hasOwn(ACCOUNT_STATUSES, row.status)
    && typeof row.balance === "string"
    && typeof row.as_of === "string";
}

function mapAccount(row: RawAccount): TrackedAccount {
  return {
    id: row.account_id,
    name: row.name,
    accountKind: row.account_kind,
    currencyCode: row.currency_code,
    openingBalance: row.opening_balance,
    openingAsOf: row.opening_as_of,
    includeInAssets: row.include_in_assets,
    status: row.status,
    balance: row.balance,
    asOf: row.as_of,
  };
}


export async function listAccounts(ownerId: string): Promise<ServiceResult<TrackedAccount[]>> {
  if (!UUID_PATTERN.test(ownerId)) return { ok: false, kind: "unavailable" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("account_balances_as_of");
    if (error || !Array.isArray(data) || !data.every(isRawAccount)) return { ok: false, kind: "unavailable" };
    return { ok: true, value: data.map(mapAccount) };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function getAccount(ownerId: string, accountId: string): Promise<ServiceResult<TrackedAccount | null>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(accountId)) return { ok: true, value: null };
  const result = await listAccounts(ownerId);
  if (!result.ok) return result;
  return { ok: true, value: result.value.find((account) => account.id === accountId) ?? null };
}

export async function createAccount(ownerId: string, input: NewAccountInput): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId)) return { ok: false, kind: "unavailable" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: ownerId,
        name: input.name,
        account_kind: input.accountKind,
        currency_code: input.currencyCode,
        opening_balance: input.openingBalance,
        opening_as_of: input.openingAsOf,
        include_in_assets: input.includeInAssets,
      })
      .select("id")
      .single();

    if (error || typeof data?.id !== "string" || !UUID_PATTERN.test(data.id)) return { ok: false, kind: "unavailable" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function updateActiveAccount(
  ownerId: string,
  accountId: string,
  values: { name: string; includeInAssets: boolean },
): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(accountId)) return { ok: false, kind: "not-found" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("accounts")
      .update({ name: values.name, include_in_assets: values.includeInAssets })
      .eq("user_id", ownerId)
      .eq("id", accountId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, kind: "unavailable" };
    if (!data) return { ok: false, kind: "not-found" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function archiveActiveAccount(ownerId: string, accountId: string): Promise<ServiceResult<string>> {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(accountId)) return { ok: false, kind: "not-found" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("accounts")
      .update({ status: "archived" })
      .eq("user_id", ownerId)
      .eq("id", accountId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, kind: "unavailable" };
    if (!data) return { ok: false, kind: "not-found" };
    return { ok: true, value: data.id };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}
