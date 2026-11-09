import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { VoidTransactionForm } from "@/components/transactions/void-transaction-form";
import { formatRecordingTime, formatTransactionAmount, formatTransactionDate } from "@/lib/transactions/presentation";
import { listTransactions, type TransactionFilters } from "@/lib/transactions/repository";
import { validateTransactionId } from "@/lib/transactions/validation";
import { requireOwner } from "@/lib/auth/server";

const EMPTY_FILTERS: TransactionFilters = {
  search: "",
  kind: "all",
  status: "all",
  occurredFrom: "",
  occurredThrough: "",
};

export default async function TransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ transactionId: string }>;
  searchParams: Promise<{ created?: string; corrected?: string; voided?: string }>;
}) {
  const owner = await requireOwner();
  const [{ transactionId }, query] = await Promise.all([params, searchParams]);
  if (!validateTransactionId(transactionId)) notFound();
  const result = await listTransactions(owner.id, EMPTY_FILTERS, 1, transactionId);
  if (result.ok && result.value.rows.length === 0) notFound();
  const record = result.ok ? result.value.rows[0] : null;

  return (
    <AppShell activeSection="transactions" email={owner.email}>
      <div className="mx-auto max-w-[900px] space-y-7">
        <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href="/transactions">Back to transactions</Link>

        {!result.ok ? (
          <section aria-labelledby="transaction-detail-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6 sm:p-8">
            <h1 className="text-[20px] font-medium text-ink" id="transaction-detail-error-title">Transaction details are unavailable</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted">Faylo could not load this transaction. Check that the transaction database migration is deployed.</p>
            <Link className="mt-5 inline-flex min-h-11 items-center text-[14px] font-medium text-mint underline underline-offset-4" href={`/transactions/${transactionId}`}>Try again</Link>
          </section>
        ) : record ? (
          <>
            <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-muted">{record.kind === "expense" ? "Expense" : "Income"} · {record.categoryName}</p>
                <h1 className="mt-2 break-words text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">{record.merchant ?? record.categoryName}</h1>
                <p className="mt-3 text-[13px] text-muted">{formatTransactionDate(record.occurredOn)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={record.status === "posted" ? "rounded-full border border-forest/70 bg-forest/25 px-3 py-1.5 text-[12px] font-medium text-mint" : "rounded-full border border-border bg-raised px-3 py-1.5 text-[12px] font-medium text-muted"}>{record.status === "posted" ? "Posted" : record.correctedByTransactionId ? "Voided · corrected" : "Voided"}</span>
                {record.status === "posted" && <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-4 text-[13px] font-medium text-ink hover:bg-raised" href={`/transactions/${record.id}/edit`}>Edit transaction</Link>}
              </div>
            </header>

            {query.created === "1" && <p className="account-success-message" role="status">Transaction posted. The balance and monthly report use the economic date.</p>}
            {query.corrected === "1" && <p className="account-success-message" role="status">Correction saved. The original remains in history as a voided event.</p>}
            {query.voided === "1" && <p className="account-success-message" role="status">Transaction voided. Its audit details remain in history.</p>}

            <section aria-labelledby="transaction-amount-title" className="rounded-3xl border border-border border-l-[3px] border-l-forest bg-surface p-5 sm:p-7 lg:p-8">
              <p className="text-[13px] font-medium text-muted">Original currency amount</p>
              <h2 className={record.kind === "income" ? "mt-3 break-all text-[34px] font-medium leading-tight tracking-[-0.05em] text-mint tabular-nums sm:text-[46px]" : "mt-3 break-all text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink tabular-nums sm:text-[46px]"} id="transaction-amount-title">
                {formatTransactionAmount(record.amount, record.currencyCode, record.kind)}
              </h2>
              <p className="mt-3 text-[13px] leading-5 text-muted">No foreign-exchange rate is applied. This amount stays in {record.currencyCode}.</p>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="funding-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="funding-title">Payment and account movement</h2>
                {record.fundingStatus === "funded" ? (
                  <>
                    <p className="mt-5 text-[15px] font-medium text-ink">{record.fundingAccountName ?? "Tracked account"}</p>
                    <p className="mt-1 text-[13px] text-muted">{record.paymentMethodName ?? "Payment method"} · one account entry in {record.currencyCode}</p>
                    <p className="mt-4 text-[13px] leading-5 text-muted">{record.kind === "expense" ? "This funded expense decreases the selected bank or cash balance once." : "This funded income increases the selected account balance once."}</p>
                  </>
                ) : record.fundingStatus === "credit_card" ? (
                  <>
                    <p className="mt-5 text-[15px] font-medium text-ink">{record.paymentMethodName ?? "Credit card"}</p>
                    <p className="mt-1 text-[13px] text-muted">Credit-card expense · no account movement</p>
                    <p className="mt-4 text-[13px] leading-5 text-muted">This purchase counts as spending. Faylo does not track a credit-card liability or debit a bank account.</p>
                  </>
                ) : (
                  <>
                    <p className="mt-5 text-[15px] font-medium text-ink">Unassigned · needs reconciliation</p>
                    <p className="mt-4 text-[13px] leading-5 text-muted">The event is included in income or spending reports but has no account entry. It does not change a tracked balance.</p>
                  </>
                )}
              </section>

              <section aria-labelledby="transaction-details-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="transaction-details-title">Transaction details</h2>
                <dl className="mt-5 space-y-3 text-[13px]">
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3"><dt className="text-muted">Category</dt><dd className="text-right font-medium text-ink">{record.categoryName}</dd></div>
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3"><dt className="text-muted">Economic date</dt><dd className="text-right font-medium text-ink">{formatTransactionDate(record.occurredOn)}</dd></div>
                  <div className="flex items-start justify-between gap-4"><dt className="text-muted">Recorded at</dt><dd className="text-right font-medium text-ink">{formatRecordingTime(record.recordedAt)}</dd></div>
                </dl>
                {record.note && <div className="mt-5 border-t border-border pt-4"><h3 className="text-[12px] font-medium text-muted">Note</h3><p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-ink/90">{record.note}</p></div>}
              </section>
            </div>

            {record.correctionReason && (
              <aside aria-labelledby="correction-audit-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-[16px] font-medium text-ink" id="correction-audit-title">Correction audit</h2>
                <p className="mt-2 text-[13px] leading-5 text-muted">Reason: {record.correctionReason}</p>
                {record.correctedFromTransactionId && <Link className="mt-3 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href={`/transactions/${record.correctedFromTransactionId}`}>View the original transaction</Link>}
                {record.correctedByTransactionId && <Link className="mt-3 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href={`/transactions/${record.correctedByTransactionId}`}>View the replacement transaction</Link>}
              </aside>
            )}

            {record.status === "voided" && (
              <aside aria-labelledby="void-audit-title" className="rounded-3xl border border-border bg-canvas/60 p-5 sm:p-6">
                <h2 className="text-[16px] font-medium text-ink" id="void-audit-title">Voiding audit</h2>
                <p className="mt-2 text-[13px] leading-5 text-muted">{record.voidReason ?? "No reason recorded."}</p>
                {record.voidedAt && <p className="mt-2 text-[12px] text-muted">Voided at {formatRecordingTime(record.voidedAt)}</p>}
                <p className="mt-3 text-[12px] leading-5 text-muted">The original transaction and its account entry remain immutable. Voided events are excluded from current balances and income/spending totals.</p>
              </aside>
            )}

            {record.status === "posted" && (
              <section aria-labelledby="void-transaction-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-5 sm:p-6">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#d59494]">Audit action</p>
                <h2 className="mt-2 text-[17px] font-medium tracking-[-0.02em] text-ink" id="void-transaction-title">Void transaction</h2>
                <p className="mb-5 mt-2 max-w-3xl text-[13px] leading-5 text-muted">Voiding removes this event from current balances and reports while keeping its original details and account entries for audit. It cannot be undone; correct mistakes with a new replacement event.</p>
                <VoidTransactionForm transactionId={record.id} />
              </section>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
