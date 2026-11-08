import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth/actions";

type IconName = "mark" | "overview" | "activity" | "accounts" | "insights" | "settings" | "arrow" | "shield" | "spark";

const iconPaths: Record<IconName, ReactNode> = {
  mark: (
    <>
      <path d="M5.5 14.2c0-4.4 3.1-7.3 8.8-9.4-.2 5.8-2.1 9.4-6.4 10.8" />
      <path d="M7 18.5c2.1-3.3 4.6-5.5 8.3-7.6" />
      <path d="M13.5 18.5h5" />
    </>
  ),
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.8" />
      <rect x="13.5" y="10.5" width="7" height="10" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  activity: <path d="M3 12h4l2.2-6 4.2 12 2.2-6H21" />,
  accounts: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M3.5 9h17M7.5 15h3" />
    </>
  ),
  insights: (
    <>
      <path d="M4 19.5V12m5 7.5V6m5 13.5v-5m5 5V9" />
      <path d="M2.5 20.5h19" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  shield: (
    <>
      <path d="M12 3.5 19 6v5.3c0 4.2-2.9 7.4-7 9.2-4.1-1.8-7-5-7-9.2V6l7-2.5Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    </>
  ),
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {iconPaths[name]}
    </svg>
  );
}

const navigationItems: { label: string; icon: IconName; active?: boolean }[] = [
  { label: "Overview", icon: "overview", active: true },
  { label: "Activity", icon: "activity" },
  { label: "Accounts", icon: "accounts" },
  { label: "Insights", icon: "insights" },
];

function Brand() {
  return (
    <Link aria-label="Faylo overview" className="inline-flex items-center gap-3" href="/">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-forest text-mint">
        <Icon className="size-6" name="mark" />
      </span>
      <span className="text-[21px] font-semibold tracking-[-0.055em] text-ink">faylo</span>
    </Link>
  );
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav aria-label={mobile ? "Mobile primary navigation" : "Primary navigation"}>
      <ul className={mobile ? "grid grid-cols-4 gap-1" : "space-y-1.5"}>
        {navigationItems.map((item) => (
          <li key={item.label}>
            {item.active ? (
              <Link
                aria-current="page"
                className={mobile ? "nav-item nav-item-mobile nav-item-active" : "nav-item nav-item-active"}
                href="/#overview"
              >
                <Icon className="size-[19px] shrink-0" name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ) : (
              <button
                aria-label={`${item.label}, coming soon`}
                className={mobile ? "nav-item nav-item-mobile nav-item-disabled" : "nav-item nav-item-disabled"}
                disabled
                title="Coming soon"
                type="button"
              >
                <Icon className="size-[19px] shrink-0" name={item.icon} />
                <span>{item.label}</span>
                {!mobile && <span className="nav-soon">Soon</span>}
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell({ children, email }: { children: ReactNode; email: string | null }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-border bg-chrome px-5 pb-5 pt-7 lg:flex">
        <Brand />
        <div className="mt-11 flex items-center justify-between px-3">
          <span className="text-[12px] font-medium text-muted">Workspace</span>
          <span className="rounded-full border border-border bg-raised px-2.5 py-1 text-[11px] font-medium text-muted">Private</span>
        </div>
        <div className="mt-4">
          <Navigation />
        </div>
        <div className="mt-auto space-y-5">
          <button className="nav-item nav-item-disabled w-full" disabled title="Coming soon" type="button">
            <Icon className="size-[19px] shrink-0" name="settings" />
            <span>Settings</span>
            <span className="nav-soon">Soon</span>
          </button>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-muted">
              <span className="size-1.5 rounded-full bg-mint" />
              Verified identity
            </div>
            <p className="mt-2 text-[12px] leading-5 text-muted">Server-verified access for the approved Google account.</p>
          </div>
          <p className="px-1 text-[12px] text-muted">Faylo · Private workspace</p>
        </div>
      </aside>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-border bg-chrome">
          <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-10">
            <div className="lg:hidden">
              <Brand />
            </div>
            <p className="hidden text-[13px] text-muted lg:block">
              Your space <span className="mx-2 text-muted/70">/</span> <span className="text-ink/85">Overview</span>
            </p>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="hidden max-w-[260px] truncate text-[12px] text-muted sm:inline" title={email ?? undefined}>
                Signed in · {email ?? "Owner"}
              </span>
              <form action={signOut}>
                <button className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-3 text-[12px] font-medium text-ink transition-colors hover:bg-raised" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        <main id="overview" className="mx-auto min-h-[calc(100vh-72px)] max-w-[1440px] px-5 pb-28 pt-8 sm:px-8 sm:pt-10 md:pb-16 lg:px-10 lg:pt-12">
          {children}
        </main>
      </div>

      <div className="mobile-nav-shell fixed inset-x-0 bottom-0 z-30 border-t border-border bg-chrome px-3 pt-2 lg:hidden">
        <Navigation mobile />
      </div>
    </div>
  );
}
