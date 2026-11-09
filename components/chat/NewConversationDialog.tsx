"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Field, FormError } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { RoleChip } from "@/components/ui/Chips";
import { realtimeHeaders } from "@/lib/realtime/client";
import { usePresence } from "@/components/providers/PresenceProvider";
import type { Person } from "./ConversationList";

/**
 * Start a DM or a group.
 *
 * Only people with an active login appear, because a conversation keyed on
 * anyone else could never be read (ADR-007). The empty state says so rather than
 * leaving someone wondering why a colleague is missing — most of the board has
 * no login, and that is normal here.
 */
export function NewConversationDialog({
  people,
  onClose,
}: {
  people: Person[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { online, tracking } = usePresence();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGroup = selected.length > 1;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) => p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q),
    );
  }, [people, query]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function submit() {
    if (!selected.length) {
      setError("Pick at least one person.");
      return;
    }

    setError(null);
    setPending(true);

    const body = isGroup
      ? { kind: "group", title: title.trim() || "Group", memberIds: selected }
      : { kind: "dm", userId: selected[0] };

    const res = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);

    const data = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      id?: string;
      error?: string;
      errors?: string[];
    };
    setPending(false);

    if (!res?.ok || !data.ok || !data.id) {
      setError([data.error, ...(data.errors ?? [])].filter(Boolean).join(" ") || "Couldn't start that.");
      return;
    }

    onClose();
    // refresh() so the list picks up the new conversation, then navigate into it.
    router.refresh();
    router.push(`/chat/${data.id}`);
  }

  return (
    <Modal
      title={isGroup ? "New group" : "New conversation"}
      subtitle="Only people who can sign in appear here."
      submitLabel={isGroup ? "Create group" : "Start chat"}
      pending={pending}
      onSubmit={submit}
      onClose={onClose}
    >
      {isGroup ? (
        <div className="mb-4">
          <Field
            label="Group name"
            placeholder="QA coordination"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      ) : null}

      <Field
        label="Find someone"
        placeholder="Name or username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl bg-subtle p-2">
        {matches.length ? (
          matches.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                  on ? "bg-brand-soft" : "hover:bg-surface"
                }`}
              >
                <Avatar
                  person={{ id: p.id, name: p.displayName, avatarUrl: p.avatarUrl }}
                  size="h-8 w-8"
                  online={tracking ? online.has(p.id) : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.displayName}</span>
                  <span className="block truncate text-[11px] text-faint">@{p.username}</span>
                </span>
                <RoleChip role={p.role} />
              </button>
            );
          })
        ) : people.length ? (
          <p className="px-2 py-6 text-center text-xs text-faint">Nobody matches that.</p>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-faint">
            Nobody else has a login yet. Most of the board is assignable to a claim without one — give
            someone access under Users first.
          </p>
        )}
      </div>

      {selected.length > 1 ? (
        <p className="mt-3 text-[11px] text-faint">
          {selected.length} people selected — this will create a group.
        </p>
      ) : null}

      <FormError>{error}</FormError>
    </Modal>
  );
}
