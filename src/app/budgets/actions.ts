"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/server";
import { monthStartForTimezone } from "@/lib/dashboard/presentation";
import { removeCategoryBudget, saveCategoryBudget } from "@/lib/dashboard/repository";
import type { BudgetActionState } from "@/lib/dashboard/validation";
import { parseBudgetFormInput, parseBudgetRemovalInput } from "@/lib/dashboard/validation";
import { getUserTimezone } from "@/lib/transactions/repository";

function failure(message: string): BudgetActionState {
  return { kind: "error", message };
}

export async function saveCategoryBudgetAction(
  previousState: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  void previousState;
  const owner = await requireOwner();
  const timezone = await getUserTimezone(owner.id);
  const intent = formData.get("intent");
  const monthStart = formData.get("monthStart");
  if (typeof monthStart !== "string" || monthStart > monthStartForTimezone(new Date(), timezone)) {
    return failure("Budgets are available for the current or a historical month.");
  }

  if (intent === "remove") {
    const parsed = parseBudgetRemovalInput({ categoryId: formData.get("categoryId"), monthStart });
    if (!parsed.ok) return failure("Choose a valid expense category and reporting month.");
    const result = await removeCategoryBudget(owner.id, parsed.categoryId, parsed.monthStart);
    if (!result.ok) return failure("The budget could not be removed. Reload and try again.");
    revalidatePath("/");
    return { kind: "success", message: "Budget removed." };
  }

  if (intent !== "save") return failure("Choose a budget action.");
  const parsed = parseBudgetFormInput({
    categoryId: formData.get("categoryId"),
    monthStart,
    limitJpy: formData.get("limitJpy"),
  });
  if (!parsed.ok) {
    return failure(parsed.field === "limitJpy" ? "Enter a non-negative whole-yen budget." : "Choose a valid expense category and reporting month.");
  }
  const result = await saveCategoryBudget(owner.id, parsed.categoryId, parsed.monthStart, parsed.limitJpy);
  if (!result.ok) {
    return failure(result.field === "categoryId"
      ? "Choose an active expense category."
      : "The budget could not be saved. Reload and try again.");
  }
  revalidatePath("/");
  return { kind: "success", message: "Budget saved." };
}
