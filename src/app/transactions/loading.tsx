export default function TransactionsLoading() {
  return (
    <div aria-label="Loading transactions" className="mx-auto max-w-[1200px] animate-pulse space-y-5">
      <div className="h-9 w-56 rounded-lg bg-surface" />
      <div className="h-32 rounded-3xl bg-surface" />
      <div className="h-64 rounded-3xl bg-surface" />
    </div>
  );
}
