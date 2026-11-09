import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AccountSettingsForm, ArchiveAccountForm } from "@/components/accounts/account-settings-form";
import { formatBalanceAsOf, formatEffectiveBalance, formatOpeningDate } from "@/lib/accounts/presentation";
import { getAccount } from "@/lib/accounts/repository";
import { formatMoney } from "@/lib/accounts/money";
import { requireOwner } from "@/lib/auth/server";

const KIND_LABELS = { bank: "Bank account", cash: "Cash account", investment: "Investment account" } as const;

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ created?: string; saved?: string }>;
}) {
  const owner = await requireOwner();
  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const result = await getAccount(owner.id, accountId);

  if (result.ok && !result.value) notFound();

  return (
    <AppShell activeSection="accounts" email={owner.email}>
      <div className="mx-auto max-w-[1040px] space-y-7">
        <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink" href="/accounts">Back to accounts</Link>

        {!result.ok ? (
          <section aria-labelledby="account-detail-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6 sm:p-8">
            <h1 className="text-[20px] font-medium text-ink" id="account-detail-error-title">Account data is unavailable</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted">Faylo could not read this account. Check that the account database migrations are deployed to this environment.</p>
            <Link className="mt-5 inline-flex min-h-11 items-center text-[14px] font-medium text-mint underline underline-offset-4" href={`/accounts/${accountId}`}>Try again</Link>
          </section>
        ) : result.value ? (
          <>
            <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-muted">{KIND_LABELS[result.value.accountKind]}</p>
                <h1 className="mt-2 break-words text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">{result.value.name}</h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted">{result.value.currencyCode}</span>
                  <span className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted">
                    {result.value.status === "active" ? "Active" : "Archived · read-only"}
                  </span>
                </div>
              </div>
              <Link className="inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/accounts/new">Add another account</Link>
            </header>

            {query.created === "1" && <p className="account-success-message" role="status">Account created. The opening balance is a starting snapshot, not income or an expense.</p>}
            {query.saved === "1" && <p className="account-success-message" role="status">Account changes saved.</p>}

            <section aria-labelledby="current-balance-title" className="rounded-3xl border border-border border-l-[3px] border-l-forest bg-surface p-5 sm:p-7 lg:p-8">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <p className="text-[13px] font-medium text-muted">Native-currency balance</p>
                  <h2 className="mt-3 break-all text-[32px] font-medium leading-tight tracking-[-0.055em] text-ink tabular-nums sm:text-[44px]" id="current-balance-title">
                    {formatEffectiveBalance(result.value.balance, result.value.currencyCode)}
                  </h2>
                  <p className="mt-3 text-[13px] text-muted">
                    {result.value.balance === null
                      ? `Tracking begins on ${formatOpeningDate(result.value.openingAsOf)}`
                      : `Balance as of ${formatBalanceAsOf(result.value.asOf)}`}
                  </p>
                </div>
                <p className={result.value.includeInAssets ? "w-fit rounded-full border border-forest/70 bg-forest/25 px-3 py-1.5 text-[12px] font-medium text-mint" : "w-fit rounded-full border border-border bg-raised px-3 py-1.5 text-[12px] font-medium text-muted"}>
                  {result.value.includeInAssets ? "Included in tracked assets" : "Excluded from tracked assets"}
                </p>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="opening-snapshot-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="opening-snapshot-title">Opening balance snapshot</h2>
                <p className="mt-5 break-all text-[28px] font-medium leading-tight tracking-[-0.04em] text-ink tabular-nums">{formatMoney(result.value.openingBalance, result.value.currencyCode)}</p>
                <dl className="mt-5 space-y-3 border-t border-border pt-4 text-[13px]">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted">Effective date</dt>
                    <dd className="text-right font-medium text-ink">{formatOpeningDate(result.value.openingAsOf)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted">Tracking begins</dt>
                    <dd className="text-right font-medium text-ink">At midnight in your timezone on the opening date</dd>
                  </div>
                </dl>
                <p className="mt-4 text-[13px] leading-5 text-muted">The opening snapshot is the balance baseline from its effective date, not a transaction or income or expense.</p>
              </section>

              <section aria-labelledby="balance-method-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="balance-method-title">Balance information</h2>
                <dl className="mt-5 space-y-3 text-[13px]">
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
                    <dt className="text-muted">Included activity</dt>
                    <dd className="max-w-[62%] text-right font-medium leading-5 text-ink">Posted, non-voided entries effective by the as-of time</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted">Opening-date boundary</dt>
                    <dd className="text-right font-medium text-ink">Inclusive at local midnight · {formatOpeningDate(result.value.openingAsOf)}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-[13px] leading-5 text-muted">Future-effective entries are excluded until their economic effective time.</p>
              </section>
            </div>
            {result.value.accountKind === "investment" && (
              <aside aria-labelledby="investment-balance-basis" className="rounded-3xl border border-border bg-surface p-5 sm:p-6" role="note">
                <h2 className="text-[16px] font-medium text-ink" id="investment-balance-basis">Investment balance basis</h2>
                <p className="mt-2 text-[13px] leading-5 text-muted">This balance reflects the opening snapshot and posted account entries. The current database does not store manual market valuation snapshots.</p>
              </aside>
            )}

            {result.value.status === "active" ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)]">
                <section aria-labelledby="account-settings-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                  <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="account-settings-title">Account settings</h2>
                  <p className="mb-5 mt-2 text-[13px] leading-5 text-muted">The account type, currency, opening amount, and opening date are immutable.</p>
                  <AccountSettingsForm accountId={result.value.id} includeInAssets={result.value.includeInAssets} name={result.value.name} />
                </section>
                <section aria-labelledby="archive-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
                  <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="archive-title">Archive account</h2>
                  <p className="mb-5 mt-2 text-[13px] leading-5 text-muted">Archiving preserves the account and its opening snapshot. Its computed balance is available from its effective opening date; the account becomes read-only and cannot receive new activity.</p>
                  <ArchiveAccountForm accountId={result.value.id} accountName={result.value.name} />
                </section>
              </div>
            ) : (
              <aside className="rounded-3xl border border-border bg-surface p-5 sm:p-6" role="note">
                <h2 className="text-[16px] font-medium text-ink">Archived account · read-only</h2>
                <p className="mt-2 text-[13px] leading-5 text-muted">The stored opening snapshot remains visible; its computed balance becomes available from the effective opening date. Its name, tracking preference, and status cannot be changed here.</p>
              </aside>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
