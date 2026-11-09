import Link from "next/link";
import { AppShell, Icon } from "@/components/app-shell";
import { requireOwner } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const overviewCards = [
  { label: "Tracked assets", detail: "Balances remain in each account currency" },
  { label: "Income", detail: "Transaction entry is not available yet" },
  { label: "Spending", detail: "Transaction entry is not available yet" },
];

function MetricCard({ label, detail }: { label: string; detail: string }) {
  return (
    <section aria-label={`${label} placeholder`} className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted">{label}</h2>
        <span className="size-1.5 rounded-full bg-muted/70" />
      </div>
      <p aria-label="Not available yet" className="mt-5 text-[32px] font-medium leading-none tracking-[-0.055em] text-ink/75">—</p>
      <p className="mt-3 text-[12px] text-muted">{detail}</p>
    </section>
  );
}

function Principle({ number, title, children }: { number: string; title: string; children: string }) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-raised text-[12px] font-medium text-muted">{number}</span>
      <div>
        <h3 className="text-[13px] font-medium text-ink/90">{title}</h3>
        <p className="mt-1 text-xs leading-[1.7] text-muted">{children}</p>
      </div>
    </li>
  );
}

export default async function HomePage() {
  const owner = await requireOwner();

  return (
    <AppShell email={owner.email}>
      <div className="space-y-7 sm:space-y-8">
        <section aria-labelledby="page-title" className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-[12px] font-medium text-muted">
              <span className="size-1.5 rounded-full bg-muted" />
              Personal finance · private workspace
            </p>
            <h1 id="page-title" className="mt-4 max-w-[650px] text-[38px] font-medium leading-[1.08] tracking-[-0.055em] text-ink sm:text-[48px] lg:text-[56px]">
              A clearer view of your money.
            </h1>
            <p className="mt-4 max-w-xl text-[14px] leading-7 text-muted sm:text-[15px]">
              Enter opening balances to begin tracking each account from its effective date. Faylo does not reconstruct earlier transactions.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-[12px] font-medium text-muted">
            <Icon className="size-4 text-muted" name="shield" />
            Google identity verified
          </span>
        </section>

        <section aria-labelledby="setup-title" className="rounded-[28px] border border-border border-l-[3px] border-l-forest bg-surface p-5 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-forest/60 bg-forest/25 text-mint">
                  <Icon className="size-5" name="accounts" />
                </span>
                <p className="text-[12px] font-medium text-muted">Account setup</p>
              </div>
              <h2 className="mt-5 text-[22px] font-medium tracking-[-0.04em] text-ink sm:text-[25px]" id="setup-title">Start with a verified balance.</h2>
              <p className="mt-2 max-w-xl text-[14px] leading-6 text-muted">
                Add a bank, cash, or investment account. Its opening balance is a starting snapshot, never income or an expense.
              </p>
            </div>
            <Link className="inline-flex min-h-12 w-fit shrink-0 items-center gap-3 rounded-2xl bg-mint px-4 text-[14px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8]" href="/accounts/new">
              Add an account
              <Icon className="size-4" name="arrow" />
            </Link>
          </div>
        </section>

        <section aria-label="Financial overview placeholders" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          {overviewCards.map((card) => <MetricCard key={card.label} {...card} />)}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
          <section aria-labelledby="activity-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[12px] font-medium text-muted">Your timeline</p>
                <h2 id="activity-title" className="mt-2 text-lg font-medium tracking-[-0.035em] text-ink">Recent activity</h2>
              </div>
              <span className="rounded-full border border-border bg-raised px-2.5 py-1 text-[11px] font-medium text-muted">Placeholder</span>
            </div>
            <div className="mt-6 flex min-h-[174px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/90 bg-canvas/25 px-5 text-center">
              <span className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted">
                <Icon className="size-[18px]" name="activity" />
              </span>
              <h3 className="mt-3 text-[13px] font-medium text-ink/90">Your activity will appear here</h3>
              <p className="mt-1.5 max-w-sm text-[12px] leading-5 text-muted">Transaction entry is not available yet. Account opening snapshots do not create activity.</p>
            </div>
          </section>

          <section aria-labelledby="principles-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl border border-forest/60 bg-forest/25 text-mint">
                <Icon className="size-[18px]" name="shield" />
              </span>
              <div>
                <p className="text-[12px] font-medium text-muted">Built around your rules</p>
                <h2 id="principles-title" className="mt-1 text-[15px] font-medium tracking-[-0.02em] text-ink">A thoughtful beginning</h2>
              </div>
            </div>
            <ol className="mt-6 space-y-5">
              <Principle number="01" title="Start from your own snapshot">Account tracking will begin from an opening balance and date you choose.</Principle>
              <Principle number="02" title="Keep the details honest">Credit cards are payment methods here, not tracked debts.</Principle>
              <Principle number="03" title="No pretend numbers">This preview contains no personal balances or sample transactions.</Principle>
            </ol>
          </section>
        </div>

        <footer className="flex flex-col gap-2 border-t border-border pt-5 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Faylo private workspace</span>
          <span>Account records are stored in Supabase; transaction tools are not available yet.</span>
        </footer>
      </div>
    </AppShell>
  );
}
