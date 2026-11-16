import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { supportedCurrencies } from "@/lib/accounts/money";
import { correctTransactionAction } from "@/app/transactions/actions";
import { dateInTimezone } from "@/lib/transactions/presentation";
import { getUserTimezone, listTransactionSetup, listTransactions, type TransactionFilters } from "@/lib/transactions/repository";
import { validateTransactionId } from "@/lib/transactions/validation";
import { requireOwner } from "@/lib/auth/server";

const EMPTY_FILTERS: TransactionFilters = { search: "", kind: "all", status: "all", occurredFrom: "", occurredThrough: "" };

export default async function EditTransactionPage({ params }: { params: Promise<{ transactionId: string }> }) {
  const owner = await requireOwner();
  const { transactionId } = await params;
  if (!validateTransactionId(transactionId)) notFound();
  const [transactionResult, setupResult, timezone] = await Promise.all([
    listTransactions(owner.id, EMPTY_FILTERS, 1, transactionId),
    listTransactionSetup(owner.id),
    getUserTimezone(owner.id),
  ]);
  if (transactionResult.ok && transactionResult.value.rows.length === 0) notFound();
  const transaction = transactionResult.ok ? transactionResult.value.rows[0] : null;
  const activeCategories = setupResult.ok ? setupResult.value.categories.filter((category) => category.archivedAt === null) : [];
  const activeAccounts = setupResult.ok ? setupResult.value.accounts.filter((account) => account.status === "active") : [];
  const activeMethods = setupResult.ok
    ? setupResult.value.paymentMethods.filter((method) => method.archivedAt === null && (method.methodKind === "credit_card" ? method.linkedAccountId === null : activeAccounts.some((account) => account.id === method.linkedAccountId)))
    : [];

  return (
    <AppShell activeSection="transactions" email={owner.email}>
      <div className="mx-auto max-w-[860px] space-y-7">
        <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href={`/transactions/${transactionId}`}>Back to transaction</Link>
        <div>
          <p className="mt-2 text-[13px] font-medium text-muted">Correction</p>
          <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Correct transaction</h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted">Transactions are immutable. Faylo voids the original and posts a linked replacement in one database transaction.</p>
        </div>

        {!transactionResult.ok || !setupResult.ok ? (
          <section aria-labelledby="correction-data-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6"><h2 className="text-[18px] font-medium text-ink" id="correction-data-error-title">Correction details are unavailable</h2><p className="mt-2 text-[13px] leading-6 text-muted">The original transaction or setup data could not be loaded. No financial record was changed.</p></section>
        ) : transaction && transaction.status === "posted" && transaction.kind !== "card_settlement" ? (
          <section aria-labelledby="correction-form-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7 lg:p-8">
            <div className="mb-6 border-b border-border pb-5">
              <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink" id="correction-form-title">Replacement details</h2>
              <p className="mt-2 text-[13px] leading-5 text-muted">The active replacement is the only version included in balances and reports.</p>
            </div>
            <TransactionForm
              action={correctTransactionAction}
              categories={activeCategories}
              correcting
              currencies={supportedCurrencies()}
              defaultDate={dateInTimezone(new Date(), timezone)}
              idempotencyKey={randomUUID()}
              initialValues={{
                transactionKind: transaction.kind,
                amount: transaction.amount,
                currencyCode: transaction.currencyCode,
                occurredOn: transaction.occurredOn,
                categoryId: transaction.categoryId !== null && activeCategories.some((category) => category.id === transaction.categoryId) ? transaction.categoryId : "",
                paymentMethodId: activeMethods.some((method) => method.id === transaction.paymentMethodId) ? transaction.paymentMethodId ?? "" : "",
                merchant: transaction.merchant ?? "",
                note: transaction.note ?? "",
              }}
              paymentMethods={activeMethods.map((method) => {
                const account = activeAccounts.find((candidate) => candidate.id === method.linkedAccountId);
                return {
                  ...method,
                  accountName: account?.name ?? null,
                  accountCurrency: account?.currencyCode ?? null,
                  accountKind: account?.accountKind ?? null,
                };
              })}
              transactionId={transaction.id}
            />
          </section>
        ) : (
          <section aria-labelledby="correction-unavailable-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-8"><h2 className="text-[18px] font-medium text-ink" id="correction-unavailable-title">This transaction cannot be edited</h2><p className="mt-2 text-[13px] leading-6 text-muted">Only posted income and expenses can be corrected. Card settlements stay in history; void one with a reason if it must be reversed.</p><Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href={`/transactions/${transactionId}`}>View transaction history</Link></section>
        )}
      </div>
    </AppShell>
  );
}
