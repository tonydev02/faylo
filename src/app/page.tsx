import { AppShell, Icon } from "@/components/app-shell";

const overviewCards = [
  { label: "Tracked assets", detail: "Available after setup" },
  { label: "Income", detail: "No data connected" },
  { label: "Spending", detail: "No data connected" },
];

function MetricCard({ label, detail }: { label: string; detail: string }) {
  return (
    <section aria-label={`${label} placeholder`} className="rounded-3xl border border-border/80 bg-surface/70 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted">{label}</h2>
        <span className="size-1.5 rounded-full bg-soft/70" />
      </div>
      <p aria-label="Not available yet" className="mt-5 text-[32px] font-medium leading-none tracking-[-0.055em] text-ink/75">—</p>
      <p className="mt-3 text-[11px] text-soft">{detail}</p>
    </section>
  );
}

function Principle({ number, title, children }: { number: string; title: string; children: string }) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-medium text-mint/90">{number}</span>
      <div>
        <h3 className="text-[13px] font-medium text-ink/90">{title}</h3>
        <p className="mt-1 text-xs leading-[1.7] text-muted">{children}</p>
      </div>
    </li>
  );
}

export default function HomePage() {
  return (
    <AppShell>
      <div className="space-y-7 sm:space-y-8">
        <section aria-labelledby="page-title" className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.19em] text-mint/90">
              <span className="size-1.5 rounded-full bg-mint" />
              Personal finance · workspace preview
            </p>
            <h1 id="page-title" className="mt-4 max-w-[650px] text-[38px] font-medium leading-[1.08] tracking-[-0.055em] text-ink sm:text-[48px] lg:text-[56px]">
              A clearer view of your money.
            </h1>
            <p className="mt-4 max-w-xl text-[14px] leading-7 text-muted sm:text-[15px]">
              A calm foundation for understanding the things that matter. Your real financial data is not connected in this preview.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/80 bg-surface/70 px-3.5 py-2 text-[11px] font-medium text-muted">
            <Icon className="size-4 text-mint/90" name="shield" />
            No account connected
          </span>
        </section>

        <section aria-labelledby="setup-title" className="relative overflow-hidden rounded-[28px] border border-mint/15 bg-[linear-gradient(115deg,rgba(23,74,57,0.82),rgba(16,42,35,0.88)_58%,rgba(16,42,35,0.72))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.15)] sm:p-7 lg:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 size-72 rounded-full border border-mint/[0.08] sm:-right-7 sm:-top-44 sm:size-[420px]">
            <span className="absolute inset-8 rounded-full border border-mint/[0.07]" />
            <span className="absolute inset-16 rounded-full border border-mint/[0.06]" />
          </div>
          <div className="relative flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-mint/20 bg-canvas/40 text-mint">
                  <Icon className="size-5" name="spark" />
                </span>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint/90">A considered start</p>
              </div>
              <h2 id="setup-title" className="mt-5 text-[22px] font-medium tracking-[-0.04em] text-ink sm:text-[25px]">A clean slate, by design.</h2>
              <p className="mt-2 max-w-xl text-[13px] leading-6 text-ink/70">
                Your dashboard stays empty until setup is available. No sample balances or transactions are shown here.
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
              <button className="inline-flex min-h-12 items-center gap-3 rounded-2xl border border-mint/15 bg-canvas/30 px-4 text-[13px] font-medium text-ink/55" disabled type="button">
                Account setup
                <Icon className="size-4 text-mint/60" name="arrow" />
              </button>
              <span className="pl-1 text-[10px] text-muted md:pr-1">Coming soon · no data is saved</span>
            </div>
          </div>
        </section>

        <section aria-label="Financial overview placeholders" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          {overviewCards.map((card) => <MetricCard key={card.label} {...card} />)}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
          <section aria-labelledby="activity-title" className="rounded-3xl border border-border/80 bg-surface/60 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-soft">Your timeline</p>
                <h2 id="activity-title" className="mt-2 text-lg font-medium tracking-[-0.035em] text-ink">Recent activity</h2>
              </div>
              <span className="rounded-full border border-border bg-canvas/50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-soft">Placeholder</span>
            </div>
            <div className="mt-6 flex min-h-[174px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/90 bg-canvas/25 px-5 text-center">
              <span className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted">
                <Icon className="size-[18px]" name="activity" />
              </span>
              <h3 className="mt-3 text-[13px] font-medium text-ink/90">Your activity will appear here</h3>
              <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted">Transactions are not enabled in this foundation. Nothing has been entered or stored.</p>
            </div>
          </section>

          <section aria-labelledby="principles-title" className="rounded-3xl border border-border/80 bg-surface/60 p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl border border-mint/15 bg-mint/5 text-mint/90">
                <Icon className="size-[18px]" name="shield" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-soft">Built around your rules</p>
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

        <footer className="flex flex-col gap-2 border-t border-border/60 pt-5 text-[10px] text-soft sm:flex-row sm:items-center sm:justify-between">
          <span>Faylo foundation preview</span>
          <span>Authentication, storage, and financial actions are not connected.</span>
        </footer>
      </div>
    </AppShell>
  );
}
