import { formatMoney } from "@/lib/accounts/money";
import { monthLabel } from "@/lib/dashboard/presentation";
import { buildMonthlyTrendPoints, type MonthlyTrendPoint, type MonthlyTrendValue } from "@/lib/dashboard/trends";
import type { MonthlyDashboardTotal } from "@/lib/dashboard/repository";

const PLOT_TOP = 18;
const PLOT_HEIGHT = 174;
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT;
const VIEW_HEIGHT = 232;

function coverageLabel(status: MonthlyTrendPoint["coverageStatus"]): string {
  if (status === "fully_tracked") return "fully tracked";
  if (status === "partial_account_coverage") return "partial account coverage";
  return "insufficient account history";
}

function comparisonLabel(point: MonthlyTrendPoint): string {
  switch (point.comparison) {
    case "matching_coverage": return "Same account coverage as the previous completed month; values are comparable.";
    case "coverage_mismatch": return "Not compared with the previous month because account coverage differs.";
    case "insufficient_history": return "Not compared with the previous month because tracking history is insufficient.";
    case "incomplete_data": return "Not compared with the previous month because FX or account coverage does not support a complete total.";
    case "month_to_date": return "Month to date; not compared with a completed month.";
    case "window_start": return "No previous month is included in this chart window.";
  }
}

function trendValueText(value: MonthlyTrendValue, coverageStatus: MonthlyTrendPoint["coverageStatus"]): string {
  if (value.valueJpy !== null) {
    const coverage = coverageStatus === "fully_tracked" ? "fully tracked" : "partial account coverage";
    return `${formatMoney(value.valueJpy, "JPY")} · all included JPY snapshots resolved · ${coverage}`;
  }
  if (value.state === "incomplete_fx") {
    const subtotal = value.resolvedSubtotalJpy === null
      ? "No resolved JPY subtotal"
      : `Resolved subtotal ${formatMoney(value.resolvedSubtotalJpy, "JPY")}`;
    const unresolved = value.unresolvedCount > 0
      ? `${value.unresolvedCount} unresolved conversion${value.unresolvedCount === 1 ? "" : "s"}`
      : "snapshot counts do not establish a complete total";
    return `${subtotal} · ${unresolved} · incomplete, not charted`;
  }
  if (value.state === "partial_coverage") return "No activity recorded, but account coverage is partial; zero is not assumed.";
  if (value.state === "insufficient_history") {
    const subtotal = value.resolvedSubtotalJpy === null ? "" : `Resolved subtotal ${formatMoney(value.resolvedSubtotalJpy, "JPY")} · `;
    return `${subtotal}insufficient account history · not charted`;
  }
  return "Monthly reporting data is unavailable · not charted.";
}

