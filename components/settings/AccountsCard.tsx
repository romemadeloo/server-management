"use client";

import { useRouter } from "next/navigation";
import { realtimeHeaders } from "@/lib/realtime/client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Field, FormError } from "@/components/ui/Form";
import { Card } from "@/components/ui/Layout";
import { Modal } from "@/components/ui/Modal";
import type { Account, Environment } from "@/lib/types";

/**
 * Accounts, and the repository slots each one defines.
 *
 * The warning in the edit dialog is the point of this component: an account's
 * display name is what Jira's "Account Name" field is matched against, and its
 * repository list defines the slots every environment under it carries. So both
 * edits ripple — a rename changes which tickets match, and dropping a repo takes
 * its URLs, notes and claims with it.
 */
export function AccountsCard({
  accounts,
  environments,
}: {
  accounts: Account[];
  environments: Environment[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Account | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);

  const envCount = (accountId: string) => environments.filter((e) => e.accountId === accountId).length;

  return (
    <Card
      title="Accounts"
      sub="A client, and the repositories every environment under it carries."
    >
      <div className="space-y-2">
        {accounts.length ? (
          accounts.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-subtle px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{account.displayName}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {account.repositories.map((repo) => (
                    <Chip key={repo} className="bg-subtle-2 text-muted">
                      {repo}
                    </Chip>
                  ))}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-faint">
                {envCount(account.id)} environment{envCount(account.id) === 1 ? "" : "s"}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="quiet" onClick={() => setEditing(account)}>
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => setRemoving(account)}>
                  Remove
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-faint">No accounts yet.</p>
        )}
      </div>

      <div className="mt-4">
        <Button variant="dark" onClick={() => setAdding(true)}>
          Add account
        </Button>
      </div>

      {adding ? <AccountDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); router.refresh(); }} /> : null}
      {editing ? (
        <AccountDialog
          account={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {removing ? (
        <RemoveAccountDialog
          account={removing}
          environmentCount={envCount(removing.id)}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

function AccountDialog({
  account,
  onClose,
  onDone,
}: {
  account?: Account;
  onClose: () => void;
  onDone: () => void;
}) {
  const [displayName, setDisplayName] = useState(account?.displayName ?? "");
  const [repos, setRepos] = useState((account?.repositories ?? ["storefront", "backend", "admin"]).join(", "));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextRepos = repos.split(",").map((r) => r.trim()).filter(Boolean);
  const dropped = (account?.repositories ?? []).filter((r) => !nextRepos.includes(r));

  async function submit() {
    setError(null);
    setPending(true);

    const res = await fetch(account ? `/api/accounts/${encodeURIComponent(account.id)}` : "/api/accounts", {
      method: "POST",
      headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, repositories: nextRepos }),
    }).catch(() => null);

    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    setPending(false);

    if (!res?.ok || data.ok === false) {
      setError(data.errors?.join(" ") ?? "Couldn't save that account.");
      return;
    }
    onDone();
  }

  return (
    <Modal
      title={account ? `Edit ${account.displayName}` : "Add an account"}
      subtitle="The display name is what Jira's Account Name field is matched against."
      submitLabel={account ? "Save account" : "Add account"}
      pending={pending}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field
          label="Display name"
          placeholder="Sticker Market"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <Field
          label="Repositories"
          placeholder="storefront, backend, admin"
          value={repos}
          onChange={(e) => setRepos(e.target.value)}
          required
        />
        <p className="text-[11px] leading-relaxed text-faint">
          Comma separated. These become the repository slots on every environment under this account.
          Jira&apos;s Repository field is matched against them, with{" "}
          <code className="font-mono">api</code> accepted for backend and{" "}
          <code className="font-mono">frontend</code> for storefront.
        </p>

        {account && dropped.length ? (
          <p className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-xs text-bad">
            Removing {dropped.join(", ")} deletes {dropped.length === 1 ? "that slot" : "those slots"}{" "}
            from every environment under this account — along with{" "}
            {dropped.length === 1 ? "its" : "their"} URLs, notes and any claim on{" "}
            {dropped.length === 1 ? "it" : "them"}.
          </p>
        ) : null}

        {account && displayName.trim() && displayName !== account.displayName ? (
          <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs text-warn">
            Renaming this changes which Jira tickets match it. Tickets still filled in with
            &quot;{account.displayName}&quot; will stop being placed until they are updated.
          </p>
        ) : null}
      </div>
      <FormError>{error}</FormError>
    </Modal>
  );
}

function RemoveAccountDialog({
  account,
  environmentCount,
  onClose,
  onDone,
}: {
  account: Account;
  environmentCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setPending(true);

    const res = await fetch(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE", headers: realtimeHeaders() }).catch(
      () => null,
    );
    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    setPending(false);

    if (!res?.ok || data.ok === false) {
      setError(data.errors?.join(" ") ?? "Couldn't remove that account.");
      return;
    }
    onDone();
  }

  return (
    <Modal
      title={`Remove ${account.displayName}?`}
      submitLabel="Remove account"
      variant="danger"
      pending={pending}
      onSubmit={submit}
      onClose={onClose}
    >
      <p className="text-sm text-body">
        {environmentCount
          ? `This account still has ${environmentCount} environment${environmentCount === 1 ? "" : "s"}. Remove or move ${environmentCount === 1 ? "it" : "them"} first — the database will refuse otherwise.`
          : "It owns no environments, so nothing else is affected."}
      </p>
      <FormError>{error}</FormError>
    </Modal>
  );
}
