import { Icon } from "./Icon";
import { TONE, type IconName, type Tone } from "@/lib/shared/tokens";

/** Page furniture, ported from H.page / H.pageHead / H.card / H.statTile /
 *  H.notice / H.empty. Class strings unchanged. */

export function Page({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-6 sm:px-6 lg:px-7 lg:pb-8">{children}</div>;
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
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-faint">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  sub,
  children,
  className = "",
}: {
  title?: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-line ${className}`}>
      {title ? <h2 className="text-[15px] font-bold tracking-tight">{title}</h2> : null}
      {sub ? <p className="mt-1 text-xs text-faint">{sub}</p> : null}
      <div className={title ? "mt-5" : ""}>{children}</div>
    </div>
  );
}

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
    <div className="flex items-center gap-3.5 rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${t.soft} ${t.fg}`}>
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{label}</p>
        <p className="truncate text-xs text-faint">{sub}</p>
      </div>
      <span className={`ml-auto shrink-0 text-2xl font-bold tracking-tight ${t.fg}`}>{value}</span>
    </div>
  );
}

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
    <div className={`mb-5 flex items-start gap-3 rounded-2xl p-4 ring-1 ${t.soft} ${t.ring}`}>
      <span className={`mt-0.5 shrink-0 ${t.fg}`}>
        <Icon name="alert" className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-bold ${t.fg}`}>{title}</p>
        {children ? <p className={`mt-0.5 text-xs opacity-90 ${t.fg}`}>{children}</p> : null}
      </div>
    </div>
  );
}

export function Empty({ message, className = "" }: { message: string; className?: string }) {
  return (
    <div className={`rounded-2xl bg-surface p-12 text-center shadow-sm ring-1 ring-line ${className}`}>
      <p className="text-sm text-faint">{message}</p>
    </div>
  );
}
