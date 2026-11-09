import { JiraChip } from "./Chips";
import { TicketLink } from "./JiraLinks";
import { agoText, formatDateTime } from "@/lib/shared/format";
import { isUrgent, leftText, progress } from "@/lib/shared/view-model";
import type { Claim, ClaimSource } from "@/lib/types";

/**
 * A ticket as people actually refer to it: the key AND the title.
 *
 * Every list on the board used to render the key alone — "ABC-1432" — with the
 * summary either in a column of its own twenty rows to the right, or nowhere at
 * all (the cards, In use, the matrix, an environment's claims). Nobody
 * remembers tickets by number, so the key without the title made every one of
 * those places a lookup. The rule now is that a ticket is never shown without
 * its title, and this is the one component that renders one, so a new list
 * cannot quietly forget it.
 *
 * The title is text, not markup — React escapes it (invariant 7). It is clamped
 * rather than truncated to one line, because Jira summaries front-load the
 * account ("[ACME] Checkout …") and a single line is often all prefix; the full
 * text rides in `title` for the rest.
 */

/** What to show when a ticket has no summary. A manual claim has none by
 *  construction and its note is what the person typed instead; a Jira ticket
 *  with no summary is rare enough to be worth saying out loud rather than
 *  rendering a blank that reads as a layout bug. */
export function ticketTitle(claim: Pick<Claim, "summary" | "note" | "source">): string | null {
  const summary = claim.summary?.trim();
  if (summary) return summary;
  const note = claim.note?.trim();
  if (note) return note;
  return null;
}

function fallbackTitle(source: ClaimSource | undefined): string {
  return source === "manual" ? "Manual booking — no note" : "No title in Jira";
}

export function TicketTitle({
  claim,
  lines = 2,
  className = "text-[13px] font-medium leading-5 text-ink-2",
}: {
  claim: Pick<Claim, "summary" | "note" | "source">;
  /** 1 on dense surfaces (matrix cells, card lists); 2 in tables. */
  lines?: 1 | 2 | 3;
  className?: string;
}) {
  const title = ticketTitle(claim);
  const clamp = lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : "line-clamp-3";

  if (!title) {
    return <p className="text-[11px] italic text-faint">{fallbackTitle(claim.source)}</p>;
  }
  return (
    <p title={title} className={`${clamp} break-words ${className}`}>
      {title}
    </p>
  );
}

/**
 * The Ticket column: key (linked to Jira), optional status, the title, and a
 * line of quiet context — branch, source, when Jira last touched it.
 *
 * `meta` is opt-in per field so a table that already has a Status or Branch
 * column does not say it twice.
 */
export function TicketCell({
  claim,
  jiraBaseUrl,
  showStatus = false,
  showBranch = false,
  showUpdated = false,
  badge,
  lines = 2,
}: {
  claim: Claim;
  jiraBaseUrl: string | null;
  showStatus?: boolean;
  showBranch?: boolean;
  showUpdated?: boolean;
  /** A chip beside the key — the dashboard's New / Claimed / Updated badge. */
  badge?: React.ReactNode;
  lines?: 1 | 2 | 3;
}) {
  const meta: React.ReactNode[] = [];
  if (showBranch && claim.branch) {
    meta.push(
      <span key="branch" className="rounded bg-subtle-2 px-1.5 py-0.5 font-mono text-[10px] text-body">
        {claim.branch}
      </span>,
    );
  }
  if (claim.source === "manual") {
    meta.push(
      <span key="manual" className="text-[10px] font-semibold text-faint">
        Manual booking
      </span>,
    );
  }
  if (showUpdated && claim.jiraUpdatedAt) {
    meta.push(
      <span key="updated" className="whitespace-nowrap text-[10px] text-faint">
        Updated {agoText(claim.jiraUpdatedAt)} ago
      </span>,
    );
  }

  return (
    <div className="min-w-0 max-w-[30rem]">
      <div className="flex flex-wrap items-center gap-1.5">
        <TicketLink
          ticketKey={claim.id}
          source={claim.source}
          jiraBaseUrl={jiraBaseUrl}
          className="text-xs font-bold text-brand-fg"
        />
        {badge}
        {showStatus ? <JiraChip status={claim.status} /> : null}
      </div>
      <div className="mt-1">
        <TicketTitle claim={claim} lines={lines} />
      </div>
      {meta.length ? <div className="mt-1.5 flex flex-wrap items-center gap-2">{meta}</div> : null}
    </div>
  );
}

/** Names beside the faces. An avatar stack alone answers "how many people",
 *  not "who" — and most of the board has no uploaded picture, so the faces are
 *  initials that only mean something to people who already know. */
export function peopleText(people: { name: string }[], max = 2): string {
  if (!people.length) return "";
  const shown = people.slice(0, max).map((person) => person.name);
  const rest = people.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

/** A booking's progress as a bar. Tone follows urgency, not status: the bar is
 *  answering "how long do I wait", and amber means "soon". */
export function BookingBar({
  claim,
  minutes,
  className = "w-full",
}: {
  claim: Pick<Claim, "startTime" | "endTime">;
  minutes: number | null;
  className?: string;
}) {
  const pct = progress(claim);
  const tone = minutes !== null && minutes <= 0 ? "bg-bad" : isUrgent(minutes) ? "bg-warn" : "bg-brand-500";
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-subtle-2 ${className}`}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
    </div>
  );
}

/**
 * The "Frees in" cell, made to carry its own evidence: the countdown, a bar for
 * how far through the booking it is, and the end date — "3h" is only useful if
 * you can tell whether that means before or after lunch.
 */
export function BookingCell({
  claim,
  minutes,
  holding = true,
  align = "right",
}: {
  claim: Pick<Claim, "startTime" | "endTime">;
  minutes: number | null;
  /** A ticket that holds nothing does not "free" anything; its due date is
   *  just a due date. */
  holding?: boolean;
  align?: "left" | "right";
}) {
  const end = formatDateTime(claim.endTime);
  const alignCls = align === "right" ? "text-right ml-auto" : "";

  if (minutes === null) {
    return (
      <div className={`w-28 ${alignCls}`}>
        <p className="text-xs text-faint">{holding ? "No end time" : "No due date"}</p>
      </div>
    );
  }

  const expired = minutes <= 0;
  return (
    <div className={`w-28 ${alignCls}`}>
      <p
        className={`whitespace-nowrap text-sm font-semibold ${
          expired ? "text-bad" : isUrgent(minutes) ? "text-warn" : "text-ink-2"
        }`}
      >
        {expired ? (holding ? "Overdue" : "Past due") : leftText(minutes)}
      </p>
      {claim.startTime ? <BookingBar claim={claim} minutes={minutes} className="mt-1.5 w-full" /> : null}
      {end ? <p className="mt-1 whitespace-nowrap text-[10px] text-faint">until {end}</p> : null}
    </div>
  );
}
