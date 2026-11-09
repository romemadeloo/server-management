import { Empty } from "./Layout";

/**
 * Ported from H.table / H.th / H.td / H.tr.
 *
 * `min-w-[880px]` plus an `overflow-x-auto` wrapper is deliberate: these tables
 * carry URLs and ticket keys that must not wrap, so the table scrolls inside its
 * own card rather than squeezing columns or pushing the page sideways.
 */

export function Table({
  head,
  children,
  empty = "Nothing to show here.",
  isEmpty,
  minWidth = "min-w-[880px]",
  className = "",
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty?: string;
  isEmpty: boolean;
  minWidth?: string;
  className?: string;
}) {
  if (isEmpty) return <Empty message={empty} className={className} />;

  return (
    <div className={`overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line ${className}`}>
      <div className="overflow-x-auto">
        <table className={`w-full ${minWidth} text-left`}>
          <thead>
            <tr className="border-b border-line bg-subtle/60 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">{head}</tr>
          </thead>
          <tbody className="divide-y divide-line-soft">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/** Spreads the rest of its props, like Tr does, so a sortable header can carry
 *  `aria-sort` — a screen reader otherwise has no way to know a column is
 *  sorted, or which way. */
export function Th({ children, className = "", ...rest }: React.ComponentProps<"th">) {
  return (
    <th className={`px-5 py-3 font-bold ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-3.5 ${className}`}>{children}</td>;
}

export function Tr({
  children,
  className = "",
  ...rest
}: React.ComponentProps<"tr">) {
  return (
    <tr className={`transition hover:bg-subtle/60 ${className}`} {...rest}>
      {children}
    </tr>
  );
}
