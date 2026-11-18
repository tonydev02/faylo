"use client";

import { useState } from "react";
import { useActionState } from "react";
import { formatMoney } from "@/lib/accounts/money";
import { multiplyDecimalAndRoundToInteger, isPositiveDecimal } from "@/lib/transactions/fx-decimal";
import type { ReportingFxSnapshot, ReportingFxStatus } from "@/lib/transactions/fx-types";
import { retryReportingFxAction, saveReportingFxOverrideAction } from "@/app/transactions/actions";
import type { ReportingFxFormState } from "@/lib/transactions/fx-validation";

type Props = {
  transactionId: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  transactionStatus: "posted" | "voided";
  snapshot: ReportingFxSnapshot | null;
  history: ReportingFxSnapshot[];
  today: string;
  idempotencyKey: string;
};

function currentStatus(snapshot: ReportingFxSnapshot | null, currencyCode: string, occurredOn: string, today: string): ReportingFxStatus {
  if (snapshot?.status === "pending_future" && occurredOn <= today) return "unresolved";
  return snapshot?.status ?? (currencyCode !== "JPY" && occurredOn > today ? "pending_future" : "unresolved");
}

function statusLabel(status: ReportingFxStatus): string {
  if (status === "resolved") return "Resolved reference conversion";
  if (status === "pending_future") return "Pending · future-effective";
  if (status === "unavailable") return "Unavailable · no eligible historical rate";
  return "Unresolved · lookup needs attention";
}

function sourceLabel(snapshot: ReportingFxSnapshot): string {
  if (snapshot.sourceKind === "manual") return "Manual reporting override";
  if (snapshot.sourceKind === "identity") return "JPY identity conversion";
  if (snapshot.sourceKind === "frankfurter_blended") return "Frankfurter blended reference";
  return "No applied rate";
}

function revisionAmount(snapshot: ReportingFxSnapshot): string {
  if (snapshot.status !== "resolved" || snapshot.convertedAmountJpy === null) return statusLabel(snapshot.status);
  return formatMoney(snapshot.convertedAmountJpy, "JPY");
}

