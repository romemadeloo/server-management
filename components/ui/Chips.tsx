import Link from "next/link";
import { ENV_STATE, HEALTH, jiraChip, roleChip } from "@/lib/shared/tokens";
import { roleLabel } from "@/lib/shared/roles";
import type { EnvStatus, RepoHealth } from "@/lib/types";

/** Ported from H.chip / H.dotChip / H.jiraChip / H.filterChip. */

export function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

/** A status pill with its own colour dot. The one shape that says "this is the
 *  derived state of an environment". */
export function StatusChip({ status }: { status: EnvStatus }) {
  const token = ENV_STATE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${token.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${token.dot}`} />
      {token.label}
    </span>
  );
}

export function HealthChip({ health }: { health: RepoHealth }) {
  const token = HEALTH[health];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${token.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${token.dot}`} />
      {token.label}
    </span>
  );
}

export function JiraChip({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <Chip className={jiraChip(status)}>{status}</Chip>;
}

export function RoleChip({ role }: { role: string }) {
  return <Chip className={roleChip(role)}>{roleLabel(role)}</Chip>;
}

/**
 * A count-bearing toggle for narrowing a list. Selected reads as a solid brand
 * pill, the rest as quiet outlines, so which way a table is cut is legible
 * without reading a single label.
 *
 * Uses the fixed brand colour on purpose: it means the same thing in both themes.
 */
export function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
        active
          ? "bg-brand-500 text-white"
          : "bg-surface text-muted ring-1 ring-line-2 hover:text-brand-fg hover:ring-brand-soft"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-[10px] font-bold ${
          active ? "bg-white/20 text-white" : "bg-subtle-2 text-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-faint">{children}</span>;
}

/** The em-dash placeholder used wherever a cell has nothing to show. */
export function Dash() {
  return <span className="text-sm text-faintest">—</span>;
}

/**
 * The same control as FilterChip, but as a LINK — for a filter that lives in the
 * URL rather than in component state.
 *
 * That is the shape every server-rendered filter in this app wants: a narrowed
 * view is shareable, survives a reload, and the back button undoes it, all
 * without the page becoming a client component. app/(app)/health/page.tsx
 * reasons this through at length and grew its own copy first; this is that pill
 * generalised, taking a ready-made href so it knows nothing about routes.
 */
export function FilterLink({
  href,
  label,
  count,
  active,
  dot,
}: {
  href: string;
  label: string;
  /** Omitted where there is nothing to count — an "All" chip on a list that
   *  already says its own total, for instance. */
  count?: number;
  active: boolean;
  /** A colour dot, for filters whose values have a colour of their own. */
  dot?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
        active ? "bg-accent text-on-accent" : "bg-surface text-muted ring-1 ring-line-2 hover:text-ink"
      }`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
      {/* The count rides in the label rather than in a pill of its own: a pill
          would need a background that works on `bg-accent` as well as on
          `bg-surface`, and every colour that does is a literal one. */}
      {label}
      {count === undefined ? "" : ` ${count}`}
    </Link>
  );
}
