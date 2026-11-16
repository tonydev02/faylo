import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CardSettlementForm } from "@/components/transactions/card-settlement-form";
import { recordCardSettlementAction } from "@/app/transactions/actions";
import { dateInTimezone } from "@/lib/transactions/presentation";
import { getUserTimezone, listTransactionSetup } from "@/lib/transactions/repository";
import { requireOwner } from "@/lib/auth/server";

export default async function CardSettlementPage() {
  const owner = await requireOwner();
  const [setupResult, timezone] = await Promise.all([
    listTransactionSetup(owner.id),
    getUserTimezone(owner.id),
  ]);
  const setup = setupResult.ok ? setupResult.value : null;
  const accounts = setup?.accounts.filter((account) => account.status === "active" && (account.accountKind === "bank" || account.accountKind === "cash")) ?? [];
  const creditCards = setup?.paymentMethods.filter((method) => method.archivedAt === null && method.methodKind === "credit_card" && method.linkedAccountId === null) ?? [];

  return (
    <AppShell activeSection="transactions" email={owner.email}>
      <div className="mx-auto max-w-[820px] space-y-7">
        <header>
          <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href="/transactions">Back to transactions</Link>
          <p className="mt-5 text-[13px] font-medium text-muted">Card settlement</p>
          <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Settle a credit card</h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted">Record the card payment as a separate cash movement. It reduces one funded account, not monthly spending.</p>
        </header>

        <aside aria-label="Credit-card tracking limitation" className="rounded-2xl border border-border border-l-2 border-l-forest bg-surface p-4 sm:p-5">
          <h2 className="text-[14px] font-medium text-ink">What Faylo tracks</h2>
          <p className="mt-2 text-[13px] leading-5 text-muted">Faylo does not track outstanding card balances or reconcile statements. This settlement changes only the selected bank or cash account; tracked assets can overstate net worth while card bills are unpaid.</p>
        </aside>

        {!setupResult.ok ? (
          <section aria-labelledby="settlement-setup-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6">
            <h2 className="text-[18px] font-medium text-ink" id="settlement-setup-error-title">Settlement setup is unavailable</h2>
            <p className="mt-2 text-[13px] leading-6 text-muted">Faylo could not load your funded accounts and payment methods. Try again after the transaction database migration is deployed.</p>
            <Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/transactions/settlement">Try again</Link>
          </section>
        ) : creditCards.length === 0 ? (
          <section aria-labelledby="settlement-card-needed-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
            <h2 className="text-[18px] font-medium text-ink" id="settlement-card-needed-title">Add a credit card first</h2>
            <p className="mt-2 text-[13px] leading-6 text-muted">Use your existing payment-method setup to add a card. Faylo will not create or estimate an outstanding card balance.</p>
            <Link className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas hover:bg-[#a0d8b8]" href="/transactions/categories">Manage payment methods</Link>
          </section>
        ) : accounts.length === 0 ? (
          <section aria-labelledby="settlement-account-needed-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
            <h2 className="text-[18px] font-medium text-ink" id="settlement-account-needed-title">Add a bank or cash account first</h2>
            <p className="mt-2 text-[13px] leading-6 text-muted">A card settlement needs an active funded account to record the cash debit.</p>
            <Link className="mt-5 inline-flex min-h-12 items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas hover:bg-[#a0d8b8]" href="/accounts/new">Add an account</Link>
          </section>
        ) : (
          <section aria-labelledby="settlement-form-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7 lg:p-8">
            <div className="mb-6 border-b border-border pb-5">
              <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink" id="settlement-form-title">Payment details</h2>
              <p className="mt-2 text-[13px] leading-5 text-muted">Choose the card and account, then enter the actual payment amount and date. The payment is excluded from expense totals.</p>
            </div>
            <CardSettlementForm
              action={recordCardSettlementAction}
              accounts={accounts}
              creditCards={creditCards}
              defaultDate={dateInTimezone(new Date(), timezone)}
              idempotencyKey={randomUUID()}
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}
