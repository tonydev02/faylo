import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { formatBalanceAsOf, formatOpeningDate } from "@/lib/accounts/presentation";
import { listAccounts, type TrackedAccount } from "@/lib/accounts/repository";
import { formatMoney } from "@/lib/accounts/money";
import { requireOwner } from "@/lib/auth/server";

function AccountCard({ account }: { account: TrackedAccount }) {
  return (
    <li>
      <Link
        className="group block rounded-3xl border border-border bg-surface p-5 transition-colors hover:border-[#414141] hover:bg-[#1b1b1b] focus-visible:outline-offset-4 sm:p-6"
        href={`/accounts/${account.id}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="break-words text-[17px] font-medium tracking-[-0.025em] text-ink">{account.name}</p>
            <p className="mt-1 text-[13px] capitalize text-muted">{account.accountKind} · {account.currencyCode}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium ${account.status === "active" ? "border-border bg-raised text-muted" : "border-[#454545] bg-[#202020] text-[#c2c7c4]"}`}>
            {account.status === "active" ? "Active" : "Archived · read-only"}
          </span>
        </div>

        <p className="mt-7 break-all text-[26px] font-medium leading-tight tracking-[-0.045em] text-ink tabular-nums sm:text-[30px]">
          {formatMoney(account.balance, account.currencyCode)}
        </p>
        <p className="mt-2 text-[13px] leading-5 text-muted">Balance as of {formatBalanceAsOf(account.asOf)}</p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4 text-[13px]">
          <span className="text-muted">Opening snapshot · {formatOpeningDate(account.openingAsOf)}</span>
          <span className={account.includeInAssets ? "text-mint" : "text-muted"}>
            {account.includeInAssets ? "Included in tracked assets" : "Excluded from tracked assets"}
          </span>
        </div>
      </Link>
    </li>
  );
}

function AccountList({ accounts, emptyTitle, emptyDescription }: { accounts: TrackedAccount[]; emptyTitle: string; emptyDescription: string }) {
  if (accounts.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-surface/50 px-5 py-10 text-center sm:px-8">
        <h3 className="text-[16px] font-medium text-ink">{emptyTitle}</h3>
        <p className="mx-auto mt-2 max-w-lg text-[14px] leading-6 text-muted">{emptyDescription}</p>
      </div>
    );
  }

  return <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">{accounts.map((account) => <AccountCard account={account} key={account.id} />)}</ul>;
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const owner = await requireOwner();
  const [result, query] = await Promise.all([listAccounts(owner.id), searchParams]);

  return (
    <AppShell activeSection="accounts" email={owner.email}>
      <div className="space-y-8 sm:space-y-10">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[13px] font-medium text-muted">Your accounts</p>
            <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Accounts</h1>
            <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted sm:text-[15px]">
              Balances stay in each account’s native currency. Tracking begins on the opening date you recorded.
            </p>
          </div>
          <Link className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-mint px-5 text-[14px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8]" href="/accounts/new">
            Add an account
          </Link>
        </header>

        {query.archived === "1" && <p className="account-success-message" role="status">Account archived. Its balance is still shown; the account is now read-only.</p>}

        {!result.ok ? (
          <section aria-labelledby="accounts-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6 sm:p-8">
            <h2 className="text-[18px] font-medium text-ink" id="accounts-error-title">Account data is unavailable</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-muted">Faylo could not read the account database. The Issue #3 and Issue #4 migrations must be applied to the intended Faylo environment before account storage is available.</p>
            <Link className="mt-5 inline-flex min-h-11 items-center text-[14px] font-medium text-mint underline underline-offset-4" href="/accounts">Try again</Link>
          </section>
        ) : (
          <>
            <section aria-labelledby="active-accounts-title" className="space-y-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink" id="active-accounts-title">Active accounts</h2>
                <span className="text-[13px] text-muted">{result.value.filter((account) => account.status === "active").length}</span>
              </div>
              <AccountList
                accounts={result.value.filter((account) => account.status === "active")}
                emptyDescription="Add a bank, cash, or investment account using a verified opening balance. No historical transactions will be created."
                emptyTitle="No accounts yet"
              />
              {result.value.length === 0 && (
                <div className="rounded-3xl border border-border border-l-[3px] border-l-forest bg-surface p-5 sm:p-6">
                  <p className="text-[14px] leading-6 text-muted">An opening balance is a starting snapshot, not income or an expense. Choose the effective date when balance tracking begins.</p>
                </div>
              )}
            </section>

            {result.value.some((account) => account.status === "archived") && (
              <section aria-labelledby="archived-accounts-title" className="space-y-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-[18px] font-medium tracking-[-0.025em] text-ink" id="archived-accounts-title">Archived accounts</h2>
                  <span className="text-[13px] text-muted">{result.value.filter((account) => account.status === "archived").length}</span>
                </div>
                <p className="text-[13px] leading-5 text-muted">Archived accounts are read-only. Their computed balances remain visible.</p>
                <AccountList accounts={result.value.filter((account) => account.status === "archived")} emptyDescription="" emptyTitle="" />
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
