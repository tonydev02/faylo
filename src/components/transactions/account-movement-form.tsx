"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { currencyFractionDigits, formatMoney } from "@/lib/accounts/money";
import { formatSignedAmount } from "@/lib/transactions/presentation";
import type { TrackedAccount } from "@/lib/accounts/repository";
import type { AccountMovementFormState } from "@/lib/transactions/validation";

type AccountMovementAction = (previous: AccountMovementFormState, formData: FormData) => Promise<AccountMovementFormState>;
type MovementMode = "transfer" | "adjustment";
type MovementField = "sourceAccountId" | "destinationAccountId" | "sentAmount" | "receivedAmount" | "accountId" | "amount" | "occurredOn" | "reason" | "note";

type Props = {
  mode: MovementMode;
  action: AccountMovementAction;
  accounts: TrackedAccount[];
  defaultDate: string;
  idempotencyKey: string;
};

function amountIsValid(value: string, currencyCode: string, signed: boolean): boolean {
  const pattern = signed ? /^-?(0|[1-9][0-9]*)(?:\.([0-9]+))?$/ : /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
  const match = pattern.exec(value);
  const fractionDigits = currencyFractionDigits(currencyCode);
  const normalized = value.replace(/^-/, "");
  return match !== null
    && fractionDigits !== null
    && /[1-9]/.test(normalized)
    && (normalized.split(".", 2)[1]?.length ?? 0) <= fractionDigits
    && normalized.split(".", 1)[0]!.length <= 131_072;
}

function normalizedAmount(value: string): string {
  const [whole, fraction = ""] = value.split(".", 2);
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole!;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p className="account-field-error" id={id}>{message}</p>;
}

function accountLabel(account: TrackedAccount): string {
  return `${account.name} · ${account.accountKind} · ${account.currencyCode}`;
}

