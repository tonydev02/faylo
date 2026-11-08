import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AccountForm } from "@/components/accounts/account-form";
import { dateInTokyo } from "@/lib/accounts/validation";
import { supportedCurrencies } from "@/lib/accounts/money";
import { requireOwner } from "@/lib/auth/server";

export default async function NewAccountPage() {
  const owner = await requireOwner();

  return (
    <AppShell activeSection="accounts" email={owner.email}>
      <div className="mx-auto max-w-[880px] space-y-7">
        <div>
          <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href="/accounts">Back to accounts</Link>
          <p className="mt-5 text-[13px] font-medium text-muted">Account setup</p>
          <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Add an account</h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted sm:text-[15px]">
            Start with a verified balance and date. Faylo tracks activity from that date forward; it does not recreate past transactions.
          </p>
        </div>

        <section aria-labelledby="account-form-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7 lg:p-8">
          <div className="mb-7 border-b border-border pb-5">
            <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink" id="account-form-title">Account details</h2>
            <p className="mt-2 text-[13px] leading-5 text-muted">The account type, currency, opening amount, and opening date become immutable after creation.</p>
          </div>
          <AccountForm currencies={supportedCurrencies()} defaultDate={dateInTokyo()} />
        </section>
      </div>
    </AppShell>
  );
}
