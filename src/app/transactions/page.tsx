import Link from "next/link";
import { AppShell, Icon } from "@/components/app-shell";
import { formatTransactionAmount, formatTransactionDate } from "@/lib/transactions/presentation";
import { listTransactions, type TransactionFilters, type TransactionRecord } from "@/lib/transactions/repository";
import { isValidTransactionDate, type TransactionEventKind, type TransactionStatus } from "@/lib/transactions/validation";
import { requireOwner } from "@/lib/auth/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function buildPageUrl(filters: TransactionFilters, page: number): string {
  const query = new URLSearchParams();
  if (filters.search) query.set("q", filters.search);
  if (filters.kind !== "all") query.set("kind", filters.kind);
  if (filters.status !== "all") query.set("status", filters.status);
  if (filters.occurredFrom) query.set("from", filters.occurredFrom);
  if (filters.occurredThrough) query.set("to", filters.occurredThrough);
  if (page > 1) query.set("page", String(page));
  return `/transactions${query.size ? `?${query.toString()}` : ""}`;
}

function fundingLabel(record: TransactionRecord): string {
  if (record.kind === "card_settlement") {
    return `Paid from ${record.fundingAccountName ?? "tracked account"} · ${record.paymentMethodName ?? "credit card"}`;
  }
  if (record.fundingStatus === "unassigned") return "Unassigned · reconcile";
  if (record.fundingStatus === "credit_card") return `${record.paymentMethodName ?? "Credit card"} · no card balance tracked`;
  return `${record.fundingAccountName ?? "Tracked account"}${record.paymentMethodName ? ` · ${record.paymentMethodName}` : ""}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const owner = await requireOwner();
  const query = await searchParams;
  const scalar = (key: string) => typeof query[key] === "string" ? query[key] as string : "";
  const requestedKind = scalar("kind");
  const requestedStatus = scalar("status");
  const filters: TransactionFilters = {
    search: scalar("q").trim(),
    kind: requestedKind === "income" || requestedKind === "expense" || requestedKind === "card_settlement" ? requestedKind as TransactionEventKind : "all",
    status: requestedStatus === "posted" || requestedStatus === "voided" ? requestedStatus as TransactionStatus : "all",
    occurredFrom: scalar("from"),
    occurredThrough: scalar("to"),
  };
  const requestedPage = Number(scalar("page") || "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 20_000 ? requestedPage : 1;
  const invalidFilters = filters.search.length > 120
    || (filters.occurredFrom !== "" && !isValidTransactionDate(filters.occurredFrom))
    || (filters.occurredThrough !== "" && !isValidTransactionDate(filters.occurredThrough))
    || Boolean(filters.occurredFrom && filters.occurredThrough && filters.occurredFrom > filters.occurredThrough);
  const result = invalidFilters
    ? null
    : await listTransactions(owner.id, filters, page);
  const history = result?.ok ? result.value : null;

  return (
    <AppShell activeSection="transactions" email={owner.email}>
      <div className="mx-auto max-w-[1200px] space-y-7">
        <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[12px] font-medium text-muted">Income, spending and settlements</p>
            <h1 className="mt-2 text-[34px] font-medium leading-tight tracking-[-0.05em] text-ink sm:text-[42px]">Transactions</h1>
            <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted">Card purchases count once as spending; later settlements debit an account without another expense. Faylo does not track outstanding card balances or reconcile statements, so tracked assets can overstate net worth.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 text-[13px] font-medium text-ink transition-colors hover:bg-raised" href="/transactions/categories">Categories & methods</Link>
            <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 text-[13px] font-medium text-ink transition-colors hover:bg-raised" href="/transactions/settlement">Settle a card</Link>
            <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-mint px-4 text-[13px] font-semibold text-canvas transition-colors hover:bg-[#a0d8b8]" href="/transactions/new">Add transaction <Icon className="size-4" name="arrow" /></Link>
          </div>
        </header>

        <section aria-labelledby="transaction-filter-title" className="rounded-3xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="sr-only" id="transaction-filter-title">Filter transactions</h2>
          <form action="/transactions" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.5fr)_minmax(130px,.7fr)_minmax(130px,.7fr)_minmax(150px,.8fr)_minmax(150px,.8fr)_auto]" method="get">
            <div>
              <label className="account-field-label" htmlFor="transaction-search">Search</label>
              <input autoComplete="off" className="account-field-control" defaultValue={filters.search} id="transaction-search" maxLength={120} name="q" placeholder="Merchant, category, note" type="search" />
            </div>
            <div>
              <label className="account-field-label" htmlFor="transaction-kind-filter">Type</label>
              <select className="account-field-control" defaultValue={filters.kind} id="transaction-kind-filter" name="kind">
                <option value="all">All types</option><option value="expense">Expenses</option><option value="income">Income</option><option value="card_settlement">Card settlements</option>
              </select>
            </div>
            <div>
              <label className="account-field-label" htmlFor="transaction-status-filter">Status</label>
              <select className="account-field-control" defaultValue={filters.status} id="transaction-status-filter" name="status">
                <option value="all">All statuses</option><option value="posted">Posted</option><option value="voided">Voided</option>
              </select>
            </div>
            <div>
              <label className="account-field-label" htmlFor="transaction-from">From</label>
              <input className="account-field-control" defaultValue={filters.occurredFrom} id="transaction-from" name="from" type="date" />
            </div>
            <div>
              <label className="account-field-label" htmlFor="transaction-to">Through</label>
              <input className="account-field-control" defaultValue={filters.occurredThrough} id="transaction-to" name="to" type="date" />
            </div>
            <div className="flex items-end gap-2">
              <button className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-border bg-raised px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-[#282828]" type="submit">Apply</button>
              <Link aria-label="Clear transaction filters" className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-border bg-canvas text-[13px] text-muted hover:bg-raised hover:text-ink" href="/transactions">Clear</Link>
            </div>
          </form>
        </section>

        {invalidFilters && <p className="account-form-message" role="alert">The search or date range is invalid. Use real calendar dates and keep the start date on or before the end date.</p>}
        {result && !result.ok && <section aria-labelledby="transaction-error-title" className="rounded-3xl border border-[#633f3f] bg-[#1d1717] p-6"><h2 className="text-[18px] font-medium text-ink" id="transaction-error-title">Transaction history is unavailable</h2><p className="mt-2 text-[13px] leading-6 text-muted">Faylo could not load transaction history. Check that the Issue 5 database migration is deployed, then try again.</p><Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href={buildPageUrl(filters, page)}>Try again</Link></section>}

        {history && (
          <section aria-labelledby="history-list-title" className="rounded-3xl border border-border bg-surface p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink" id="history-list-title">Transaction history</h2>
                <p className="mt-1 text-[12px] text-muted">{history.totalCount === 1 ? "1 transaction" : `${history.totalCount} transactions`} · newest economic date first</p>
              </div>
              <span className="text-[12px] text-muted">Page {history.page}</span>
            </div>
            {history.rows.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-4 py-10 text-center">
                <span className="flex size-11 items-center justify-center rounded-full border border-border bg-canvas text-muted"><Icon className="size-[19px]" name="activity" /></span>
                <h3 className="mt-4 text-[15px] font-medium text-ink">{filters.search || filters.kind !== "all" || filters.status !== "all" || filters.occurredFrom || filters.occurredThrough ? "No matching transactions" : "No transactions yet"}</h3>
                <p className="mt-2 max-w-md text-[13px] leading-5 text-muted">{filters.search || filters.kind !== "all" || filters.status !== "all" || filters.occurredFrom || filters.occurredThrough ? "Change or clear the filters to see other activity." : "Record an income or expense. Your opening balance stays separate from transaction history."}</p>
                {history.totalCount === 0 && <Link className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-mint underline underline-offset-4" href="/transactions/new">Add a transaction</Link>}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {history.rows.map((record) => (
                  <li key={record.id}>
                    <Link className="transaction-row-link -mx-2 flex min-h-[92px] flex-col justify-center gap-3 rounded-2xl px-3 py-4 transition-colors hover:bg-canvas/70 sm:flex-row sm:items-center sm:justify-between" href={`/transactions/${record.id}`}>
                      <div className="flex min-w-0 items-start gap-3 sm:items-center">
                        <span aria-hidden="true" className={record.kind === "income" ? "mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-forest/30 text-mint sm:mt-0" : "mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink/80 sm:mt-0"}>
                          <Icon className="size-[19px]" name={record.kind === "income" ? "arrow" : "activity"} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium text-ink">{record.merchant ?? record.categoryName}</p>
                          <p className="mt-1 truncate text-[12px] text-muted">{record.categoryName} · {fundingLabel(record)}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted sm:hidden">
                            <span>{formatTransactionDate(record.occurredOn)}</span>
                            <span>·</span>
                            <span>{record.status === "posted" ? "Posted" : record.correctedByTransactionId ? "Voided · corrected" : "Voided"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-4 pl-[52px] sm:pl-0">
                        <div className="hidden text-right text-[12px] text-muted sm:block">
                          <p>{formatTransactionDate(record.occurredOn)}</p>
                          <p className="mt-1">{record.status === "posted" ? "Posted" : record.correctedByTransactionId ? "Voided · corrected" : "Voided"}</p>
                        </div>
                        <p className={record.kind === "income" ? "text-right text-[17px] font-semibold tabular-nums text-mint" : "text-right text-[17px] font-medium tabular-nums text-ink"}>{formatTransactionAmount(record.amount, record.currencyCode, record.kind)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {(history.hasPrevious || history.hasMore) && <nav aria-label="Transaction history pages" className="mt-4 flex items-center justify-between border-t border-border pt-4">
              {history.hasPrevious ? <Link className="inline-flex min-h-11 items-center rounded-xl border border-border bg-raised px-4 text-[13px] font-medium text-ink hover:bg-[#282828]" href={buildPageUrl(filters, page - 1)}>Previous</Link> : <span />}
              {history.hasMore && <Link className="inline-flex min-h-11 items-center rounded-xl border border-border bg-raised px-4 text-[13px] font-medium text-ink hover:bg-[#282828]" href={buildPageUrl(filters, page + 1)}>Next</Link>}
            </nav>}
          </section>
        )}
      </div>
    </AppShell>
  );
}
