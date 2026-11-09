"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/server";
import {
  archiveCategory,
  archivePaymentMethod,
  correctTransaction,
  createCategory,
  createPaymentMethod,
  postTransaction,
  renameCategory,
  renamePaymentMethod,
  voidTransaction,
} from "@/lib/transactions/repository";
import {
  validateCategoryInput,
  validatePaymentMethodInput,
  validateTransactionId,
  validateTransactionInput,
  validateVoidReason,
  type CategoryFormState,
  type PaymentMethodFormState,
  type TransactionFormState,
} from "@/lib/transactions/validation";

function stringField(formData: FormData, field: string): string | undefined {
  const value = formData.get(field);
  return typeof value === "string" ? value : undefined;
}

function transactionFields(formData: FormData) {
  return {
    transactionKind: stringField(formData, "transactionKind"),
    amount: stringField(formData, "amount"),
    currencyCode: stringField(formData, "currencyCode"),
    occurredOn: stringField(formData, "occurredOn"),
    categoryId: stringField(formData, "categoryId"),
    paymentMethodId: stringField(formData, "paymentMethodId") ?? "",
    merchant: stringField(formData, "merchant"),
    note: stringField(formData, "note"),
    idempotencyKey: stringField(formData, "idempotencyKey"),
  };
}

export async function createTransactionAction(_previous: TransactionFormState, formData: FormData): Promise<TransactionFormState> {
  const owner = await requireOwner();
  const validation = validateTransactionInput(transactionFields(formData));
  if (!validation.ok) return { message: "Review the highlighted transaction details.", errors: validation.errors };

  const result = await postTransaction(owner.id, validation.value);
  if (!result.ok) {
    return {
      message: result.kind === "unavailable" ? "Transaction storage is unavailable. Try again." : result.message ?? "The transaction could not be saved.",
      errors: result.field ? { [result.field]: result.message ?? "Check this field and try again." } : undefined,
    };
  }
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${result.value}`);
  redirect(`/transactions/${result.value}?created=1`);
}

export async function correctTransactionAction(_previous: TransactionFormState, formData: FormData): Promise<TransactionFormState> {
  const owner = await requireOwner();
  const transactionId = stringField(formData, "transactionId");
  if (!validateTransactionId(transactionId)) return { message: "This transaction could not be found." };
  const reason = stringField(formData, "correctionReason")?.trim() ?? "";
  if (!reason) return { message: "Explain why this transaction is being corrected." };
  const validation = validateTransactionInput(transactionFields(formData));
  if (!validation.ok) return { message: "Review the highlighted replacement details.", errors: validation.errors };

  const result = await correctTransaction(owner.id, transactionId, reason, validation.value);
  if (!result.ok) {
    return {
      message: result.kind === "unavailable" ? "Transaction storage is unavailable. The original transaction was not changed." : result.message ?? "The correction could not be saved. The original transaction remains unchanged.",
      errors: result.field ? { [result.field]: result.message ?? "Check this field and try again." } : undefined,
    };
  }
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath(`/transactions/${result.value}`);
  redirect(`/transactions/${result.value}?corrected=1`);
}

export async function voidTransactionAction(_previous: TransactionFormState, formData: FormData): Promise<TransactionFormState> {
  const owner = await requireOwner();
  const transactionId = stringField(formData, "transactionId");
  if (!validateTransactionId(transactionId)) return { message: "This transaction could not be found." };
  const reason = stringField(formData, "reason");
  const reasonError = validateVoidReason(reason);
  if (reasonError) return { message: reasonError };
  const result = await voidTransaction(owner.id, transactionId, reason!.trim());
  if (!result.ok) return { message: result.message ?? "The transaction could not be voided. It may already be voided." };
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}`);
  redirect(`/transactions/${transactionId}?voided=1`);
}

