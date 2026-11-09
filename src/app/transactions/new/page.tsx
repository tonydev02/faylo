import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { supportedCurrencies } from "@/lib/accounts/money";
import { dateInTimezone } from "@/lib/transactions/presentation";
import { createTransactionAction } from "@/app/transactions/actions";
import { getUserTimezone, listTransactionSetup } from "@/lib/transactions/repository";
import { requireOwner } from "@/lib/auth/server";
import type { TransactionKind } from "@/lib/transactions/validation";

export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const owner = await requireOwner();
  const [setupResult, timezone, query] = await Promise.all([
    listTransactionSetup(owner.id),
    getUserTimezone(owner.id),
    searchParams,
  ]);
  const transactionKind: TransactionKind = query.kind === "income" ? "income" : "expense";
  const setup = setupResult.ok ? setupResult.value : null;
  const activeAccounts = setup?.accounts.filter((account) => account.status === "active") ?? [];
  const activeMethods = setup?.paymentMethods.filter((method) => {
    if (method.archivedAt !== null) return false;
    if (method.methodKind === "credit_card") return method.linkedAccountId === null;
    return activeAccounts.some((account) => account.id === method.linkedAccountId);
  }) ?? [];
  const methodChoices = activeMethods.filter((method) => {
    if (transactionKind === "income") return method.methodKind !== "credit_card";
    if (method.methodKind === "credit_card") return true;
    return activeAccounts.find((account) => account.id === method.linkedAccountId)?.accountKind !== "investment";
  });
  const defaultMethod = methodChoices.find((method) => method.methodKind === "cash")
    ?? methodChoices.find((method) => method.methodKind === "debit_card")
    ?? methodChoices.find((method) => method.methodKind !== "credit_card")
    ?? methodChoices[0];
  const defaultAccount = activeAccounts.find((account) => account.id === defaultMethod?.linkedAccountId);
  const matchingCategories = setup?.categories.filter((category) => category.kind === transactionKind && category.archivedAt === null) ?? [];
  const defaultCategory = matchingCategories[0];

  return (
    <AppShell activeSection="transactions" email={owner.email}>
      <div className="mx-auto max-w-[860px] space-y-7">
        <div>
          <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href="/transactions">Back to transactions</Link>
          <p className="mt-5 text-[13px] font-medium text-muted">Quick entry</p>
          <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Add a transaction</h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted">Record the original currency and local transaction date. Account balances change only when a funded method is selected.</p>
        </div>

        {!setupResult.ok ? (
          <section aria-labelledby="transaction-setup-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6">
            <h2 className="text-[18px] font-medium text-ink" id="transaction-setup-error-title">Transaction setup is unavailable</h2>
            <p className="mt-2 text-[13px] leading-6 text-muted">Faylo could not load accounts, categories, and payment methods. Try again after the transaction database migration is deployed.</p>
            <Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/transactions/new">Try again</Link>
          </section>
        ) : (
          <>
            {activeAccounts.length === 0 && (
              <aside className="rounded-2xl border border-border border-l-2 border-l-forest bg-surface p-4 text-[13px] leading-5 text-muted">
                No active bank or cash account is available. You can record an unassigned event, but funded income or expense needs an active account and payment method. <Link className="text-mint underline underline-offset-4" href="/accounts/new">Add an account</Link>.
              </aside>
            )}
            {matchingCategories.length === 0 ? (
              <section aria-labelledby="transaction-category-needed-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
                <h2 className="text-[18px] font-medium text-ink" id="transaction-category-needed-title">Add {transactionKind === "expense" ? "an expense" : "an income"} category first</h2>
                <p className="mt-2 text-[13px] leading-6 text-muted">Income and expense events need a matching active category. Category creation is available without seed data.</p>
                <Link className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas hover:bg-[#a0d8b8]" href="/transactions/categories">Create a category</Link>
              </section>
            ) : (
              <section aria-labelledby="transaction-form-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7 lg:p-8">
                <div className="mb-6 border-b border-border pb-5">
                  <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink" id="transaction-form-title">Transaction details</h2>
                  <p className="mt-2 text-[13px] leading-5 text-muted">Use an unassigned entry when you do not know the funding account; it remains visible for reconciliation.</p>
                </div>
                <TransactionForm
                  action={createTransactionAction}
                  categories={setupResult.value.categories}
                  currencies={supportedCurrencies()}
                  defaultDate={dateInTimezone(new Date(), timezone)}
                  idempotencyKey={randomUUID()}
                  initialValues={{
                    transactionKind,
                    currencyCode: defaultAccount?.currencyCode ?? "JPY",
                    categoryId: defaultCategory.id,
                    paymentMethodId: defaultMethod?.id ?? "",
                  }}
                  paymentMethods={methodChoices.map((method) => {
                    const account = activeAccounts.find((candidate) => candidate.id === method.linkedAccountId);
                    return {
                      ...method,
                      accountName: account?.name ?? null,
                      accountCurrency: account?.currencyCode ?? null,
                      accountKind: account?.accountKind ?? null,
                    };
                  })}
                />
                <div className="mt-6 border-t border-border pt-5">
                  <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/transactions/categories">Create categories or payment methods</Link>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
