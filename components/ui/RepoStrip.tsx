import { shortRepo } from "@/lib/shared/tokens";
import { isRepoHeld } from "@/lib/shared/occupancy";
import type { Claim, Environment, ServerRepo } from "@/lib/types";

/**
 * The SF/API/ADM strip. Ported from H.repoStrip / H.repoChip.
 *
 * Green free, amber held, red offline, grey no URL. Reads identically on a card
 * and in a table, which is the point.
 *
 * A repository with a URL becomes a link — the tooltip carries the address and a
 * click opens it in a new tab. Without a URL there is nowhere to go, so it stays
 * a plain badge and says so on hover.
 */

const SHAPE = "block w-9 shrink-0 rounded-md py-0.5 text-center text-[9px] font-bold";

function chipClass(repo: ServerRepo, held: boolean): string {
  if (repo.health === "offline") return "bg-bad-strong/85 text-white";
  if (!repo.url || repo.health === "unconfigured") return "bg-line-2 text-muted";
  return held ? "bg-warn-strong/85 text-white" : "bg-ok-strong/85 text-white";
}

function stateWord(repo: ServerRepo, held: boolean): string {
  if (repo.health === "offline") return "offline";
  if (!repo.url) return "no URL configured";
  return held ? "held" : "free";
}

export function RepoChip({ repo, held }: { repo: ServerRepo; held: boolean }) {
  const label = shortRepo(repo.repoName);
  const cls = `${SHAPE} ${chipClass(repo, held)}`;
  const state = stateWord(repo, held);

  if (!repo.url) {
    return (
      <span title={`${repo.repoName}: ${state}`} className={cls}>
        {label}
      </span>
    );
  }

  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${repo.repoName}: ${state}\n${repo.url}`}
      className={`${cls} cursor-pointer transition hover:brightness-110 hover:ring-2 hover:ring-brand-300`}
    >
      {label}
    </a>
  );
}

export function RepoStrip({ env, claims }: { env: Environment; claims: Claim[] }) {
  return (
    <div className="flex gap-1">
      {env.repos.map((repo) => (
        <RepoChip
          key={repo.repoName}
          repo={repo}
          held={isRepoHeld(claims, env.id, repo.repoName)}
        />
      ))}
    </div>
  );
}
