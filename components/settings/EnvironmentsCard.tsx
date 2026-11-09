"use client";

import { useRouter } from "next/navigation";
import { realtimeHeaders } from "@/lib/realtime/client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Select } from "@/components/ui/Form";
import { Card } from "@/components/ui/Layout";
import { Modal } from "@/components/ui/Modal";
import { shortRepo } from "@/lib/shared/tokens";
import type { Account, Environment } from "@/lib/types";

/**
 * Environments, and the repository URLs the health checks ping.
 *
 * ⚠ Those URLs are the crux of the open health-check question. A hostname like
 * `backend.srv-01.internal` is reachable from inside the network and from
 * nowhere else — a serverless function cannot resolve it. See
 * docs/06-OPEN-QUESTIONS.md Q1; the dialog says so rather than letting somebody
 * configure a check that can never succeed and wonder why.
 */
export function EnvironmentsCard({
  environments,
  accounts,
}: {
  environments: Environment[];
  accounts: Account[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Environment | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Environment | null>(null);

  const refresh = () => {
    setAdding(false);
    setEditing(null);
    setRemoving(null);
    router.refresh();
  };

  return (
    <Card title="Environments" sub="A box under one account, and the URL of each repository on it.">
      <div className="space-y-2">
        {environments.length ? (
          environments.map((env) => {
            const account = accounts.find((a) => a.id === env.accountId);
            const configured = env.repos.filter((r) => r.url).length;

            return (
              <div
                key={env.id}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-subtle px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{env.name}</p>
                  <p className="truncate text-[11px] text-faint">
                    {account?.displayName ?? "—"} · {configured} of {env.repos.length} URL
                    {env.repos.length === 1 ? "" : "s"} set
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="quiet" onClick={() => setEditing(env)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRemoving(env)}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-faint">No environments yet.</p>
        )}
      </div>

      <div className="mt-4">
        <Button variant="dark" onClick={() => setAdding(true)} disabled={!accounts.length}>
          Add environment
        </Button>
        {!accounts.length ? (
          <p className="mt-2 text-[11px] text-faint">Add an account first — an environment belongs to one.</p>
        ) : null}
      </div>

      {adding ? <EnvDialog accounts={accounts} onClose={() => setAdding(false)} onDone={refresh} /> : null}
      {editing ? (
        <EnvDialog env={editing} accounts={accounts} onClose={() => setEditing(null)} onDone={refresh} />
      ) : null}
      {removing ? (
        <RemoveEnvDialog env={removing} onClose={() => setRemoving(null)} onDone={refresh} />
      ) : null}
    </Card>
  );
}

function EnvDialog({
  env,
  accounts,
  onClose,
  onDone,
}: {
  env?: Environment;
  accounts: Account[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(env?.name ?? "");
  const [accountId, setAccountId] = useState(env?.accountId ?? accounts[0]?.id ?? "");
  const [urls, setUrls] = useState<Record<string, string>>(
    Object.fromEntries((env?.repos ?? []).map((r) => [r.repoName, r.url])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const repoNames = account?.repositories ?? [];
  const movingAccount = !!env && accountId !== env.accountId;

  async function submit() {
    setError(null);
    setPending(true);

    const res = await fetch(env ? `/api/servers/${encodeURIComponent(env.id)}` : "/api/servers", {
      method: "POST",
      headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, accountId, repoUrls: urls }),
    }).catch(() => null);

    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };

    if (!res?.ok || data.ok === false) {
      setPending(false);
      setError(data.errors?.join(" ") ?? "Couldn't save that environment.");
      return;
    }

    // A ticket for this exact account+branch may already be sitting in Jira —
    // ask for a sync now rather than waiting for the next scheduled pass.
    await fetch("/api/jira/sync-now", { method: "POST", headers: realtimeHeaders() }).catch(() => {});
    setPending(false);
    onDone();
  }

  return (
    <Modal
      title={env ? `Edit ${env.name}` : "Add an environment"}
      subtitle="The name is what Jira's Branch field is matched against."
      submitLabel={env ? "Save environment" : "Add environment"}
      pending={pending}
      wide
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field
          label="Environment name"
          placeholder="Server 01"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <Select
          label="Account"
          options={accounts.map((a) => ({ value: a.id, label: a.displayName }))}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        />

        {repoNames.length ? (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-muted">Repository URLs</p>
            {repoNames.map((repo) => (
              <Field
                key={repo}
                label={`${shortRepo(repo)} · ${repo}`}
                placeholder="https://backend.srv-01.internal"
                value={urls[repo] ?? ""}
                onChange={(e) => setUrls((u) => ({ ...u, [repo]: e.target.value }))}
                spellCheck={false}
              />
            ))}
            <p className="text-[11px] leading-relaxed text-warn">
              Health checks run from the cloud, so a private hostname like{" "}
              <code className="font-mono">*.internal</code> cannot be reached and will never report
              online. Leave a URL blank to mark that repository as unchecked rather than have it read
              as down.
            </p>
          </div>
        ) : (
          <p className="text-xs text-warn">
            That account defines no repositories yet — add some to it first.
          </p>
        )}

        {env && name.trim() && name !== env.name ? (
          <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs text-warn">
            Renaming this changes which Jira tickets match it. Claims already recorded here are
            rewritten to the new name, but tickets still filled in with &quot;{env.name}&quot; will stop
            being placed.
          </p>
        ) : null}

        {movingAccount ? (
          <p className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-xs text-bad">
            Moving this to another account changes which repository slots it carries. Slots the new
            account does not define are removed, along with their URLs, notes and any claim on them.
          </p>
        ) : null}
      </div>
      <FormError>{error}</FormError>
    </Modal>
  );
}

function RemoveEnvDialog({
  env,
  onClose,
  onDone,
}: {
  env: Environment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setPending(true);

    const res = await fetch(`/api/servers/${encodeURIComponent(env.id)}`, { method: "DELETE", headers: realtimeHeaders() }).catch(
      () => null,
    );
    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    setPending(false);

    if (!res?.ok || data.ok === false) {
      setError(data.errors?.join(" ") ?? "Couldn't remove that environment.");
      return;
    }
    onDone();
  }

  return (
    <Modal
      title={`Remove ${env.name}?`}
      submitLabel="Remove environment"
      variant="danger"
      pending={pending}
      onSubmit={submit}
      onClose={onClose}
    >
      <p className="text-sm text-body">
        Its repository URLs, notes, and every claim on it go with it. Jira tickets pointing at this
        branch will appear under <strong>Not tracked</strong> from the next sync.
      </p>
      <FormError>{error}</FormError>
    </Modal>
  );
}