function shortMonthLabel(monthStart: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${monthStart}T00:00:00.000Z`));
}

function valueCount(points: MonthlyTrendPoint[], key: "income" | "spending"): number {
  return points.filter((point) => point[key].valueJpy !== null).length;
}

function amountHeight(amount: string, maximum: bigint): number {
  if (amount === "0") return 0;
  const scaled = (BigInt(amount) * BigInt(PLOT_HEIGHT)) / maximum;
  return Math.max(1, Number(scaled));
}
function ChartBar({
  amount,
  className,
  label,
  maximum,
  monthStart,
  width,
  x,
}: {
  amount: string | null;
  className: string;
  label: "Income" | "Spending";
  maximum: bigint;
  monthStart: string;
  width: number;
  x: number;
}) {
  if (amount === null) return null;
  const title = `${label}, ${monthLabel(monthStart)}: ${formatMoney(amount, "JPY")}`;
  if (amount === "0") return <circle className={className} cx={x + width / 2} cy={PLOT_BOTTOM - 1} r="2.5"><title>{title}</title></circle>;
  const height = amountHeight(amount, maximum);
  return <rect className={className} height={height} rx="2" width={width} x={x} y={PLOT_BOTTOM - height}><title>{title}</title></rect>;
}

function TrendChart({ points }: { points: MonthlyTrendPoint[] }) {
  const width = 46 + points.length * 62;
  const left = 38;
  const right = 8;
  const slotWidth = (width - left - right) / points.length;
  const barWidth = Math.min(18, slotWidth / 3);
  const barGap = 4;
  const values = points.flatMap((point) => [point.income.valueJpy, point.spending.valueJpy])
    .filter((amount): amount is string => amount !== null);
  const maximum = values.reduce((largest, amount) => {
    const value = BigInt(amount);
    return value > largest ? value : largest;
  }, BigInt(0)) || BigInt(1);

  return (
    <svg
      aria-labelledby="monthly-trend-chart-title monthly-trend-chart-description"
      className="block h-auto w-full"
      role="img"
      viewBox={`0 0 ${width} ${VIEW_HEIGHT}`}
    >
      <title id="monthly-trend-chart-title">Monthly income and spending in Japanese yen</title>
      <desc id="monthly-trend-chart-description">Completed months have separate income and spending bars using stored JPY reporting snapshots. Missing conversions are not charted as zero. Dashed dividers mark months that cannot be directly compared with the prior month. The current month is shown as month to date in the text alternative, not as a completed-month bar.</desc>
      <text className="fill-muted text-[10px]" x="2" y="11">JPY</text>
      <line className="stroke-border" stroke="currentColor" strokeWidth="1" x1={left} x2={width - right} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} />
      <line className="stroke-border opacity-60" stroke="currentColor" strokeDasharray="2 5" strokeWidth="1" x1={left} x2={width - right} y1={PLOT_TOP + PLOT_HEIGHT / 2} y2={PLOT_TOP + PLOT_HEIGHT / 2} />
      {points.map((point, index) => {
        const center = left + (index + 0.5) * slotWidth;
        const incomeX = center - barWidth - barGap / 2;
        const spendingX = center + barGap / 2;
        return (
          <g key={point.monthStart}>
            {index > 0 && point.comparison !== "matching_coverage" && (
              <line className="stroke-border" stroke="currentColor" strokeDasharray="3 4" strokeWidth="1" x1={left + index * slotWidth} x2={left + index * slotWidth} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
            )}
            <ChartBar amount={point.income.valueJpy} className="fill-mint" label="Income" maximum={maximum} monthStart={point.monthStart} width={barWidth} x={incomeX} />
            <ChartBar amount={point.spending.valueJpy} className="fill-muted" label="Spending" maximum={maximum} monthStart={point.monthStart} width={barWidth} x={spendingX} />
            <text className="fill-muted text-[11px]" textAnchor="middle" x={center} y="216">{shortMonthLabel(point.monthStart)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function MonthlyTrendChart({
  monthlyTotals,
  currentMonthStart,
}: {
  monthlyTotals: MonthlyDashboardTotal[] | null;
  currentMonthStart: string;
}) {
  const points = buildMonthlyTrendPoints(monthlyTotals ?? [], currentMonthStart);
  const completedPoints = points.filter((point) => !point.monthToDate);
  const hasTrend = valueCount(completedPoints, "income") >= 2 || valueCount(completedPoints, "spending") >= 2;

  return (
    <section aria-labelledby="monthly-trends-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-7">
      <div className="max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Stored monthly reporting data · JPY reference</p>
        <h2 className="mt-2 text-[18px] font-medium tracking-[-0.035em] text-ink" id="monthly-trends-title">Income and spending trends</h2>
        <p className="mt-2 text-[12px] leading-5 text-muted">Bars use stored per-transaction JPY snapshots; original-currency summaries above remain authoritative. Incomplete FX totals are not charted. Dashed breaks mark periods that are not directly comparable because coverage differs, history is incomplete, or JPY data is unresolved. The current month is shown only in the text alternative as month-to-date, never as a completed-month bar.</p>
      </div>
      {monthlyTotals !== null && points.some((point) => point.monthToDate) && (
        <p className="mt-4 rounded-xl border border-border bg-canvas/45 px-3 py-2 text-[12px] leading-5 text-muted">The current month is month-to-date and is not plotted alongside completed months; its exact values appear in the text alternative.</p>
      )}
      {monthlyTotals === null ? (
        <p className="mt-5 rounded-2xl border border-dashed border-border px-4 py-5 text-[13px] leading-5 text-muted">Trend data is unavailable. No chart is shown.</p>
      ) : hasTrend ? (
        <>
          <div aria-label="Chart legend" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted" role="group">
            <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-mint" />Income · JPY</span>
            <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-muted" />Spending · JPY</span>
            <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-3 border-l border-dashed border-muted" />Not directly comparable</span>
          </div>
          <div className="mx-auto mt-4 w-full max-w-[640px]">
            <TrendChart points={completedPoints} />
          </div>
        </>
      ) : (
        <p className="mt-5 rounded-2xl border border-dashed border-border px-4 py-5 text-[13px] leading-5 text-muted">Fewer than two months have supported JPY values, so a trend chart would be misleading. Complete FX snapshots and sufficient account coverage are required; an unknown conversion is never counted as zero.</p>
      )}
      {monthlyTotals !== null && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-[12px] font-medium text-ink underline decoration-border underline-offset-4">Read exact monthly values and coverage</summary>
          <ol className="mt-3 space-y-3">
            {points.map((point) => (
              <li className="rounded-xl border border-border bg-canvas/45 p-3" key={point.monthStart}>
                <h3 className="text-[12px] font-medium text-ink">{monthLabel(point.monthStart)}{point.monthToDate ? " · month to date" : ""}</h3>
                <p className="mt-1 text-[11px] text-muted">{coverageLabel(point.coverageStatus)}</p>
                <dl className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2">
                  <div><dt className="text-muted">Income</dt><dd className="mt-0.5 text-ink">{trendValueText(point.income, point.coverageStatus)}</dd></div>
                  <div><dt className="text-muted">Spending</dt><dd className="mt-0.5 text-ink">{trendValueText(point.spending, point.coverageStatus)}</dd></div>
                </dl>
                <p className="mt-2 text-[11px] leading-5 text-muted">{comparisonLabel(point)}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
