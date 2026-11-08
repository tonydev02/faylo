"use client";

import { useActionState } from "react";
import { createAccountAction } from "@/app/accounts/actions";
import type { CurrencyOption } from "@/lib/accounts/money";
import { ACCOUNT_KINDS } from "@/lib/accounts/account-kinds";
import type { AccountFormState, AccountField } from "@/lib/accounts/validation";

const INITIAL_STATE: AccountFormState = {};
const KIND_LABELS = { bank: "Bank", cash: "Cash", investment: "Investment" } as const;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p className="account-field-error" id={id}>{message}</p>;
}

export function AccountForm({ currencies, defaultDate }: { currencies: readonly CurrencyOption[]; defaultDate: string }) {
  const [state, formAction, pending] = useActionState(createAccountAction, INITIAL_STATE);
  const fieldError = (field: AccountField) => state.errors?.[field];

  return (
    <form action={formAction} className="space-y-6">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="account-field-label" htmlFor="account-name">Account name</label>
          <input
            aria-describedby={fieldError("name") ? "account-name-error" : undefined}
            aria-invalid={Boolean(fieldError("name"))}
            autoComplete="off"
            className="account-field-control"
            id="account-name"
            name="name"
            required
          />
          <FieldError id="account-name-error" message={fieldError("name")} />
        </div>

        <div>
          <label className="account-field-label" htmlFor="account-kind">Account type</label>
          <select
            aria-describedby={fieldError("accountKind") ? "account-kind-error" : undefined}
            aria-invalid={Boolean(fieldError("accountKind"))}
            className="account-field-control"
            defaultValue="bank"
            id="account-kind"
            name="accountKind"
            required
          >
            {ACCOUNT_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </select>
          <FieldError id="account-kind-error" message={fieldError("accountKind")} />
        </div>

        <div>
          <label className="account-field-label" htmlFor="account-currency">Currency code</label>
          <select
            aria-describedby={fieldError("currencyCode") ? "account-currency-error" : undefined}
            aria-invalid={Boolean(fieldError("currencyCode"))}
            className="account-field-control"
            defaultValue="JPY"
            id="account-currency"
            name="currencyCode"
            required
          >
            {currencies.map(({ code }) => <option key={code} value={code}>{code}</option>)}
          </select>
          <FieldError id="account-currency-error" message={fieldError("currencyCode")} />
        </div>

        <div>
          <label className="account-field-label" htmlFor="opening-balance">Opening balance</label>
          <input
            aria-describedby={fieldError("openingBalance") ? "opening-balance-error" : "opening-balance-help"}
            aria-invalid={Boolean(fieldError("openingBalance"))}
            autoComplete="off"
            className="account-field-control tabular-nums"
            id="opening-balance"
            inputMode="decimal"
            name="openingBalance"
            required
            type="text"
          />
          <p className="account-field-help" id="opening-balance-help">Enter the exact amount in the selected currency. Negative balances are allowed by the current account schema.</p>
          <FieldError id="opening-balance-error" message={fieldError("openingBalance")} />
        </div>

        <div>
          <label className="account-field-label" htmlFor="opening-as-of">Opening effective date</label>
          <input
            aria-describedby={fieldError("openingAsOf") ? "opening-as-of-error" : "opening-as-of-help"}
            aria-invalid={Boolean(fieldError("openingAsOf"))}
            className="account-field-control"
            defaultValue={defaultDate}
            id="opening-as-of"
            name="openingAsOf"
            required
            type="date"
          />
          <p className="account-field-help" id="opening-as-of-help">Date only. Tracking starts on this date; no time of day is stored.</p>
          <FieldError id="opening-as-of-error" message={fieldError("openingAsOf")} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-canvas/40 p-4 sm:p-5">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] leading-6 text-ink">
          <input className="account-checkbox mt-1" defaultChecked name="includeInAssets" type="checkbox" value="on" />
          <span>
            <span className="block font-medium">Include in tracked assets</span>
            <span className="block text-[13px] text-muted">Use this account when showing tracked assets. You can change this later.</span>
          </span>
        </label>
        <p className="mt-4 border-t border-border pt-4 text-[13px] leading-6 text-muted">
          This opening balance is a starting snapshot, not income or an expense. Faylo will not create historical transactions.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-wait disabled:opacity-60" disabled={pending} type="submit">
          {pending ? "Saving account…" : "Create account"}
        </button>
        <p aria-live="polite" className="text-[13px] text-muted">{pending ? "Saving your account securely." : "Your opening amount and account type cannot be edited later."}</p>
      </div>
    </form>
  );
}
