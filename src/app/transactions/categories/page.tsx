import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { TransactionSetupManager } from "@/components/transactions/setup-manager";
import { listTransactionSetup } from "@/lib/transactions/repository";
import { requireOwner } from "@/lib/auth/server";

export default async function TransactionCategoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const owner = await requireOwner();
  const [setupResult, query] = await Promise.all([listTransactionSetup(owner.id), searchParams]);
  const notices = [
    ["categoryCreated", "Category added."],
    ["categorySaved", "Category name updated."],
    ["categoryArchived", "Category archived. Existing transaction history is unchanged."],
    ["methodCreated", "Payment method added."],
    ["methodSaved", "Payment method name updated."],
    ["methodArchived", "Payment method archived. Existing transaction history is unchanged."],
  ] as const;

  return (
    <AppShell activeSection="transactions" email={owner.email}>
      <div className="mx-auto max-w-[1080px] space-y-7">
        <div>
          <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href="/transactions">Back to transactions</Link>
          <p className="mt-5 text-[13px] font-medium text-muted">Transaction setup</p>
          <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Categories and payment methods</h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted">Create the lists used for quick entry. Archive old options instead of deleting financial history.</p>
        </div>

        {!setupResult.ok ? (
          <section aria-labelledby="transaction-library-error" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6"><h2 className="text-[18px] font-medium text-ink" id="transaction-library-error">Transaction setup is unavailable</h2><p className="mt-2 text-[13px] leading-6 text-muted">Faylo could not load your accounts and transaction options. Try again after the database migration is deployed.</p><Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/transactions/categories">Try again</Link></section>
        ) : (
          <>
            {notices.map(([key, text]) => query[key] === "1" && <p className="account-success-message" key={key} role="status">{text}</p>)}
            <TransactionSetupManager accounts={setupResult.value.accounts} categories={setupResult.value.categories} paymentMethods={setupResult.value.paymentMethods} />
          </>
        )}
      </div>
    </AppShell>
  );
}
