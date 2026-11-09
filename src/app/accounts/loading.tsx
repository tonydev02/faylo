export default function AccountsLoading() {
  return (
    <main aria-busy="true" aria-live="polite" className="mx-auto max-w-[1440px] space-y-6 px-5 pb-28 pt-8 sm:px-8 sm:pt-10 lg:px-10">
      <p className="sr-only">Loading accounts</p>
      <div className="h-8 w-36 rounded-lg bg-surface motion-safe:animate-pulse" />
      <div className="h-5 max-w-xl rounded-lg bg-surface motion-safe:animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {[0, 1].map((item) => <div aria-hidden="true" className="h-56 rounded-3xl border border-border bg-surface motion-safe:animate-pulse" key={item} />)}
      </div>
    </main>
  );
}
