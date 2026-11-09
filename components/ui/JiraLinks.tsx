import { Icon } from "@/components/ui/Icon";
import { issueUrl } from "@/lib/jira/client";
import { isRepoHeld } from "@/lib/shared/occupancy";
import { REPO_BADGE, repoBadgeState, shortRepo } from "@/lib/shared/tokens";
import type { Claim, ClaimSource, Environment } from "@/lib/types";

/**
 * The two things on a ticket row that are addresses, not labels: the Jira key
 * and the repositories it holds.
 *
 * These started as private helpers on the dashboard. Every other list — Active
 * tickets, My tickets, In use, an environment's claims — rendered the same two
 * values as dead text, so the same ticket was clickable on one page and not on
 * the next. Lifted here so there is one answer.
 *
 * Two rules are worth knowing before reusing them:
 *
 * - **Only a Jira-sourced claim gets a link.** A manual claim's id is
 *   "manual-…", which is not a Jira key; browsing to it would land on a 404 and
 *   read as the ticket having been deleted. Same when JIRA_BASE_URL is unset —
 *   there is no site to point at, so the key stays text.
 * - **A repository without a URL is not a link.** `url` is optional per repo
 *   (see the health checker), and an anchor with nowhere to go is worse than a
 *   badge. The tooltip says which case you are looking at.
 *
 * Server components only — `issueUrl` comes from the Jira client module.
 */

const REPO_CHIP =
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[10px] font-bold tracking-wide";

/** Lift on hover, so a linked badge reads as pressable. Colour is already
 *  spoken for — it is the state — so hover cannot use it. */
const REPO_LINK = "transition hover:brightness-105 hover:ring-2 hover:ring-brand-300";

export function TicketLink({
  ticketKey,
  jiraBaseUrl,
  source = "jira",
  icon = true,
  className = "text-xs font-semibold text-brand-fg",
  iconClassName = "h-3 w-3 opacity-60",
}: {
  ticketKey: string;
  jiraBaseUrl: string | null;
  /** Manual claims have no Jira issue to open. */
  source?: ClaimSource;
  /** Off where several keys sit on one truncated line and an icon each would
   *  cost more width than it buys. The underline and the tooltip still say it
   *  is a link, and the screen-reader note is not part of the icon. */
  icon?: boolean;
  /** Typography only — the layout classes are shared. */
  className?: string;
  iconClassName?: string;
}) {
  if (!jiraBaseUrl || source !== "jira") {
    return <span className={`whitespace-nowrap ${className}`}>{ticketKey}</span>;
  }

  return (
    <a
      href={issueUrl(jiraBaseUrl, ticketKey)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${ticketKey} in Jira`}
      className={`inline-flex items-center gap-1 whitespace-nowrap hover:underline ${className}`}
    >
      {ticketKey}
      {icon ? <Icon name="external" className={iconClassName} /> : null}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/**
 * The SF / API / ADM badges on a ticket, one per repository: each says what
 * state that repository is in, and each opens it.
 *
 * `repos` are the names the Jira ticket named; `environment` is the matched
 * environment, which is where the URLs and the health verdicts live. A
 * Not-tracked ticket has no environment, so every badge reads `unknown` —
 * correctly, since we do not know which box it meant.
 *
 * Pass `claims` — the whole board's claims — to have occupancy answered rather
 * than assumed. Without them a badge can only report reachability.
 *
 * The badges do NOT wrap. A ticket holding all three repositories was stacking
 * two-then-one inside a table cell, which reads as two separate facts and
 * throws the row out of line with the ticket key beside it. The tables these
 * sit in already scroll inside their own card rather than squeeze a column
 * (see components/ui/Table.tsx) — so the badges follow the same rule the ticket
 * keys and URLs there already do.
 */
export function ClaimRepoLinks({
  repos,
  environment,
  claims,
  className = "",
}: {
  repos: string[];
  environment: Environment | undefined;
  /** Every claim on the board. Omit only where occupancy is not knowable. */
  claims?: Claim[];
  /** Extra layout classes for the row of badges. */
  className?: string;
}) {
  return (
    <div className={`flex flex-nowrap items-center gap-1 ${className}`}>
      {repos.map((repoName) => {
        const repo = environment?.repos.find(
          (item) => item.repoName.toLowerCase() === repoName.toLowerCase(),
        );
        const held =
          !!environment &&
          !!claims &&
          isRepoHeld(claims, environment.id, repo?.repoName ?? repoName);
        const token = REPO_BADGE[repoBadgeState(repo, held)];
        const label = shortRepo(repoName);

        // The dot repeats the colour as a shape, so the state survives greyscale
        // and red/green colour blindness. The tooltip spells it out either way.
        const dot = <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${token.dot}`} />;
        const state = `${repo?.repoName ?? repoName}: ${token.word}`;

        return repo?.url ? (
          <a
            key={repoName}
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${state}\n${repo.url}`}
            className={`${REPO_CHIP} ${token.chip} ${REPO_LINK}`}
          >
            {dot}
            {label}
            <span className="sr-only"> — {token.word} (opens in a new tab)</span>
          </a>
        ) : (
          <span key={repoName} title={state} className={`${REPO_CHIP} ${token.chip}`}>
            {dot}
            {label}
            <span className="sr-only"> — {token.word}</span>
          </span>
        );
      })}
    </div>
  );
}
