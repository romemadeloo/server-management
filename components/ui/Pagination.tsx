import Link from "next/link";
import { Icon } from "./Icon";
import type {
  PaginationProps,
  PaginationStepProps,
} from "@/lib/shared/pagination-types";

/**
 * Page controls for a server-rendered table: `‹ 1 2 [3] 4 5 … 12 ›` plus a line
 * saying which rows are on screen.
 *
 * Ported from the legacy `pager()` in public/js/ui/page-dashboard.js, with two
 * changes. The numbers are new — legacy could only step, and stepping to page 9
 * of 12 is eight clicks. And the page lives in the URL rather than on the page
 * object, so every control here is a plain <Link> and the whole thing stays a
 * Server Component: no client JavaScript, shareable, and the back button works.
 * That follows the filters on app/(app)/health/page.tsx, which say the same.
 *
 * This component knows nothing about routes — the caller passes `href`, because
 * a page number means something different on each page that uses it.
 */

/** Same pill as FilterLink on the health page, so a page number and a filter
 *  chip read as the same kind of control. */
const PILL =
  "inline-flex min-w-[2rem] items-center justify-center rounded-full px-3 py-1.5 text-[11px] font-semibold transition";
const PILL_IDLE = "bg-surface text-muted ring-1 ring-line-2 hover:text-ink";
const PILL_ACTIVE = "bg-accent text-on-accent";

/** IconButton's round shape, applied to a link. */
const CHEV = "grid h-8 w-8 place-items-center rounded-full text-faint ring-1 ring-line-2 transition";
const CHEV_ON = "hover:bg-brand-soft hover:text-brand-fg hover:ring-brand-soft";
const CHEV_OFF = "cursor-not-allowed opacity-40";

/**
 * One end of the pager. At the first or last page this is a <span>, not a
 * <Link>: a link that goes nowhere is worse than a visibly dead control, and
 * <button disabled> — what the legacy version used — would make the whole page
 * a client component for the sake of two arrows.
 */
function Step({ href, label, back = false, disabled }: PaginationStepProps) {
  const chevron = <Icon name="chevron" className={`h-3 w-3 ${back ? "rotate-180" : ""}`} />;

  if (disabled) {
    return (
      <span className={`${CHEV} ${CHEV_OFF}`} aria-disabled="true" aria-label={label}>
        {chevron}
      </span>
    );
  }

  return (
    <Link href={href} className={`${CHEV} ${CHEV_ON}`} aria-label={label} title={label}>
      {chevron}
    </Link>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  from,
  to,
  href,
  label,
  window,
}: PaginationProps) {
  // A pager for a single page is noise. The legacy version bailed here too.
  if (pageCount <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 pt-4"
    >
      <p className="text-[11px] font-semibold text-faint">
        Showing {from}–{to} of {total} {label}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Step href={href(page - 1)} label="Previous page" back disabled={page <= 1} />

        {window.map((entry, i) =>
          entry === "gap" ? (
            // Not a link and not a page: the only thing it says is "there are
            // more between these two", which is why it is hidden from readers.
            <span
              key={`gap-${i}`}
              aria-hidden
              className="px-1 text-[11px] font-semibold text-faintest"
            >
              …
            </span>
          ) : entry === page ? (
            // aria-current, not colour alone — the pill says "you are here" to
            // sighted people only, the same gap Th/aria-sort closes for sorting.
            <span key={entry} aria-current="page" className={`${PILL} ${PILL_ACTIVE}`}>
              {entry}
            </span>
          ) : (
            <Link
              key={entry}
              href={href(entry)}
              aria-label={`Page ${entry}`}
              className={`${PILL} ${PILL_IDLE}`}
            >
              {entry}
            </Link>
          ),
        )}

        <Step href={href(page + 1)} label="Next page" disabled={page >= pageCount} />
      </div>
    </nav>
  );
}
