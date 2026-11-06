import { Icon } from "./Icon";
import { TONE, type IconName, type Tone } from "@/lib/shared/tokens";

/**
 * Page furniture, ported from H.page / H.pageHead / H.card / H.statTile /
 * H.notice / H.empty.
 *
 * Surfaces are glass panes on the dark theme: translucent, top-lit, with a
 * hairline edge and a 20px radius (`.glass` in app/globals.css). They are
 * separated by the light behind them, not by drop shadows — on a page that is
 * mostly cards, a shadow on each would stack into murk.
 */

export function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1600px] px-4 pb-10 sm:px-6 lg:px-8">{children}</div>;
}

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-6">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-ink">{title}</h1>
        {sub ? <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A section heading inside a page: title, optional description, optional
 *  trailing action (a "See all" link, a filter). */
export function SectionHead({
  title,
  sub,
  action,
  className = "",
}: {
  title: string;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 pb-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">{title}</h2>
        {sub ? <div className="text-[13px] text-muted">{sub}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Card({
  title,
  sub,
  actions,
  children,
  className = "",
}: {
  title?: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-[20px] border border-line bg-surface ${className}`}>
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-6 text-ink">{title}</h2>
            {sub ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{sub}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-6">{children}</div>
    </section>
  );
}

/**
 * A metric tile, laid out the way Carbon's and most status pages do it: what
 * it is first, then the number, then what the number is out of. The tone colours
 * a small marker and the icon, not the number — a red "0 offline" would be the
 * most alarming thing on the page while saying the least.
 */
export function StatTile({
  tone,
  label,
  value,
  sub,
  icon,
}: {
  tone: Tone;
  label: string;
  value: React.ReactNode;
  sub: string;
  icon: IconName;
}) {
  const t = TONE[tone];
  return (
    <div className="glass rounded-[20px] border border-line bg-surface p-5">
      <span className={`grid h-9 w-9 place-items-center rounded-xl border border-line-2 bg-subtle ${t.fg}`}>
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <p className="mt-4 text-[13px] font-medium leading-5 text-muted">{label}</p>
      <p className="mt-1 text-[32px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs leading-4 text-faint">{sub}</p>
    </div>
  );
}

const NOTICE_EDGE: Record<Tone, string> = {
  ok: "border-ok/30",
  warn: "border-warn/30",
  bad: "border-bad/30",
  info: "border-info/30",
  alt: "border-line-2",
  brand: "border-brand-500/30",
  neutral: "border-line-2",
};

/**
 * The banner: a tinted glass strip across the page for something the reader
 * should know before reading it. The tone colours the edge, the wash and the
 * icon's halo; the title stays in ink so the sentence, not the colour, is what
 * you read.
 */
export function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      role="status"
      className={`glass relative mb-5 flex items-start gap-3.5 overflow-hidden rounded-2xl border px-4 py-3.5 sm:px-5 ${t.soft} ${NOTICE_EDGE[tone]}`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-current/10 ring-1 ring-inset ring-current/25 ${t.fg}`}
      >
        <Icon name="alert" className="h-4 w-4" />
      </span>
      <div className="min-w-0 self-center">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children ? <div className="mt-0.5 text-[13px] leading-5 text-body">{children}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ message, className = "" }: { message: string; className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-line-2 bg-surface px-6 py-12 text-center ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-faintest" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <path d="M3.5 13h4.25l1.5 2.25h5.5l1.5-2.25h4.25" />
      </svg>
      <p className="text-[13px] text-muted">{message}</p>
    </div>
  );
}
