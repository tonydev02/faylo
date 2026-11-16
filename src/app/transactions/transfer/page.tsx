import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AccountMovementForm } from "@/components/transactions/account-movement-form";
import { postAccountTransferAction } from "@/app/transactions/actions";
import { dateInTimezone } from "@/lib/transactions/presentation";
import { getUserTimezone, listTransactionSetup } from "@/lib/transactions/repository";
import { requireOwner } from "@/lib/auth/server";

export default async function AccountTransferPage() {
  const owner = await requireOwner();
  const [setupResult, timezone] = await Promise.all([
    listTransactionSetup(owner.id),
    getUserTimezone(owner.id),
  ]);
  const setup = setupResult.ok ? setupResult.value : null;
  const accounts = setup?.accounts.filter((account) => account.status === "active") ?? [];

  return (
    <AppShell activeSection="transactions" email={owner.email}>
      <div className="mx-auto max-w-[820px] space-y-7">
        <header>
          <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href="/transactions">Back to transactions</Link>
          <p className="mt-5 text-[13px] font-medium text-muted">Own-account movement</p>
          <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Transfer between accounts</h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted">Record both sides of money you move between your own accounts. Transfers, including investment contributions, are not income or spending.</p>
        </header>

        <aside aria-label="Transfer accounting" className="rounded-2xl border border-border border-l-2 border-l-forest bg-surface p-4 sm:p-5">
          <h2 className="text-[14px] font-medium text-ink">Actual amounts, no invented rate</h2>
          <p className="mt-2 text-[13px] leading-5 text-muted">For different currencies, enter exactly what left the source and what arrived at the destination. Faylo stores each native amount independently and does not calculate an exchange rate.</p>
        </aside>

        {!setupResult.ok ? (
          <section aria-labelledby="transfer-setup-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6">
            <h2 className="text-[18px] font-medium text-ink" id="transfer-setup-error-title">Transfer setup is unavailable</h2>
            <p className="mt-2 text-[13px] leading-6 text-muted">Faylo could not load your owned accounts. Try again after the account and transaction migrations are available.</p>
            <Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/transactions/transfer">Try again</Link>
          </section>
        ) : accounts.length < 2 ? (
          <section aria-labelledby="transfer-account-needed-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
            <h2 className="text-[18px] font-medium text-ink" id="transfer-account-needed-title">Add another active account</h2>
            <p className="mt-2 text-[13px] leading-6 text-muted">An own-account transfer needs two distinct active accounts. Bank, cash, and investment accounts can all be used.</p>
            <Link className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas hover:bg-[#a0d8b8]" href="/accounts/new">Add an account</Link>
          </section>
        ) : (
          <section aria-labelledby="transfer-form-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7 lg:p-8">
            <div className="mb-6 border-b border-border pb-5">
              <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink" id="transfer-form-title">Transfer details</h2>
              <p className="mt-2 text-[13px] leading-5 text-muted">Choose two accounts and the economic date. Review both account movements before posting.</p>
            </div>
            <AccountMovementForm mode="transfer" action={postAccountTransferAction} accounts={accounts} defaultDate={dateInTimezone(new Date(), timezone)} idempotencyKey={randomUUID()} />
          </section>
        )}
      </div>
    </AppShell>
  );
}