function earliestEligibleRateDate(occurredOn: string): string {
  const date = new Date(`${occurredOn}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

export function ReportingFxPanel({
  transactionId,
  amount,
  currencyCode,
  occurredOn,
  transactionStatus,
  snapshot,
  history,
  today,
  idempotencyKey,
}: Props) {
  const [state, formAction, pending] = useActionState(
    saveReportingFxOverrideAction,
    {} satisfies ReportingFxFormState,
  );
  const [rate, setRate] = useState("");
  const [formKey] = useState(idempotencyKey);
  const status = currentStatus(snapshot, currencyCode, occurredOn, today);
  const eligible = occurredOn <= today;
  const canEdit = transactionStatus === "posted" && currencyCode !== "JPY" && eligible;
  const canRetry = canEdit && (status === "unavailable" || status === "unresolved");
  let preview: string | null = null;
  if (isPositiveDecimal(rate)) {
    try {
      preview = multiplyDecimalAndRoundToInteger(amount, rate);
    } catch {
      preview = null;
    }
  }

  return (
    <section aria-labelledby="reporting-fx-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-muted">JPY reporting · reference only</p>
          <h2 className="mt-1 text-[17px] font-medium tracking-[-0.02em] text-ink" id="reporting-fx-title">Reporting conversion</h2>
        </div>
        <span className={status === "resolved" ? "rounded-full border border-forest/70 bg-forest/25 px-3 py-1.5 text-[11px] font-medium text-mint" : "rounded-full border border-border bg-raised px-3 py-1.5 text-[11px] font-medium text-muted"}>
          {statusLabel(status)}
        </span>
      </div>

      {status === "resolved" && snapshot ? (
        <>
          <p className="mt-5 break-words text-[30px] font-semibold leading-tight tracking-[-0.04em] text-ink tabular-nums sm:text-[36px]">
            {snapshot.convertedAmountJpy === null ? "Reference amount unavailable" : formatMoney(snapshot.convertedAmountJpy, "JPY")}
          </p>
          <p className="mt-2 text-[13px] text-muted">JPY equivalent · the original {currencyCode} amount remains primary.</p>
          <dl className="mt-5 grid gap-3 border-t border-border pt-4 text-[12px] sm:grid-cols-2">
            <div><dt className="text-muted">Rate direction</dt><dd className="mt-1 break-all font-medium text-ink">1 {currencyCode} = {snapshot.rateToJpy} JPY</dd></div>
            <div><dt className="text-muted">Source</dt><dd className="mt-1 font-medium text-ink">{sourceLabel(snapshot)}</dd></div>
            <div><dt className="text-muted">Rate effective date</dt><dd className="mt-1 font-medium text-ink">{snapshot.rateEffectiveOn ?? "Not available"}</dd></div>
            <div><dt className="text-muted">{snapshot.sourceKind === "manual" ? "Entered at" : "Fetched at"}</dt><dd className="mt-1 font-medium text-ink">{snapshot.fetchedAt ?? snapshot.createdAt}</dd></div>
          </dl>
          {snapshot.providerSources.length > 0 && <p className="mt-3 text-[11px] leading-5 text-muted">Contributing sources: {snapshot.providerSources.join(", ")}</p>}
          {snapshot.overrideNote && <p className="mt-3 rounded-xl border border-border bg-canvas/70 p-3 text-[12px] leading-5 text-muted"><span className="font-medium text-ink">Override explanation:</span> {snapshot.overrideNote}</p>}
        </>
      ) : status === "pending_future" ? (
        <p className="mt-4 rounded-2xl border border-border bg-canvas/70 p-4 text-[13px] leading-6 text-muted">
          This foreign-currency transaction is future-effective. No rate lookup has been made; historical conversion becomes eligible on {occurredOn} in Asia/Tokyo. It does not affect today&apos;s JPY totals or unresolved counts.
        </p>
      ) : status === "unavailable" ? (
        <p className="mt-4 rounded-2xl border border-border bg-canvas/70 p-4 text-[13px] leading-6 text-muted">
          No Frankfurter observation met the seven-day historical window. Faylo does not substitute a current rate or show ¥0. The native amount remains unchanged.
        </p>
      ) : (
        <p className="mt-4 rounded-2xl border border-border bg-canvas/70 p-4 text-[13px] leading-6 text-muted">
          No resolved historical conversion is available. A provider error or missing snapshot does not affect the native transaction amount; retry or enter a manual reporting rate.
        </p>
      )}

      {canRetry && (
        <form action={retryReportingFxAction} className="mt-4">
          <input name="transactionId" type="hidden" value={transactionId} />
          <button className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-raised px-4 text-[13px] font-medium text-ink transition-colors hover:bg-[#282828]" type="submit">
            Retry historical lookup
          </button>
        </form>
      )}

      {canEdit && (
        <details className="mt-5 border-t border-border pt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-medium text-mint underline decoration-forest underline-offset-4">Edit reporting rate</summary>
          <p className="mt-2 text-[12px] leading-5 text-muted">This changes only the reference conversion. It is not an executed transfer or settlement rate. Choose the rate&apos;s actual effective date and explain the override.</p>
          <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <input name="transactionId" type="hidden" value={transactionId} />
            <input name="idempotencyKey" type="hidden" value={formKey} />
            <div>
              <label className="account-field-label" htmlFor={`fx-rate-${transactionId}`}>JPY per 1 {currencyCode}</label>
              <input aria-invalid={Boolean(state.errors?.rate)} className="account-field-control" id={`fx-rate-${transactionId}`} inputMode="decimal" name="rate" onChange={(event) => setRate(event.target.value)} placeholder="For example, 150.25" required type="text" value={rate} />
              {state.errors?.rate && <p className="account-field-error">{state.errors.rate}</p>}
            </div>
            <div>
              <label className="account-field-label" htmlFor={`fx-date-${transactionId}`}>Rate effective date</label>
              <input aria-invalid={Boolean(state.errors?.effectiveOn)} className="account-field-control" id={`fx-date-${transactionId}`} max={occurredOn} min={earliestEligibleRateDate(occurredOn)} name="effectiveOn" required type="date" />
              {state.errors?.effectiveOn && <p className="account-field-error">{state.errors.effectiveOn}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="account-field-label" htmlFor={`fx-note-${transactionId}`}>Why are you overriding the reporting rate?</label>
              <textarea aria-invalid={Boolean(state.errors?.note)} className="account-field-control min-h-24 resize-y py-3" id={`fx-note-${transactionId}`} maxLength={500} name="note" placeholder="Explain the reference-rate correction" required />
              {state.errors?.note && <p className="account-field-error">{state.errors.note}</p>}
            </div>
            {preview !== null && <p aria-live="polite" className="rounded-xl border border-border bg-canvas/70 p-3 text-[13px] text-muted sm:col-span-2">Preview · {amount} {currencyCode} × {rate} = <span className="font-semibold text-ink">{formatMoney(preview, "JPY")}</span> JPY, rounded per transaction</p>}
            {state.message && <p className="account-form-message sm:col-span-2" role="alert">{state.message}</p>}
            <button className="inline-flex min-h-12 items-center justify-center rounded-xl bg-mint px-5 text-[13px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8] disabled:cursor-wait disabled:opacity-60 sm:col-span-2 sm:justify-self-start" disabled={pending} type="submit">
              {pending ? "Saving FX revision…" : "Save manual reporting rate"}
            </button>
          </form>
        </details>
      )}

      {history.length > 0 && (
        <details className="mt-5 border-t border-border pt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-medium text-ink">Revision history · {history.length} {history.length === 1 ? "revision" : "revisions"}</summary>
          <ol className="mt-2 divide-y divide-border">
            {history.map((revision) => (
              <li className="py-3" key={revision.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[12px] font-medium text-ink">Revision {revision.revision} · {sourceLabel(revision)}</p>
                  <p className="text-[12px] tabular-nums text-muted">{revisionAmount(revision)}</p>
                </div>
                {revision.rateToJpy && <p className="mt-1 text-[11px] text-muted">1 {currencyCode} = {revision.rateToJpy} JPY · effective {revision.rateEffectiveOn}</p>}
                <p className="mt-1 text-[11px] text-muted">{revision.sourceKind === "manual" ? "Entered at" : "Fetched at"} {revision.fetchedAt ?? revision.createdAt}</p>
                {revision.overrideNote && <p className="mt-1 text-[11px] leading-5 text-muted">Explanation: {revision.overrideNote}</p>}
                {revision.resolutionReason && <p className="mt-1 text-[11px] leading-5 text-muted">{revision.resolutionReason}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
