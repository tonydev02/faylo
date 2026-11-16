import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { VoidTransactionForm } from "@/components/transactions/void-transaction-form";
import { formatRecordingTime, formatSignedAmount, formatTransactionAmount, formatTransactionDate } from "@/lib/transactions/presentation";
import { getUserTimezone, listTransactions, type TransactionFilters, type TransactionRecord } from "@/lib/transactions/repository";
import { validateTransactionId } from "@/lib/transactions/validation";
import { requireOwner } from "@/lib/auth/server";

const EMPTY_FILTERS: TransactionFilters = {
  search: "",
  kind: "all",
  status: "all",
  occurredFrom: "",
  occurredThrough: "",
};

function transactionTitle(record: TransactionRecord): string {
  if (record.kind === "transfer") {
    const [source, destination] = record.accountMovements;
    return source && destination ? `${source.accountName} → ${destination.accountName}` : "Own-account transfer";
  }
  if (record.kind === "balance_adjustment") return "Balance adjustment";
  return record.merchant ?? record.categoryName;
}

export default async function TransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ transactionId: string }>;
  searchParams: Promise<{ created?: string; settled?: string; transferred?: string; adjusted?: string; corrected?: string; voided?: string }>;
}) {
  const owner = await requireOwner();
  const [{ transactionId }, query] = await Promise.all([params, searchParams]);
  if (!validateTransactionId(transactionId)) notFound();
  const [result, timezone] = await Promise.all([
    listTransactions(owner.id, EMPTY_FILTERS, 1, transactionId),
    getUserTimezone(owner.id),
  ]);
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
                <p className="text-[13px] font-medium text-muted">{record.kind === "transfer" ? "Own-account transfer · excluded from income and spending" : record.kind === "balance_adjustment" ? "Balance adjustment · excluded from income and spending" : record.kind === "card_settlement" ? `Card settlement · ${record.paymentMethodName ?? "credit card"}` : `${record.kind === "expense" ? "Expense" : "Income"} · ${record.categoryName}`}</p>
                <h1 className="mt-2 break-words text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">{transactionTitle(record)}</h1>
                <p className="mt-3 text-[13px] text-muted">Economic date · {formatTransactionDate(record.occurredOn)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={record.status === "posted" ? "rounded-full border border-forest/70 bg-forest/25 px-3 py-1.5 text-[12px] font-medium text-mint" : "rounded-full border border-border bg-raised px-3 py-1.5 text-[12px] font-medium text-muted"}>{record.status === "posted" ? "Posted" : record.correctedByTransactionId ? "Voided · corrected" : "Voided"}</span>
                {(record.kind === "income" || record.kind === "expense") && record.status === "posted" && record.source === "manual" && <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-4 text-[13px] font-medium text-ink hover:bg-raised" href={`/transactions/${record.id}/edit`}>Edit transaction</Link>}
              </div>
            </header>

            {query.created === "1" && <p className="account-success-message" role="status">Transaction posted. Account balances and monthly totals use the economic date.</p>}
            {query.settled === "1" && <p className="account-success-message" role="status">Card settlement recorded. The selected account balance reflects it from the payment date; spending totals are unchanged.</p>}
            {query.transferred === "1" && <p className="account-success-message" role="status">Transfer posted. Both actual account movements are recorded; income and spending totals are unchanged.</p>}
            {query.adjusted === "1" && <p className="account-success-message" role="status">Balance adjustment posted with its explanation. The opening balance remains unchanged.</p>}
            {query.corrected === "1" && <p className="account-success-message" role="status">Correction saved. The original remains in history as a voided event.</p>}
            {query.voided === "1" && <p className="account-success-message" role="status">Transaction voided. Its audit details remain in history and derived balances no longer include its entries.</p>}

            <section aria-labelledby="transaction-amount-title" className="rounded-3xl border border-border border-l-[3px] border-l-forest bg-surface p-5 sm:p-7 lg:p-8">
              {record.kind === "transfer" ? (
                <>
                  <p className="text-[13px] font-medium text-muted">Actual native-currency movements</p>
                  <h2 className="mt-3 text-[24px] font-medium leading-tight tracking-[-0.04em] text-ink sm:text-[30px]" id="transaction-amount-title">Amounts sent and received</h2>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {record.accountMovements.map((movement) => <div className="rounded-2xl border border-border bg-canvas/60 p-4" key={movement.accountId}><p className="text-[12px] text-muted">{movement.amount.startsWith("-") ? "Sent from" : "Received by"}</p><p className="mt-1 truncate text-[14px] font-medium text-ink">{movement.accountName}</p><p className="mt-3 break-all text-[20px] font-semibold tabular-nums text-ink">{formatSignedAmount(movement.amount, movement.currencyCode)}</p></div>)}
                  </div>
                  <p className="mt-4 text-[13px] leading-5 text-muted">Each side is stored in its account&apos;s currency. Faylo does not infer or record an exchange rate; transfers do not count as income or spending.</p>
                </>
              ) : (
                <>
                  <p className="text-[13px] font-medium text-muted">{record.kind === "balance_adjustment" ? "Signed adjustment amount" : "Original currency amount"}</p>
                  <h2 className={record.kind === "income" ? "mt-3 break-all text-[34px] font-medium leading-tight tracking-[-0.05em] text-mint tabular-nums sm:text-[46px]" : "mt-3 break-all text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink tabular-nums sm:text-[46px]"} id="transaction-amount-title">
                    {record.amount !== null && record.currencyCode !== null ? formatTransactionAmount(record.amount, record.currencyCode, record.kind) : "Amount unavailable"}
                  </h2>
                  <p className="mt-3 text-[13px] leading-5 text-muted">{record.kind === "balance_adjustment" ? "This signed account movement is excluded from income and spending." : record.currencyCode ? `No foreign-exchange rate is applied. This amount stays in ${record.currencyCode}.` : "No account-currency amount is available."}</p>
                </>
              )}
            </section>

              <div className="grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="funding-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="funding-title">Account movement</h2>
                {record.kind === "transfer" || record.kind === "balance_adjustment" ? (
                  <>
                    <ul className="mt-5 divide-y divide-border">
                      {record.accountMovements.map((movement) => (
                        <li className="flex items-center justify-between gap-4 py-3" key={movement.accountId}>
                          <div className="min-w-0">
                            <p className="text-[12px] text-muted">{record.kind === "transfer" ? movement.amount.startsWith("-") ? "Source account" : "Destination account" : movement.amount.startsWith("-") ? "Balance decrease" : "Balance increase"}</p>
                            <p className="mt-1 truncate text-[14px] font-medium text-ink">{movement.accountName}</p>
                            <p className="mt-1 text-[11px] text-muted">Recorded {formatRecordingTime(movement.recordedAt, timezone)}</p>
                          </div>
                          <p className="shrink-0 text-right text-[14px] font-semibold tabular-nums text-ink">{formatSignedAmount(movement.amount, movement.currencyCode)}</p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-[13px] leading-5 text-muted">{record.kind === "transfer" ? "Investment contributions and other own-account transfers are not spending." : "This adjustment changes the derived balance only; its opening snapshot is immutable."}</p>
                  </>
                ) : record.kind === "card_settlement" ? (
                  <>
                    <p className="mt-5 text-[15px] font-medium text-ink">{record.paymentMethodName ?? "Credit card"}</p>
                    <p className="mt-1 text-[13px] text-muted">Paid from {record.fundingAccountName ?? "tracked account"} · one debit in {record.currencyCode ?? "the account currency"}</p>
                    <p className="mt-4 text-[13px] leading-5 text-muted">This settlement reduces the selected account and is excluded from income and spending. Faylo does not track outstanding credit-card balances.</p>
                  </>
                ) : record.fundingStatus === "funded" ? (
                  <>
                    <p className="mt-5 text-[15px] font-medium text-ink">{record.fundingAccountName ?? "Tracked account"}</p>
                    <p className="mt-1 text-[13px] text-muted">{record.paymentMethodName ?? "Payment method"} · one account entry in {record.currencyCode ?? "the account currency"}</p>
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
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3"><dt className="text-muted">Category</dt><dd className="text-right font-medium text-ink">{record.kind === "card_settlement" || record.kind === "transfer" || record.kind === "balance_adjustment" ? "Not applicable · excluded from income and spending" : record.categoryName}</dd></div>
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3"><dt className="text-muted">Economic date</dt><dd className="text-right font-medium text-ink">{formatTransactionDate(record.occurredOn)}</dd></div>
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3"><dt className="text-muted">Effective time · {timezone}</dt><dd className="text-right font-medium text-ink">{formatRecordingTime(record.occurredAt, timezone)}</dd></div>
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3"><dt className="text-muted">Recorded at · {timezone}</dt><dd className="text-right font-medium text-ink">{formatRecordingTime(record.recordedAt, timezone)}</dd></div>
                  <div className="flex items-start justify-between gap-4"><dt className="text-muted">Source</dt><dd className="text-right font-medium capitalize text-ink">{record.source}</dd></div>
                </dl>
                {record.note && <div className="mt-5 border-t border-border pt-4"><h3 className="text-[12px] font-medium text-muted">Note</h3><p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-ink/90">{record.note}</p></div>}
              </section>
            </div>

            {record.kind === "balance_adjustment" && record.adjustmentReason && (
              <aside aria-labelledby="adjustment-audit-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-[16px] font-medium text-ink" id="adjustment-audit-title">Adjustment explanation</h2>
                <p className="mt-2 text-[13px] leading-5 text-muted">{record.adjustmentReason}</p>
              </aside>
            )}

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
                {record.voidedAt && <p className="mt-2 text-[12px] text-muted">Voided at {formatRecordingTime(record.voidedAt, timezone)} · {record.voidedBy ? "voided by the owner" : "actor unavailable"}</p>}
                <p className="mt-3 text-[12px] leading-5 text-muted">The original transaction and immutable account entries remain for audit. Voided events no longer affect derived balances or income/spending totals.</p>
              </aside>
            )}

            {record.status === "posted" && (
              <section aria-labelledby="void-transaction-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-5 sm:p-6">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#d59494]">Audit action</p>
                <h2 className="mt-2 text-[17px] font-medium tracking-[-0.02em] text-ink" id="void-transaction-title">Void transaction</h2>
                <p className="mb-5 mt-2 max-w-3xl text-[13px] leading-5 text-muted">Voiding removes the event from derived balances and reports while preserving its original details and account entries. It cannot be undone; post a new event if you need a replacement.</p>
                <VoidTransactionForm transactionId={record.id} />
              </section>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