export function AccountMovementForm({ mode, action, accounts, defaultDate, idempotencyKey }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [step, setStep] = useState<"details" | "review">("details");
  const [clientErrors, setClientErrors] = useState<Partial<Record<MovementField, string>>>({});
  const [sourceAccountId, setSourceAccountId] = useState(accounts[0]?.id ?? "");
  const [destinationAccountId, setDestinationAccountId] = useState(accounts[1]?.id ?? "");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [sentAmount, setSentAmount] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const sourceAccount = accounts.find((account) => account.id === sourceAccountId);
  const destinationAccount = accounts.find((account) => account.id === destinationAccountId);
  const selectedAccount = accounts.find((account) => account.id === accountId);
  const errors = { ...clientErrors, ...state.errors };
  const isTransfer = mode === "transfer";

  function reviewDetails() {
    if (!formRef.current?.reportValidity()) return;
    const nextErrors: Partial<Record<MovementField, string>> = {};
    if (isTransfer) {
      if (!sourceAccount || !destinationAccount) {
        nextErrors.sourceAccountId = "Choose two active accounts.";
      } else if (sourceAccount.id === destinationAccount.id) {
        nextErrors.destinationAccountId = "Choose a different destination account.";
      } else {
        if (!amountIsValid(sentAmount, sourceAccount.currencyCode, false)) {
          nextErrors.sentAmount = `Enter a positive amount with up to ${currencyFractionDigits(sourceAccount.currencyCode) ?? 0} ${sourceAccount.currencyCode} decimal places.`;
        }
        if (!amountIsValid(receivedAmount, destinationAccount.currencyCode, false)) {
          nextErrors.receivedAmount = `Enter a positive amount with up to ${currencyFractionDigits(destinationAccount.currencyCode) ?? 0} ${destinationAccount.currencyCode} decimal places.`;
        }
        if (sourceAccount.currencyCode === destinationAccount.currencyCode
          && amountIsValid(sentAmount, sourceAccount.currencyCode, false)
          && amountIsValid(receivedAmount, destinationAccount.currencyCode, false)
          && normalizedAmount(sentAmount) !== normalizedAmount(receivedAmount)) {
          nextErrors.receivedAmount = "Same-currency transfers must send and receive the same amount.";
        }
        if (occurredOn < sourceAccount.openingAsOf || occurredOn < destinationAccount.openingAsOf) {
          nextErrors.occurredOn = "The economic date must be on or after both accounts' opening dates.";
        }
      }
    } else if (!selectedAccount) {
      nextErrors.accountId = "Choose an active account.";
    } else {
      if (!amountIsValid(adjustmentAmount, selectedAccount.currencyCode, true)) {
        nextErrors.amount = `Enter a non-zero signed amount with up to ${currencyFractionDigits(selectedAccount.currencyCode) ?? 0} ${selectedAccount.currencyCode} decimal places.`;
      }
      if (occurredOn < selectedAccount.openingAsOf) {
        nextErrors.occurredOn = "The economic date must be on or after this account's opening date.";
      }
      if (!reason.trim()) nextErrors.reason = "Explain why this balance is being adjusted.";
      else if (reason.trim().length > 500) nextErrors.reason = "Keep the explanation to 500 characters or fewer.";
    }
    if (isTransfer && note.length > 4000) nextErrors.note = "Keep the note to 4,000 characters or fewer.";
    setClientErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) setStep("review");
  }

  function editDetails() {
    setStep("details");
    setClientErrors({});
  }

  return (
    <div className="space-y-5">
      {step === "details" ? (
        <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); reviewDetails(); }} ref={formRef}>
          {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <>
          {isTransfer ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="account-field-label" htmlFor="transfer-source">From account</label>
                <select aria-invalid={Boolean(errors.sourceAccountId)} className="account-field-control" id="transfer-source" name="sourceAccountId" onChange={(event) => setSourceAccountId(event.currentTarget.value)} required value={sourceAccountId}>
                  <option value="">Choose source account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
                </select>
                <FieldError id="transfer-source-error" message={errors.sourceAccountId} />
                {sourceAccount && <p className="account-field-help">Tracked from {sourceAccount.openingAsOf} · {sourceAccount.accountKind} account</p>}
              </div>
              <div>
                <label className="account-field-label" htmlFor="transfer-destination">To account</label>
                <select aria-describedby={errors.destinationAccountId ? "transfer-destination-error" : undefined} aria-invalid={Boolean(errors.destinationAccountId)} className="account-field-control" id="transfer-destination" name="destinationAccountId" onChange={(event) => setDestinationAccountId(event.currentTarget.value)} required value={destinationAccountId}>
                  <option value="">Choose destination account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
                </select>
                <FieldError id="transfer-destination-error" message={errors.destinationAccountId} />
                {destinationAccount && <p className="account-field-help">Tracked from {destinationAccount.openingAsOf} · {destinationAccount.accountKind} account</p>}
              </div>
              <div>
                <label className="account-field-label" htmlFor="transfer-sent-amount">Amount sent {sourceAccount ? `(${sourceAccount.currencyCode})` : ""}</label>
                <input aria-describedby={errors.sentAmount ? "transfer-sent-error" : undefined} aria-invalid={Boolean(errors.sentAmount)} autoComplete="off" className="account-field-control text-[20px] font-medium tabular-nums" id="transfer-sent-amount" inputMode="decimal" name="sentAmount" onChange={(event) => setSentAmount(event.currentTarget.value)} placeholder="0" required value={sentAmount} />
                <FieldError id="transfer-sent-error" message={errors.sentAmount} />
              </div>
              <div>
                <label className="account-field-label" htmlFor="transfer-received-amount">Amount received {destinationAccount ? `(${destinationAccount.currencyCode})` : ""}</label>
                <input aria-describedby={errors.receivedAmount ? "transfer-received-error" : undefined} aria-invalid={Boolean(errors.receivedAmount)} autoComplete="off" className="account-field-control text-[20px] font-medium tabular-nums" id="transfer-received-amount" inputMode="decimal" name="receivedAmount" onChange={(event) => setReceivedAmount(event.currentTarget.value)} placeholder="0" required value={receivedAmount} />
                <FieldError id="transfer-received-error" message={errors.receivedAmount} />
              </div>
              <div>
                <label className="account-field-label" htmlFor="transfer-date">Economic date</label>
                <input aria-describedby={errors.occurredOn ? "transfer-date-error" : undefined} aria-invalid={Boolean(errors.occurredOn)} className="account-field-control" id="transfer-date" name="occurredOn" onChange={(event) => setOccurredOn(event.currentTarget.value)} required type="date" value={occurredOn} />
                <FieldError id="transfer-date-error" message={errors.occurredOn} />
              </div>
              <div className="sm:col-span-2">
                <label className="account-field-label" htmlFor="transfer-note">Note <span className="font-normal text-muted">· optional</span></label>
                <textarea aria-describedby={errors.note ? "transfer-note-error" : undefined} aria-invalid={Boolean(errors.note)} className="account-field-control min-h-24 resize-y py-3" id="transfer-note" maxLength={4000} name="note" onChange={(event) => setNote(event.currentTarget.value)} placeholder="Add a detail for your records" value={note} />
                <FieldError id="transfer-note-error" message={errors.note} />
              </div>
              <p className="sm:col-span-2 rounded-2xl border border-border bg-canvas/50 p-4 text-[13px] leading-5 text-muted">Enter the actual amount sent and the actual amount received. For different currencies, Faylo stores each native amount independently and does not calculate an exchange rate.</p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="account-field-label" htmlFor="adjustment-account">Account</label>
                <select aria-describedby={errors.accountId ? "adjustment-account-error" : undefined} aria-invalid={Boolean(errors.accountId)} className="account-field-control" id="adjustment-account" name="accountId" onChange={(event) => setAccountId(event.currentTarget.value)} required value={accountId}>
                  <option value="">Choose account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
                </select>
                <FieldError id="adjustment-account-error" message={errors.accountId} />
                {selectedAccount && <p className="account-field-help">Tracked from {selectedAccount.openingAsOf} · opening balances cannot be changed.</p>}
              </div>
              <div>
                <label className="account-field-label" htmlFor="adjustment-amount">Signed amount {selectedAccount ? `(${selectedAccount.currencyCode})` : ""}</label>
                <input aria-describedby={errors.amount ? "adjustment-amount-error" : undefined} aria-invalid={Boolean(errors.amount)} autoComplete="off" className="account-field-control text-[20px] font-medium tabular-nums" id="adjustment-amount" inputMode="decimal" name="amount" onChange={(event) => setAdjustmentAmount(event.currentTarget.value)} placeholder="500 or -500" required value={adjustmentAmount} />
                <FieldError id="adjustment-amount-error" message={errors.amount} />
                <p className="account-field-help">Use a positive amount to increase the balance or a minus sign to decrease it.</p>
              </div>
              <div>
                <label className="account-field-label" htmlFor="adjustment-date">Economic date</label>
                <input aria-describedby={errors.occurredOn ? "adjustment-date-error" : undefined} aria-invalid={Boolean(errors.occurredOn)} className="account-field-control" id="adjustment-date" name="occurredOn" onChange={(event) => setOccurredOn(event.currentTarget.value)} required type="date" value={occurredOn} />
                <FieldError id="adjustment-date-error" message={errors.occurredOn} />
              </div>
              <div className="sm:col-span-2">
                <label className="account-field-label" htmlFor="adjustment-reason">Why is the balance changing?</label>
                <textarea aria-describedby={errors.reason ? "adjustment-reason-error" : undefined} aria-invalid={Boolean(errors.reason)} className="account-field-control min-h-24 resize-y py-3" id="adjustment-reason" maxLength={500} name="reason" onChange={(event) => setReason(event.currentTarget.value)} placeholder="Explain the reconciliation or correction" required value={reason} />
                <FieldError id="adjustment-reason-error" message={errors.reason} />
              </div>
              <p className="sm:col-span-2 rounded-2xl border border-border bg-canvas/50 p-4 text-[13px] leading-5 text-muted">This signed adjustment is an auditable balance movement, not income or spending. The opening balance and its date remain unchanged.</p>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={pending || (isTransfer ? accounts.length < 2 : accounts.length === 0)} type="submit">
              {isTransfer ? "Review transfer" : "Review adjustment"}
            </button>
            <Link className="inline-flex min-h-12 items-center justify-center px-4 text-[14px] font-medium text-muted underline underline-offset-4 hover:text-ink" href="/transactions">Cancel</Link>
          </div>
        </>
        </form>
      ) : (
        <form action={formAction} className="space-y-5">
          {state.message && <p className="account-form-message" role="alert">{state.message}</p>}
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <>
          {isTransfer && sourceAccount && destinationAccount ? (
            <>
              <input name="sourceAccountId" type="hidden" value={sourceAccountId} />
              <input name="destinationAccountId" type="hidden" value={destinationAccountId} />
              <input name="sentAmount" type="hidden" value={sentAmount} />
              <input name="receivedAmount" type="hidden" value={receivedAmount} />
              <input name="occurredOn" type="hidden" value={occurredOn} />
              <input name="note" type="hidden" value={note} />
              <section aria-labelledby="transfer-review-title" className="rounded-2xl border border-border bg-canvas/60 p-5 sm:p-6">
                <h2 className="text-[17px] font-medium text-ink" id="transfer-review-title">Review transfer</h2>
                <dl className="mt-5 space-y-4 text-[13px]">
                  <div className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between"><dt className="text-muted">From · {sourceAccount.name}</dt><dd className="font-semibold tabular-nums text-ink">−{formatMoney(sentAmount, sourceAccount.currencyCode)}</dd></div>
                  <div className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between"><dt className="text-muted">To · {destinationAccount.name}</dt><dd className="font-semibold tabular-nums text-mint">+{formatMoney(receivedAmount, destinationAccount.currencyCode)}</dd></div>
                  <div className="flex items-start justify-between gap-4"><dt className="text-muted">Economic date</dt><dd className="font-medium text-ink">{occurredOn}</dd></div>
                </dl>
                {sourceAccount.currencyCode !== destinationAccount.currencyCode && <p className="mt-5 rounded-xl border border-border bg-surface p-4 text-[13px] leading-5 text-muted">Actual amounts in {sourceAccount.currencyCode} and {destinationAccount.currencyCode}. No exchange rate is inferred or recorded.</p>}
                {note && <p className="mt-4 border-t border-border pt-4 text-[13px] leading-5 text-muted">Note: {note}</p>}
              </section>
            </>
          ) : !isTransfer && selectedAccount ? (
            <>
              <input name="accountId" type="hidden" value={accountId} />
              <input name="amount" type="hidden" value={adjustmentAmount} />
              <input name="occurredOn" type="hidden" value={occurredOn} />
              <input name="reason" type="hidden" value={reason} />
              <section aria-labelledby="adjustment-review-title" className="rounded-2xl border border-border bg-canvas/60 p-5 sm:p-6">
                <h2 className="text-[17px] font-medium text-ink" id="adjustment-review-title">Review balance adjustment</h2>
                <dl className="mt-5 space-y-4 text-[13px]">
                  <div className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between"><dt className="text-muted">Account · {selectedAccount.name}</dt><dd className="font-semibold tabular-nums text-ink">{formatSignedAmount(adjustmentAmount, selectedAccount.currencyCode)}</dd></div>
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-4"><dt className="text-muted">Economic date</dt><dd className="font-medium text-ink">{occurredOn}</dd></div>
                  <div><dt className="text-muted">Explanation</dt><dd className="mt-1 whitespace-pre-wrap font-medium text-ink">{reason}</dd></div>
                </dl>
                <p className="mt-5 text-[13px] leading-5 text-muted">This event changes the derived account balance only. It will not alter the immutable opening balance or income and spending totals.</p>
              </section>
            </>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-wait disabled:opacity-60 sm:w-auto" disabled={pending || (isTransfer ? !sourceAccount || !destinationAccount : !selectedAccount)} type="submit">
              {pending ? "Posting movement…" : isTransfer ? "Confirm and post transfer" : "Confirm and post adjustment"}
            </button>
            <button className="inline-flex min-h-12 items-center justify-center px-4 text-[14px] font-medium text-muted underline underline-offset-4 hover:text-ink" disabled={pending} onClick={editDetails} type="button">Edit details</button>
          </div>
        </>
          </form>
      )}
    </div>
  );
}
