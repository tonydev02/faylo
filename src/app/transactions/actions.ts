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
  postAccountTransfer,
  postBalanceAdjustment,
  postCardSettlement,
  postTransaction,
  renameCategory,
  renamePaymentMethod,
  voidTransaction,
} from "@/lib/transactions/repository";
import { overrideTransactionReportingFx, resolveTransactionReportingFx } from "@/lib/transactions/fx-service";
import { validateReportingFxOverride, type ReportingFxFormState } from "@/lib/transactions/fx-validation";
import {
  validateAccountTransferInput,
  validateBalanceAdjustmentInput,
  validateCardSettlementInput,
  validateCategoryInput,
  validatePaymentMethodInput,
  validateTransactionId,
  validateTransactionInput,
  validateVoidReason,
  type AccountMovementField,
  type AccountMovementFormState,
  type CardSettlementField,
  type CardSettlementFormState,
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

export async function recordCardSettlementAction(_previous: CardSettlementFormState, formData: FormData): Promise<CardSettlementFormState> {
  const owner = await requireOwner();
  const validation = validateCardSettlementInput({
    amount: stringField(formData, "amount"),
    currencyCode: stringField(formData, "currencyCode"),
    occurredOn: stringField(formData, "occurredOn"),
    paymentMethodId: stringField(formData, "paymentMethodId"),
    accountId: stringField(formData, "accountId"),
    note: stringField(formData, "note"),
    idempotencyKey: stringField(formData, "idempotencyKey"),
  });
  if (!validation.ok) return { message: "Review the highlighted settlement details.", errors: validation.errors };

  const result = await postCardSettlement(owner.id, validation.value);
  if (!result.ok) {
    const field = result.field as CardSettlementField | undefined;
    return {
      message: result.kind === "unavailable" ? "Settlement storage is unavailable. Try again." : result.message ?? "The card settlement could not be saved.",
      errors: field ? { [field]: result.message ?? "Check this field and try again." } : undefined,
    };
  }
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/transactions/settlement");
  revalidatePath(`/transactions/${result.value}`);
  redirect(`/transactions/${result.value}?settled=1`);
}

export async function postAccountTransferAction(_previous: AccountMovementFormState, formData: FormData): Promise<AccountMovementFormState> {
  const owner = await requireOwner();
  const validation = validateAccountTransferInput({
    sourceAccountId: stringField(formData, "sourceAccountId"),
    destinationAccountId: stringField(formData, "destinationAccountId"),
    sentAmount: stringField(formData, "sentAmount"),
    receivedAmount: stringField(formData, "receivedAmount"),
    occurredOn: stringField(formData, "occurredOn"),
    note: stringField(formData, "note"),
    idempotencyKey: stringField(formData, "idempotencyKey"),
  });
  if (!validation.ok) return { message: validation.message ?? "Review the highlighted transfer details.", errors: validation.errors };

  const result = await postAccountTransfer(owner.id, validation.value);
  if (!result.ok) {
    const field = result.field as AccountMovementField | undefined;
    return {
      message: result.kind === "unavailable" ? "Transfer storage is unavailable. Try again." : result.message ?? "The transfer could not be saved.",
      errors: field ? { [field]: result.message ?? "Check this field and try again." } : undefined,
    };
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${validation.value.sourceAccountId}`);
  revalidatePath(`/accounts/${validation.value.destinationAccountId}`);
  revalidatePath("/transactions");
  revalidatePath("/transactions/transfer");
  revalidatePath(`/transactions/${result.value}`);
  redirect(`/transactions/${result.value}?transferred=1`);
}

export async function postBalanceAdjustmentAction(_previous: AccountMovementFormState, formData: FormData): Promise<AccountMovementFormState> {
  const owner = await requireOwner();
  const validation = validateBalanceAdjustmentInput({
    accountId: stringField(formData, "accountId"),
    amount: stringField(formData, "amount"),
    occurredOn: stringField(formData, "occurredOn"),
    reason: stringField(formData, "reason"),
    idempotencyKey: stringField(formData, "idempotencyKey"),
  });
  if (!validation.ok) return { message: validation.message ?? "Review the highlighted adjustment details.", errors: validation.errors };

  const result = await postBalanceAdjustment(owner.id, validation.value);
  if (!result.ok) {
    const field = result.field as AccountMovementField | undefined;
    return {
      message: result.kind === "unavailable" ? "Adjustment storage is unavailable. Try again." : result.message ?? "The adjustment could not be saved.",
      errors: field ? { [field]: result.message ?? "Check this field and try again." } : undefined,
    };
  }
  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${validation.value.accountId}`);
  revalidatePath("/transactions");
  revalidatePath("/transactions/adjustment");
  revalidatePath(`/transactions/${result.value}`);
  redirect(`/transactions/${result.value}?adjusted=1`);
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

export async function saveReportingFxOverrideAction(
  _previous: ReportingFxFormState,
  formData: FormData,
): Promise<ReportingFxFormState> {
  const owner = await requireOwner();
  const validation = validateReportingFxOverride({
    transactionId: stringField(formData, "transactionId"),
    idempotencyKey: stringField(formData, "idempotencyKey"),
    rate: stringField(formData, "rate"),
    effectiveOn: stringField(formData, "effectiveOn"),
    note: stringField(formData, "note"),
  });
  if (!validation.ok) return { message: "Review the rate, effective date, and explanation.", errors: validation.errors };

  const result = await overrideTransactionReportingFx({
    ownerId: owner.id,
    ...validation.value,
  });
  if (!result.ok) return { message: result.message };
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${validation.value.transactionId}`);
  redirect(`/transactions/${validation.value.transactionId}?fx=updated`);
}

export async function retryReportingFxAction(formData: FormData): Promise<never> {
  const owner = await requireOwner();
  const transactionId = stringField(formData, "transactionId");
  if (!validateTransactionId(transactionId)) redirect("/transactions");
  await resolveTransactionReportingFx(owner.id, transactionId, true);
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath(`/transactions/${transactionId}`);
  redirect(`/transactions/${transactionId}?fx=retry`);
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
  revalidatePath("/transactions/settlement");
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
  revalidatePath("/transactions/settlement");
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
  revalidatePath("/transactions/settlement");
  revalidatePath("/transactions/categories");
  redirect("/transactions/categories?methodArchived=1");
}
