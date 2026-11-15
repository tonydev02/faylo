"use client";

import { useActionState } from "react";
import { voidTransactionAction } from "@/app/transactions/actions";
import type { TransactionFormState } from "@/lib/transactions/validation";

export function VoidTransactionForm({ transactionId }: { transactionId: string }) {
  const [state, formAction, pending] = useActionState(voidTransactionAction, {} satisfies TransactionFormState);
  return (
    <form action={formAction} className="space-y-4">
      {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
      <input name="transactionId" type="hidden" value={transactionId} />
      <div>
        <label className="account-field-label" htmlFor="void-reason">Reason for voiding</label>
        <textarea className="account-field-control min-h-24 resize-y py-3" id="void-reason" maxLength={500} name="reason" placeholder="Explain why this posted transaction is invalid" required />
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[13px] leading-5 text-muted">
        <input className="account-checkbox mt-0.5" name="confirmVoid" required type="checkbox" value="on" />
        <span>I understand this keeps the original event in history but removes it from current balance and income/spending calculations.</span>
      </label>
      <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-[#633f3f] bg-[#251919] px-4 text-[14px] font-semibold text-[#f2c5c5] transition-colors hover:bg-[#382222] disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={pending} type="submit">{pending ? "Voiding transaction…" : "Void transaction"}</button>
    </form>
  );
}
