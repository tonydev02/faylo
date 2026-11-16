"use client";

import { useActionState, useState } from "react";
import type { TrackedAccount } from "@/lib/accounts/repository";
import type { TransactionPaymentMethod } from "@/lib/transactions/repository";
import type { CardSettlementFormState } from "@/lib/transactions/validation";

type CardSettlementAction = (previous: CardSettlementFormState, formData: FormData) => Promise<CardSettlementFormState>;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p className="account-field-error" id={id}>{message}</p>;
}

export function CardSettlementForm({
  action,
  accounts,
  creditCards,
  defaultDate,
  idempotencyKey,
}: {
  action: CardSettlementAction;
  accounts: TrackedAccount[];
  creditCards: TransactionPaymentMethod[];
  defaultDate: string;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [paymentMethodId, setPaymentMethodId] = useState(creditCards[0]?.id ?? "");
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const errors = state.errors;

  return (
    <form action={formAction} className="space-y-5">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      <input name="currencyCode" type="hidden" value={selectedAccount?.currencyCode ?? ""} />

      <div>
        <label className="account-field-label" htmlFor="settlement-card">Credit card</label>
        <select
          aria-describedby={errors?.paymentMethodId ? "settlement-card-error" : undefined}
          aria-invalid={Boolean(errors?.paymentMethodId)}
          className="account-field-control"
          id="settlement-card"
          name="paymentMethodId"
          onChange={(event) => setPaymentMethodId(event.currentTarget.value)}
          required
          value={paymentMethodId}
        >
          <option value="">Choose a credit card</option>
          {creditCards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
        </select>
        <FieldError id="settlement-card-error" message={errors?.paymentMethodId} />
      </div>

      <div>
        <label className="account-field-label" htmlFor="settlement-account">Pay from funded account</label>
        <select
          aria-describedby={errors?.accountId ? "settlement-account-error" : errors?.currencyCode ? "settlement-currency-error" : undefined}
          aria-invalid={Boolean(errors?.accountId || errors?.currencyCode)}
          className="account-field-control"
          id="settlement-account"
          name="accountId"
          onChange={(event) => setAccountId(event.currentTarget.value)}
          required
          value={accountId}
        >
          <option value="">Choose a bank or cash account</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.accountKind} · {account.currencyCode}</option>)}
        </select>
        <FieldError id="settlement-account-error" message={errors?.accountId} />
        <p className="account-field-help">This account is debited once. Settlement currency follows its currency: {selectedAccount?.currencyCode ?? "choose an account"}.</p>
        <FieldError id="settlement-currency-error" message={errors?.currencyCode} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="account-field-label" htmlFor="settlement-amount">Settlement amount</label>
          <input
            aria-describedby={errors?.amount ? "settlement-amount-error" : undefined}
            aria-invalid={Boolean(errors?.amount)}
            autoComplete="off"
            className="account-field-control text-[20px] font-medium tabular-nums"
            id="settlement-amount"
            inputMode="decimal"
            name="amount"
            placeholder="0"
            required
            type="text"
          />
          <FieldError id="settlement-amount-error" message={errors?.amount} />
        </div>
        <div>
          <label className="account-field-label" htmlFor="settlement-date">Payment date</label>
          <input
            aria-describedby={errors?.occurredOn ? "settlement-date-error" : undefined}
            aria-invalid={Boolean(errors?.occurredOn)}
            className="account-field-control"
            defaultValue={defaultDate}
            id="settlement-date"
            name="occurredOn"
            required
            type="date"
          />
          <FieldError id="settlement-date-error" message={errors?.occurredOn} />
        </div>
      </div>

      <div>
        <label className="account-field-label" htmlFor="settlement-note">Note <span className="font-normal text-muted">· optional</span></label>
        <textarea className="account-field-control min-h-24 resize-y py-3" id="settlement-note" maxLength={4000} name="note" placeholder="For example, October card payment" />
        <FieldError id="settlement-note-error" message={errors?.note} />
      </div>

      <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={pending} type="submit">
        {pending ? "Recording settlement…" : "Record card settlement"}
      </button>
    </form>
  );
}
