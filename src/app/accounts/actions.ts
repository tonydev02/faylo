"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/server";
import { archiveActiveAccount, createAccount, updateActiveAccount } from "@/lib/accounts/repository";
import { validateAccountInput, validateAccountUpdate, type AccountFormState } from "@/lib/accounts/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stringField(formData: FormData, field: string): string | undefined {
  const value = formData.get(field);
  return typeof value === "string" ? value : undefined;
}

function checkboxField(formData: FormData, field: string): unknown {
  const value = formData.get(field);
  if (value === null) return false;
  return value === "on" ? true : value;
}

export async function createAccountAction(_previousState: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const owner = await requireOwner();
  const validation = validateAccountInput({
    name: stringField(formData, "name"),
    accountKind: stringField(formData, "accountKind"),
    currencyCode: stringField(formData, "currencyCode"),
    openingBalance: stringField(formData, "openingBalance"),
    openingAsOf: stringField(formData, "openingAsOf"),
    includeInAssets: checkboxField(formData, "includeInAssets"),
  });

  if (!validation.ok) return { message: "Review the highlighted account details.", errors: validation.errors };

  const result = await createAccount(owner.id, validation.value);
  if (!result.ok) return { message: "The account could not be saved. The Faylo account database may not be deployed yet." };

  revalidatePath("/");
  revalidatePath("/accounts");
  redirect(`/accounts/${result.value}?created=1`);
}

export async function updateAccountAction(_previousState: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const owner = await requireOwner();
  const accountId = stringField(formData, "accountId") ?? "";
  if (!UUID_PATTERN.test(accountId)) return { message: "This account could not be found." };

  const validation = validateAccountUpdate(
    stringField(formData, "name"),
    checkboxField(formData, "includeInAssets"),
  );
  if (!validation.ok) return { message: "Review the highlighted account details.", errors: validation.errors };

  const result = await updateActiveAccount(owner.id, accountId, validation.value);
  if (!result.ok) {
    return {
      message: result.kind === "not-found"
        ? "This account is unavailable or archived. Archived accounts are read-only."
        : "The account could not be updated. Try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  redirect(`/accounts/${accountId}?saved=1`);
}

export async function archiveAccountAction(_previousState: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const owner = await requireOwner();
  const accountId = stringField(formData, "accountId") ?? "";
  if (!UUID_PATTERN.test(accountId)) return { message: "This account could not be found." };
  if (formData.get("confirmArchive") !== "on") {
    return { message: "Confirm that this account will become read-only before archiving it." };
  }

  const result = await archiveActiveAccount(owner.id, accountId);
  if (!result.ok) {
    return {
      message: result.kind === "not-found"
        ? "This account is unavailable or already archived."
        : "The account could not be archived. Try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  redirect("/accounts?archived=1");
}
