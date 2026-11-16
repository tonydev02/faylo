"use client";

import Link from "next/link";
import { useState, useActionState } from "react";
import type { CurrencyOption } from "@/lib/accounts/money";
import type { TransactionCategory, TransactionPaymentMethod } from "@/lib/transactions/repository";
import { categoryPath } from "@/lib/transactions/presentation";
import type { TransactionFormState, TransactionKind } from "@/lib/transactions/validation";

type TransactionAction = (previous: TransactionFormState, formData: FormData) => Promise<TransactionFormState>;
type MethodOption = TransactionPaymentMethod & { accountName: string | null; accountCurrency: string | null; accountKind: "bank" | "cash" | "investment" | null };
type InitialValues = {
  transactionKind: TransactionKind;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  categoryId: string;
  paymentMethodId: string;
  merchant: string;
  note: string;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p className="account-field-error" id={id}>{message}</p>;
}

function methodLabel(method: MethodOption): string {
  const type = method.methodKind.replaceAll("_", " ");
  return method.accountName ? `${method.name} · ${type} · ${method.accountName}` : `${method.name} · ${type}`;
}

export function TransactionForm({
  action,
  categories,
  paymentMethods,
  currencies,
  defaultDate,
  idempotencyKey,
  initialValues,
  transactionId,
  correcting = false,
}: {
  action: TransactionAction;
  categories: TransactionCategory[];
  paymentMethods: MethodOption[];
  currencies: readonly CurrencyOption[];
  defaultDate: string;
  idempotencyKey: string;
  initialValues?: Partial<InitialValues>;
  transactionId?: string;
  correcting?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [transactionKind, setTransactionKind] = useState<TransactionKind>(initialValues?.transactionKind ?? "expense");
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId ?? "");
  const [paymentMethodId, setPaymentMethodId] = useState(initialValues?.paymentMethodId ?? "");
  const [currencyCode, setCurrencyCode] = useState(initialValues?.currencyCode ?? "JPY");
  const availableCategories = categories.filter((category) => category.kind === transactionKind && category.archivedAt === null);
  const availableMethods = paymentMethods.filter((method) => method.archivedAt === null && (transactionKind !== "income" || method.methodKind !== "credit_card") && (transactionKind !== "expense" || method.accountKind !== "investment"));
  const selectedMethod = availableMethods.find((method) => method.id === paymentMethodId);
  const categoryError = state.errors?.categoryId;
  const paymentMethodError = state.errors?.paymentMethodId;
  const amountError = state.errors?.amount;
  const dateError = state.errors?.occurredOn;
  const currencyError = state.errors?.currencyCode;

  function chooseKind(kind: TransactionKind) {
    setTransactionKind(kind);
    const currentCategory = categories.find((category) => category.id === categoryId);
    if (currentCategory?.kind !== kind) setCategoryId("");
    const currentMethod = paymentMethods.find((method) => method.id === paymentMethodId);
    if ((kind === "income" && currentMethod?.methodKind === "credit_card") || (kind === "expense" && currentMethod?.accountKind === "investment")) setPaymentMethodId("");
  }

  function chooseMethod(methodId: string) {
    setPaymentMethodId(methodId);
    const method = paymentMethods.find((candidate) => candidate.id === methodId);
    if (method?.accountCurrency) setCurrencyCode(method.accountCurrency);
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      {transactionId && <input name="transactionId" type="hidden" value={transactionId} />}
      <input name="transactionKind" type="hidden" value={transactionKind} />

      <fieldset>
        <legend className="account-field-label">Transaction type</legend>
        <div className="grid grid-cols-2 rounded-2xl border border-border bg-canvas p-1">
          {(["expense", "income"] as const).map((kind) => (
            <button
              aria-pressed={transactionKind === kind}
              className={transactionKind === kind
                ? "min-h-11 rounded-xl bg-forest px-3 text-[14px] font-semibold text-mint"
                : "min-h-11 rounded-xl px-3 text-[14px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink"}
              key={kind}
              onClick={() => chooseKind(kind)}
              type="button"
            >
              {kind === "expense" ? "Expense" : "Income"}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="account-field-label" htmlFor="transaction-amount">Amount</label>
          <input
            aria-describedby={amountError ? "transaction-amount-error" : undefined}
            aria-invalid={Boolean(amountError)}
            autoComplete="off"
            className="account-field-control text-[20px] font-medium tabular-nums"
            id="transaction-amount"
            inputMode="decimal"
            name="amount"
            placeholder="0"
            required
            defaultValue={initialValues?.amount ?? ""}
            type="text"
          />
          <FieldError id="transaction-amount-error" message={amountError} />
        </div>
        <div>
          <label className="account-field-label" htmlFor="transaction-currency">Currency</label>
          <select
            aria-describedby={currencyError ? "transaction-currency-error" : undefined}
            aria-invalid={Boolean(currencyError)}
            className="account-field-control"
            id="transaction-currency"
            name="currencyCode"
            onChange={(event) => setCurrencyCode(event.currentTarget.value)}
            required
            value={currencyCode}
          >
            {currencies.filter(({ code }) => !selectedMethod?.accountCurrency || code === selectedMethod.accountCurrency).map(({ code, fractionDigits }) => (
              <option key={code} value={code}>{code}{code === "JPY" || code === "VND" ? " · whole units" : ` · ${fractionDigits} decimals`}</option>
            ))}
          </select>
          <FieldError id="transaction-currency-error" message={currencyError} />
        </div>

        <div>
          <label className="account-field-label" htmlFor="transaction-date">Transaction date</label>
          <input
            aria-describedby={dateError ? "transaction-date-error" : undefined}
            aria-invalid={Boolean(dateError)}
            className="account-field-control"
            defaultValue={initialValues?.occurredOn ?? defaultDate}
            id="transaction-date"
            name="occurredOn"
            required
            type="date"
          />
          <FieldError id="transaction-date-error" message={dateError} />
        </div>

        <div>
          <label className="account-field-label" htmlFor="transaction-category">Category</label>
          <select
            aria-describedby={categoryError ? "transaction-category-error" : undefined}
            aria-invalid={Boolean(categoryError)}
            className="account-field-control"
            id="transaction-category"
            name="categoryId"
            onChange={(event) => setCategoryId(event.currentTarget.value)}
            required
            value={categoryId}
          >
            <option value="">Choose category</option>
            {availableCategories.map((category) => {
              const parent = categories.find((candidate) => candidate.id === category.parentId);
              return <option key={category.id} value={category.id}>{categoryPath(category.name, parent?.name ?? null)}</option>;
            })}
          </select>
          <FieldError id="transaction-category-error" message={categoryError} />
          {availableCategories.length === 0 && <p className="account-field-help">Create an {transactionKind} category before saving.</p>}
        </div>

        <div className="sm:col-span-2">
          <label className="account-field-label" htmlFor="transaction-payment-method">Payment method and account</label>
          <select
            aria-describedby={paymentMethodError ? "transaction-payment-method-error" : undefined}
            aria-invalid={Boolean(paymentMethodError)}
            className="account-field-control"
            id="transaction-payment-method"
            name="paymentMethodId"
            onChange={(event) => chooseMethod(event.currentTarget.value)}
            value={paymentMethodId}
          >
            <option value="">Unassigned · needs reconciliation</option>
            {availableMethods.map((method) => <option key={method.id} value={method.id}>{methodLabel(method)}</option>)}
          </select>
          <FieldError id="transaction-payment-method-error" message={paymentMethodError} />
          <p className="account-field-help">
            {selectedMethod?.methodKind === "credit_card"
              ? "Credit-card purchases count as spending without changing a bank balance. Faylo does not track outstanding card balances or reconcile statements; tracked assets can overstate net worth."
              : selectedMethod?.accountName
                ? `This transaction will use ${selectedMethod.accountName} in ${selectedMethod.accountCurrency}.`
                : "Unassigned activity is reportable but does not change an account balance. Add a payment method to track funded activity."}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="account-field-label" htmlFor="transaction-merchant">Merchant or source <span className="font-normal text-muted">· optional</span></label>
          <input autoComplete="organization" className="account-field-control" defaultValue={initialValues?.merchant ?? ""} id="transaction-merchant" maxLength={200} name="merchant" placeholder="Where it happened" type="text" />
        </div>

        <div className="sm:col-span-2">
          <label className="account-field-label" htmlFor="transaction-note">Note <span className="font-normal text-muted">· optional</span></label>
          <textarea className="account-field-control min-h-24 resize-y py-3" defaultValue={initialValues?.note ?? ""} id="transaction-note" maxLength={4000} name="note" placeholder="Add a detail for your records" />
        </div>

        {correcting && (
          <div className="sm:col-span-2">
            <label className="account-field-label" htmlFor="correction-reason">Why is this being corrected?</label>
            <input className="account-field-control" id="correction-reason" maxLength={500} name="correctionReason" placeholder="For example, entered the wrong amount" required />
          </div>
        )}
      </div>

      {correcting && <p className="rounded-2xl border border-border bg-canvas/50 p-4 text-[13px] leading-5 text-muted">Saving creates an atomic correction: the original will remain in history as voided, and the replacement becomes the active transaction. If the replacement fails validation, the original stays posted.</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={pending || availableCategories.length === 0} type="submit">
          {pending ? "Saving transaction…" : correcting ? "Save correction" : "Save transaction"}
        </button>
        <Link className="inline-flex min-h-12 items-center justify-center px-4 text-[14px] font-medium text-muted underline underline-offset-4 hover:text-ink" href="/transactions">Cancel</Link>
      </div>
    </form>
  );
}