export async function createCategoryAction(_previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const owner = await requireOwner();
  const validation = validateCategoryInput({
    kind: stringField(formData, "kind"),
    name: stringField(formData, "name"),
    parentId: stringField(formData, "parentId") ?? "",
  });
  if (!validation.ok) return { message: "Review the category details.", errors: validation.errors };
  const result = await createCategory(owner.id, validation.value);
  if (!result.ok) return { message: result.kind === "rejected" ? result.message ?? "Choose an active parent category of the same kind." : "The category could not be saved. Try again." };
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
  revalidatePath("/transactions/categories");
  redirect("/transactions/categories?categoryCreated=1");
}

export async function renameCategoryAction(_previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const owner = await requireOwner();
  const categoryId = stringField(formData, "categoryId");
  const name = stringField(formData, "name")?.trim() ?? "";
  if (!validateTransactionId(categoryId)) return { message: "This category could not be found." };
  if (!name) return { message: "Enter a category name." };
  const result = await renameCategory(owner.id, categoryId, name);
  if (!result.ok) return { message: result.kind === "not-found" ? "This category is archived or unavailable." : "The category name could not be saved." };
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
  revalidatePath("/transactions/categories");
  redirect("/transactions/categories?categorySaved=1");
}

export async function archiveCategoryAction(_previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const owner = await requireOwner();
  const categoryId = stringField(formData, "categoryId");
  if (!validateTransactionId(categoryId)) return { message: "This category could not be found." };
  if (formData.get("confirmArchive") !== "on") return { message: "Confirm that this category will no longer be available for new transactions." };
  const result = await archiveCategory(owner.id, categoryId);
  if (!result.ok) return { message: result.kind === "not-found" ? "This category is archived or unavailable." : "The category could not be archived." };
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
  revalidatePath("/transactions/categories");
  redirect("/transactions/categories?categoryArchived=1");
}

export async function createPaymentMethodAction(_previous: PaymentMethodFormState, formData: FormData): Promise<PaymentMethodFormState> {
  const owner = await requireOwner();
  const validation = validatePaymentMethodInput({
    name: stringField(formData, "name"),
    methodKind: stringField(formData, "methodKind"),
    linkedAccountId: stringField(formData, "linkedAccountId") ?? "",
  });
  if (!validation.ok) return { message: "Review the payment method details.", errors: validation.errors };
  const result = await createPaymentMethod(owner.id, validation.value);
  if (!result.ok) return { message: result.message ?? "Choose an active bank or cash account for this method." };
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
  revalidatePath("/transactions/categories");
  redirect("/transactions/categories?methodCreated=1");
}

export async function renamePaymentMethodAction(_previous: PaymentMethodFormState, formData: FormData): Promise<PaymentMethodFormState> {
  const owner = await requireOwner();
  const methodId = stringField(formData, "methodId");
  const name = stringField(formData, "name")?.trim() ?? "";
  if (!validateTransactionId(methodId)) return { message: "This payment method could not be found." };
  if (!name) return { message: "Enter a payment method name." };
  const result = await renamePaymentMethod(owner.id, methodId, name);
  if (!result.ok) return { message: result.kind === "not-found" ? "This payment method is archived or unavailable." : "The payment method name could not be saved." };
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
  revalidatePath("/transactions/categories");
  redirect("/transactions/categories?methodSaved=1");
}

export async function archivePaymentMethodAction(_previous: PaymentMethodFormState, formData: FormData): Promise<PaymentMethodFormState> {
  const owner = await requireOwner();
  const methodId = stringField(formData, "methodId");
  if (!validateTransactionId(methodId)) return { message: "This payment method could not be found." };
  if (formData.get("confirmArchive") !== "on") return { message: "Confirm that this payment method will no longer be available for new transactions." };
  const result = await archivePaymentMethod(owner.id, methodId);
  if (!result.ok) return { message: result.kind === "not-found" ? "This payment method is archived or unavailable." : "The payment method could not be archived." };
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
  revalidatePath("/transactions/categories");
  redirect("/transactions/categories?methodArchived=1");
}
