"use client";

import { useActionState } from "react";
import { saveCategoryBudgetAction } from "@/app/budgets/actions";
import type { TransactionCategory } from "@/lib/transactions/repository";
import type { BudgetActionState } from "@/lib/dashboard/validation";

const INITIAL_STATE: BudgetActionState = {};

function ActionMessage({ state }: { state: BudgetActionState }) {
  if (!state.message) return null;
  return <p className={state.kind === "success" ? "account-success-message" : "account-form-message"} role={state.kind === "success" ? "status" : "alert"}>{state.message}</p>;
}

export function AddBudgetForm({
  monthStart,
  categories,
  budgetedCategoryIds,
}: {
  monthStart: string;
  categories: TransactionCategory[];
  budgetedCategoryIds: string[];
}) {
  const [state, formAction, pending] = useActionState(saveCategoryBudgetAction, INITIAL_STATE);
  const budgeted = new Set(budgetedCategoryIds);
  const availableCategories = categories.filter((category) => category.kind === "expense" && category.archivedAt === null && !budgeted.has(category.id));
  if (categories.length === 0) return <p className="text-[13px] leading-5 text-muted">Create an active expense category before setting a budget.</p>;
  if (availableCategories.length === 0) return <p className="text-[13px] leading-5 text-muted">Every active expense category already has a budget for this month.</p>;

  return (
    <form action={formAction} className="mt-4 grid gap-3 rounded-2xl border border-border bg-canvas/45 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(130px,0.7fr)_auto] sm:items-end">
      <input name="monthStart" type="hidden" value={monthStart} />
      <div>
        <label className="account-field-label" htmlFor="new-budget-category">Expense category</label>
        <select className="account-field-control" id="new-budget-category" name="categoryId" required>
          {availableCategories.map((category) => {
            const parent = category.parentId ? categories.find((item) => item.id === category.parentId) : undefined;
            return <option key={category.id} value={category.id}>{parent ? `${parent.name} / ` : ""}{category.name}</option>;
          })}
        </select>
      </div>
      <div>
        <label className="account-field-label" htmlFor="new-budget-limit">Monthly limit · JPY</label>
        <input className="account-field-control" id="new-budget-limit" min="0" name="limitJpy" placeholder="e.g. 30000" step="1" type="number" />
      </div>
      <button className="inline-flex min-h-12 items-center justify-center rounded-xl bg-mint px-4 text-[13px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-wait disabled:opacity-60" disabled={pending} name="intent" type="submit" value="save">{pending ? "Saving…" : "Add budget"}</button>
      <div className="sm:col-span-3"><ActionMessage state={state} /></div>
    </form>
  );
}

export function BudgetEditor({
  categoryId,
  categoryName,
  monthStart,
  limitJpy,
  editable,
}: {
  categoryId: string;
  categoryName: string;
  monthStart: string;
  limitJpy: string;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveCategoryBudgetAction, INITIAL_STATE);
  const inputId = `budget-limit-${categoryId}`;
  return (
    <form action={formAction} className="mt-3 grid gap-2 sm:grid-cols-[minmax(130px,190px)_auto_auto] sm:items-end">
      <input name="categoryId" type="hidden" value={categoryId} />
      <input name="monthStart" type="hidden" value={monthStart} />
      <div>
        <label className="account-field-label" htmlFor={inputId}>Monthly limit · JPY</label>
        <input aria-label={`${categoryName} monthly limit in JPY`} className="account-field-control" disabled={!editable || pending} id={inputId} min="0" name="limitJpy" step="1" type="number" defaultValue={limitJpy} />
      </div>
      <button className="inline-flex min-h-11 items-center justify-center rounded-xl bg-mint px-4 text-[12px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-not-allowed disabled:opacity-50" disabled={!editable || pending} name="intent" type="submit" value="save">{pending ? "Saving…" : "Save"}</button>
      <button className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-[12px] font-medium text-muted transition-colors hover:bg-raised disabled:cursor-wait disabled:opacity-60" disabled={pending} formNoValidate name="intent" type="submit" value="remove">Remove</button>
      <div className="sm:col-span-3"><ActionMessage state={state} /></div>
    </form>
  );
}
