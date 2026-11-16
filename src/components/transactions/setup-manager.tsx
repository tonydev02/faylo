"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  archiveCategoryAction,
  archivePaymentMethodAction,
  createCategoryAction,
  createPaymentMethodAction,
  renameCategoryAction,
  renamePaymentMethodAction,
} from "@/app/transactions/actions";
import type { TrackedAccount } from "@/lib/accounts/repository";
import type { TransactionCategory, TransactionPaymentMethod } from "@/lib/transactions/repository";
import type { CategoryFormState, PaymentMethodFormState, TransactionKind } from "@/lib/transactions/validation";

const INITIAL_CATEGORY_STATE: CategoryFormState = {};
const INITIAL_METHOD_STATE: PaymentMethodFormState = {};
const METHOD_KINDS = [
  ["cash", "Cash"],
  ["debit_card", "Debit card"],
  ["credit_card", "Credit card"],
  ["bank_transfer", "Bank transfer"],
  ["other", "Other funded method"],
] as const;

function CategoryCreateForm({ categories }: { categories: TransactionCategory[] }) {
  const [state, formAction, pending] = useActionState(createCategoryAction, INITIAL_CATEGORY_STATE);
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [parentId, setParentId] = useState("");
  const activeParents = categories.filter((category) => category.kind === kind && category.archivedAt === null);
  return (
    <form action={formAction} className="space-y-4">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="account-field-label" htmlFor="new-category-kind">Kind</label>
          <select className="account-field-control" id="new-category-kind" name="kind" onChange={(event) => { setKind(event.currentTarget.value as TransactionKind); setParentId(""); }} value={kind}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <div>
          <label className="account-field-label" htmlFor="new-category-name">Category name</label>
          <input autoComplete="off" className="account-field-control" id="new-category-name" maxLength={120} name="name" placeholder="For example, Food" required />
        </div>
        <div>
          <label className="account-field-label" htmlFor="new-category-parent">Parent category <span className="font-normal text-muted">· optional</span></label>
          <select className="account-field-control" id="new-category-parent" name="parentId" onChange={(event) => setParentId(event.currentTarget.value)} value={parentId}>
            <option value="">No parent</option>
            {activeParents.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[12px] leading-5 text-muted">Categories are separated by income and expense. Existing transactions keep their category if it is later archived.</p>
      <button className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-raised px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-[#282828] disabled:opacity-60 sm:w-auto" disabled={pending} type="submit">{pending ? "Saving category…" : "Add category"}</button>
    </form>
  );
}

function CategoryRow({ category, parentName }: { category: TransactionCategory; parentName: string | null }) {
  const [renameState, renameAction, renamePending] = useActionState(renameCategoryAction, INITIAL_CATEGORY_STATE);
  const [archiveState, archiveAction, archivePending] = useActionState(archiveCategoryAction, INITIAL_CATEGORY_STATE);
  return (
    <li className="rounded-2xl border border-border bg-canvas/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-ink">{parentName ? `${parentName} / ` : ""}{category.name}</p>
          <p className="mt-1 text-[12px] text-muted">{category.kind === "expense" ? "Expense" : "Income"} category{category.archivedAt ? " · archived" : ""}</p>
        </div>
        {category.archivedAt && <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted">Archived</span>}
      </div>
      {!category.archivedAt && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <form action={renameAction} className="flex flex-col gap-2 sm:flex-row">
            {renameState.message && <p className="account-form-message sm:basis-full" role="alert">{renameState.message}</p>}
            <input name="categoryId" type="hidden" value={category.id} />
            <label className="sr-only" htmlFor={`rename-category-${category.id}`}>Rename {category.name}</label>
            <input className="account-field-control min-h-11" defaultValue={category.name} id={`rename-category-${category.id}`} maxLength={120} name="name" required />
            <button className="min-h-11 shrink-0 rounded-xl border border-border bg-raised px-4 text-[12px] font-medium text-ink hover:bg-[#282828] disabled:opacity-60" disabled={renamePending} type="submit">{renamePending ? "Saving…" : "Rename"}</button>
          </form>
          <form action={archiveAction} className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
            {archiveState.message && <p className="account-form-message sm:basis-full" role="alert">{archiveState.message}</p>}
            <input name="categoryId" type="hidden" value={category.id} />
            <label className="flex min-h-11 items-center gap-2 text-[12px] leading-5 text-muted">
              <input className="account-checkbox" name="confirmArchive" required type="checkbox" value="on" />
              Archive
            </label>
            <button className="min-h-11 shrink-0 rounded-xl border border-[#633f3f] bg-[#251919] px-4 text-[12px] font-medium text-[#f2c5c5] hover:bg-[#382222] disabled:opacity-60" disabled={archivePending} type="submit">{archivePending ? "Archiving…" : "Archive"}</button>
          </form>
        </div>
      )}
    </li>
  );
}

function PaymentMethodCreateForm({ accounts }: { accounts: TrackedAccount[] }) {
  const [state, formAction, pending] = useActionState(createPaymentMethodAction, INITIAL_METHOD_STATE);
  const [methodKind, setMethodKind] = useState("cash");
  const activeAccounts = accounts.filter((account) => account.status === "active" && (account.accountKind === "bank" || account.accountKind === "cash"));
  const creditCard = methodKind === "credit_card";
  return (
    <form action={formAction} className="space-y-4">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="account-field-label" htmlFor="new-method-kind">Method type</label>
          <select className="account-field-control" id="new-method-kind" name="methodKind" onChange={(event) => setMethodKind(event.currentTarget.value)} value={methodKind}>
            {METHOD_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="account-field-label" htmlFor="new-method-name">Method name</label>
          <input autoComplete="off" className="account-field-control" id="new-method-name" maxLength={120} name="name" placeholder="For example, Wallet" required />
        </div>
        <div>
          <label className="account-field-label" htmlFor="new-method-account">Linked bank or cash account</label>
          <select className="account-field-control" disabled={creditCard} id="new-method-account" name="linkedAccountId" required={!creditCard} defaultValue="">
            {creditCard ? <option value="">No account link</option> : <option value="">Choose an active account</option>}
            {!creditCard && activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currencyCode}</option>)}
          </select>
        </div>
      </div>
      {creditCard
        ? <p className="text-[12px] leading-5 text-muted">Credit cards have no linked account or tracked liability in Faylo. Purchases count as expenses, but outstanding balances and statement reconciliation are not tracked.</p>
        : activeAccounts.length === 0
          ? <p className="text-[12px] leading-5 text-muted">Create an active bank or cash account before adding a funded payment method.</p>
          : <p className="text-[12px] leading-5 text-muted">The linked account determines the original transaction currency and receives or funds the account entry.</p>}
      <button className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-raised px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-[#282828] disabled:opacity-60 sm:w-auto" disabled={pending || (!creditCard && activeAccounts.length === 0)} type="submit">{pending ? "Saving method…" : "Add payment method"}</button>
    </form>
  );
}

function PaymentMethodRow({ method, accountName }: { method: TransactionPaymentMethod; accountName: string | null }) {
  const [renameState, renameAction, renamePending] = useActionState(renamePaymentMethodAction, INITIAL_METHOD_STATE);
  const [archiveState, archiveAction, archivePending] = useActionState(archivePaymentMethodAction, INITIAL_METHOD_STATE);
  return (
    <li className="rounded-2xl border border-border bg-canvas/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-ink">{method.name}</p>
          <p className="mt-1 text-[12px] text-muted">{method.methodKind.replaceAll("_", " ")}{accountName ? ` · ${accountName}` : method.methodKind === "credit_card" ? " · no tracked liability" : " · no linked account"}{method.archivedAt ? " · archived" : ""}</p>
        </div>
        {method.archivedAt && <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted">Archived</span>}
      </div>
      {!method.archivedAt && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <form action={renameAction} className="flex flex-col gap-2 sm:flex-row">
            {renameState.message && <p className="account-form-message sm:basis-full" role="alert">{renameState.message}</p>}
            <input name="methodId" type="hidden" value={method.id} />
            <label className="sr-only" htmlFor={`rename-method-${method.id}`}>Rename {method.name}</label>
            <input className="account-field-control min-h-11" defaultValue={method.name} id={`rename-method-${method.id}`} maxLength={120} name="name" required />
            <button className="min-h-11 shrink-0 rounded-xl border border-border bg-raised px-4 text-[12px] font-medium text-ink hover:bg-[#282828] disabled:opacity-60" disabled={renamePending} type="submit">{renamePending ? "Saving…" : "Rename"}</button>
          </form>
          <form action={archiveAction} className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
            {archiveState.message && <p className="account-form-message sm:basis-full" role="alert">{archiveState.message}</p>}
            <input name="methodId" type="hidden" value={method.id} />
            <label className="flex min-h-11 items-center gap-2 text-[12px] leading-5 text-muted">
              <input className="account-checkbox" name="confirmArchive" required type="checkbox" value="on" />
              Archive
            </label>
            <button className="min-h-11 shrink-0 rounded-xl border border-[#633f3f] bg-[#251919] px-4 text-[12px] font-medium text-[#f2c5c5] hover:bg-[#382222] disabled:opacity-60" disabled={archivePending} type="submit">{archivePending ? "Archiving…" : "Archive"}</button>
          </form>
        </div>
      )}
    </li>
  );
}

export function TransactionSetupManager({
  accounts,
  categories,
  paymentMethods,
}: {
  accounts: TrackedAccount[];
  categories: TransactionCategory[];
  paymentMethods: TransactionPaymentMethod[];
}) {
  const [categoryKind, setCategoryKind] = useState<TransactionKind | "all">("all");
  const filteredCategories = categories.filter((category) => categoryKind === "all" || category.kind === categoryKind);
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return (
    <div className="space-y-5">
      <section aria-labelledby="category-create-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
        <div className="mb-5">
          <p className="text-[12px] font-medium text-muted">Categories</p>
          <h2 className="mt-1 text-[19px] font-medium tracking-[-0.03em] text-ink" id="category-create-title">Add a category</h2>
        </div>
        <CategoryCreateForm categories={categories} />
      </section>

      <section aria-labelledby="category-list-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[12px] font-medium text-muted">Category library</p>
            <h2 className="mt-1 text-[19px] font-medium tracking-[-0.03em] text-ink" id="category-list-title">Income and expense categories</h2>
          </div>
          <label className="flex items-center gap-3 text-[12px] text-muted">
            <span>Show</span>
            <select className="account-field-control min-h-10 w-auto py-1 text-[13px]" onChange={(event) => setCategoryKind(event.currentTarget.value as TransactionKind | "all")} value={categoryKind}>
              <option value="all">All categories</option>
              <option value="expense">Expenses</option>
              <option value="income">Income</option>
            </select>
          </label>
        </div>
        {filteredCategories.length === 0
          ? <div className="mt-5 rounded-2xl border border-dashed border-border px-5 py-8 text-center"><h3 className="text-[14px] font-medium text-ink">No categories yet</h3><p className="mt-2 text-[13px] text-muted">Add an income or expense category above to begin classifying transactions.</p></div>
          : <ul className="mt-5 space-y-3">{filteredCategories.map((category) => <CategoryRow category={category} key={category.id} parentName={categories.find((parent) => parent.id === category.parentId)?.name ?? null} />)}</ul>}
      </section>

      <section aria-labelledby="method-create-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
        <div className="mb-5">
          <p className="text-[12px] font-medium text-muted">Payment methods</p>
          <h2 className="mt-1 text-[19px] font-medium tracking-[-0.03em] text-ink" id="method-create-title">Add a payment method</h2>
          {accounts.length === 0 && <p className="mt-2 text-[13px] leading-5 text-muted">A bank or cash account is needed for funded methods. <Link className="text-mint underline underline-offset-4" href="/accounts/new">Add an account</Link></p>}
        </div>
        <PaymentMethodCreateForm accounts={accounts} />
      </section>

      <section aria-labelledby="method-list-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
        <div>
          <p className="text-[12px] font-medium text-muted">Method library</p>
          <h2 className="mt-1 text-[19px] font-medium tracking-[-0.03em] text-ink" id="method-list-title">Payment methods</h2>
        </div>
        {paymentMethods.length === 0
          ? <div className="mt-5 rounded-2xl border border-dashed border-border px-5 py-8 text-center"><h3 className="text-[14px] font-medium text-ink">No payment methods yet</h3><p className="mt-2 text-[13px] text-muted">Create a cash or debit method for tracked balance movements, or a credit card for expense-only purchases.</p></div>
          : <ul className="mt-5 space-y-3">{paymentMethods.map((method) => <PaymentMethodRow accountName={method.linkedAccountId ? accountById.get(method.linkedAccountId)?.name ?? null : null} key={method.id} method={method} />)}</ul>}
      </section>
    </div>
  );
}
