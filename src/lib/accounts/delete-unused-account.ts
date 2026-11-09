import type { SupabaseClient } from "@supabase/supabase-js";
import { accountNameMatchesConfirmation } from "./validation.ts";

type DeleteResult =
  | { ok: true; value: string }
  | { ok: false; kind: "unavailable" | "not-found" | "blocked" | "confirmation-required" };

export async function deleteUnusedAccountWithClient(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
  confirmationName: string,
): Promise<DeleteResult> {
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("user_id", ownerId)
    .eq("id", accountId)
    .maybeSingle();

  if (accountError) return { ok: false, kind: "unavailable" };
  if (!account) return { ok: false, kind: "not-found" };
  if (!accountNameMatchesConfirmation(account.name, confirmationName)) {
    return { ok: false, kind: "confirmation-required" };
  }

  const [entries, linkedMethods] = await Promise.all([
    supabase
      .from("account_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ownerId)
      .eq("account_id", accountId),
    supabase
      .from("payment_methods")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ownerId)
      .eq("linked_account_id", accountId),
  ]);

  if (entries.error || linkedMethods.error || entries.count === null || linkedMethods.count === null) {
    return { ok: false, kind: "unavailable" };
  }
  if (entries.count > 0 || linkedMethods.count > 0) return { ok: false, kind: "blocked" };

  const { data, error } = await supabase
    .from("accounts")
    .delete()
    .eq("user_id", ownerId)
    .eq("id", accountId)
    .eq("name", confirmationName)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, kind: error.code === "23503" ? "blocked" : "unavailable" };
  if (!data) {
    const { data: currentAccount, error: currentAccountError } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("user_id", ownerId)
      .eq("id", accountId)
      .maybeSingle();

    if (currentAccountError) return { ok: false, kind: "unavailable" };
    if (!currentAccount) return { ok: false, kind: "not-found" };
    if (!accountNameMatchesConfirmation(currentAccount.name, confirmationName)) {
      return { ok: false, kind: "confirmation-required" };
    }
    return { ok: false, kind: "not-found" };
  }
  return { ok: true, value: data.id };
}
