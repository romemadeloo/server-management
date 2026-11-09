"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, FormError } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { realtimeHeaders } from "@/lib/realtime/client";
import {
  MEMBER_ROLE_LABEL,
  canManageGroup,
  canManageRoles,
  canRemoveMember,
  type MemberRole,
} from "@/lib/chat/groups";
import type { ConversationMember, ConversationSummary } from "@/lib/db/queries/chat";
import type { Person } from "./ConversationList";

/**
 * Must match AVATAR_MAX_BYTES and AVATAR_ACCEPTED_MIME on the server.
 *
 * Duplicated rather than imported, because lib/db/queries/avatars.ts reaches the
 * Neon driver and importing it into a client component would drag that into the
 * browser bundle. Checked here only so a bad pick is reported instantly; the
 * server is what enforces it. components/shell/AvatarDialog.tsx carries the same
 * pair for the same reason.
 */
const MAX_BYTES = 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

/** The subtitle's phrasing. A lookup rather than nested ternaries over the
 *  label, because "you are a admin" is the kind of thing those produce. */
const STANDING: Record<MemberRole, string> = {
  owner: "the owner",
  admin: "an admin",
  member: "a member",
};

/**
 * Manage a group: its name, its photo, and who is in it.
 *
 * ── Every button here is asked twice ──
 *
 * The same `canManageGroup` / `canRemoveMember` from lib/chat/groups.ts that the
 * route handlers call is what decides whether a control renders. That is the
 * point of those functions living in a shared module rather than as ifs on both
 * sides: **what this hides and what the server refuses cannot drift.** Hiding is
 * still only courtesy — every action below is refused server-side too, so a
 * hand-made request gets the same answer as a hidden button.
 *
 * ── Why it refetches instead of patching its own copy ──
 *
 * The member list feeds permission decisions. A local copy that is one event
 * stale is a copy that can be wrong at the exact moment somebody clicks
 * "Remove" — so after every action, and on every `members.changed`, this asks the
 * server again. It is one small request against getting authorization visibly
 * wrong.
 */

export function GroupDialog({
  conversation,
  viewerId,
  /** Bumped by the thread on `members.changed`, so an admin's dialog updates
   *  when somebody else changes the group underneath them. */
  refreshKey,
  onClose,
}: {
  conversation: ConversationSummary;
  viewerId: string;
  refreshKey?: number;
  onClose: () => void;
}) {
  const router = useRouter();

  const [detail, setDetail] = useState<ConversationSummary>(conversation);
  const [addable, setAddable] = useState<Person[] | null>(null);
  const [title, setTitle] = useState(conversation.title);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  const viewerRole = detail.viewerRole;
  const canManage = canManageGroup(viewerRole);
  const canRoles = canManageRoles(viewerRole);

  /** One place that turns any of these routes' answers into an error string. */
  const call = useCallback(
    async (
      key: string,
      url: string,
      init: RequestInit,
    ): Promise<Record<string, unknown> | null> => {
      setError(null);
      setPending(key);

      const res = await fetch(url, {
        ...init,
        headers: { ...realtimeHeaders(), ...(init.headers ?? {}) },
      }).catch(() => null);

      const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setPending(null);

      if (!res?.ok || !data.ok) {
        setError(data.error ?? "That didn't work.");
        return null;
      }
      return data as Record<string, unknown>;
    },
    [],
  );

  const reload = useCallback(async () => {
    const [detailRes, peopleRes] = await Promise.all([
      fetch(`/api/chat/conversations/${conversation.id}`).catch(() => null),
      fetch(`/api/chat/conversations/${conversation.id}/members`).catch(() => null),
    ]);

    const detailData = (await detailRes?.json().catch(() => ({}))) as {
      conversation?: ConversationSummary;
    };
    const peopleData = (await peopleRes?.json().catch(() => ({}))) as { people?: Person[] };

    if (detailData.conversation) {
      setDetail(detailData.conversation);
      setTitle(detailData.conversation.title);
    }
    // Null stays null on a failed fetch, so the picker says "loading" rather
    // than "nobody left to add" — two very different things.
    if (peopleData.people) setAddable(peopleData.people);
  }, [conversation.id]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const matches = useMemo(() => {
    const list = addable ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) => p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q),
    );
  }, [addable, query]);

  // ---------- actions ----------

  async function rename() {
    const next = title.trim();
    if (!next || next === detail.title) return;

    const ok = await call("rename", `/api/chat/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    if (ok) {
      await reload();
      router.refresh();
    }
  }

  async function uploadAvatar(file: File) {
    // Checked here purely so a bad pick is reported instantly. The server checks
    // too, and that is the check that counts.
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Please use one under 1 MB.`);
      return;
    }
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Use a PNG, JPEG, WebP, GIF or AVIF image.");
      return;
    }

    const form = new FormData();
    form.set("file", file);

    const ok = await call("avatar", `/api/chat/conversations/${conversation.id}/avatar`, {
      method: "POST",
      body: form,
    });
    if (ok) {
      await reload();
      router.refresh();
    }
  }

  async function removeAvatar() {
    const ok = await call("avatar", `/api/chat/conversations/${conversation.id}/avatar`, {
      method: "DELETE",
    });
    if (ok) {
      await reload();
      router.refresh();
    }
  }

  async function addSelected() {
    if (!selected.length) return;

    const ok = await call("add", `/api/chat/conversations/${conversation.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: selected }),
    });
    if (ok) {
      setSelected([]);
      setQuery("");
      await reload();
      router.refresh();
    }
  }

  async function removeMember(member: ConversationMember) {
    const ok = await call(
      `remove:${member.id}`,
      `/api/chat/conversations/${conversation.id}/members/${member.id}`,
      { method: "DELETE" },
    );
    if (ok) {
      await reload();
      router.refresh();
    }
  }

  async function setRole(member: ConversationMember, next: "admin" | "member") {
    const ok = await call(
      `role:${member.id}`,
      `/api/chat/conversations/${conversation.id}/members/${member.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberRole: next }),
      },
    );
    if (ok) {
      await reload();
      router.refresh();
    }
  }

  async function leave() {
    const ok = await call(
      "leave",
      `/api/chat/conversations/${conversation.id}/members/${viewerId}`,
      { method: "DELETE" },
    );
    if (ok) {
      onClose();
      router.refresh();
      // Out of a conversation that is no longer readable. Pushed rather than
      // left on a 404 the user has to work out for themselves.
      router.push("/chat");
    }
  }

  // ---------- render ----------

  return (
    <Modal
      title={detail.title}
      subtitle={`${detail.members.length} member${
        detail.members.length === 1 ? "" : "s"
      } · you are ${STANDING[viewerRole]}`}
      submitLabel="Done"
      wide
      onSubmit={onClose}
      onClose={onClose}
    >
      {/* ---------- identity ---------- */}
      <div className="flex items-center gap-4">
        <Avatar
          person={{ id: detail.id, name: detail.title, avatarUrl: detail.avatarUrl }}
          size="h-14 w-14"
        />
        <div className="min-w-0 flex-1">
          {canManage ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={pending === "avatar"}
                >
                  {pending === "avatar" ? "Working…" : detail.avatarUrl ? "Change photo" : "Add photo"}
                </Button>
                {detail.avatarUrl ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void removeAvatar()}
                    disabled={pending === "avatar"}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <p className="mt-1.5 text-[10px] text-faintest">
                PNG, JPEG, WebP, GIF or AVIF, under 1 MB. Resized to 256px.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-faint">
              Only the owner or an admin can change the group name and photo.
            </p>
          )}
        </div>
      </div>

      {/* ---------- name ---------- */}
      {canManage ? (
        <div className="mt-5 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label="Group name"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // The dialog's own submit closes it; Enter in this field means
                  // "save the name", which is what somebody typing here expects.
                  e.preventDefault();
                  void rename();
                }
              }}
            />
          </div>
          <Button
            size="md"
            variant="dark"
            onClick={() => void rename()}
            disabled={pending === "rename" || !title.trim() || title.trim() === detail.title}
          >
            {pending === "rename" ? "Saving…" : "Rename"}
          </Button>
        </div>
      ) : null}

      {/* ---------- members ---------- */}
      <div className="mt-6">
        <h3 className="text-xs font-bold tracking-tight">Members</h3>
        <div className="mt-2 divide-y divide-line rounded-xl bg-subtle">
          {detail.members.map((member) => {
            const mine = member.id === viewerId;
            const removable = canRemoveMember(viewerRole, member.memberRole, { samePerson: mine });
            const roleChangeable = canRoles && !mine && member.memberRole !== "owner";

            return (
              <div key={member.id} className="flex items-center gap-3 px-2.5 py-2">
                <Avatar
                  person={{ id: member.id, name: member.displayName, avatarUrl: member.avatarUrl }}
                  size="h-8 w-8"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {member.displayName}
                    {mine ? <span className="font-normal text-faint"> (you)</span> : null}
                  </span>
                  <span className="block truncate text-[11px] text-faint">
                    {MEMBER_ROLE_LABEL[member.memberRole]}
                  </span>
                </span>

                {roleChangeable ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      void setRole(member, member.memberRole === "admin" ? "member" : "admin")
                    }
                    disabled={pending === `role:${member.id}`}
                  >
                    {member.memberRole === "admin" ? "Remove admin" : "Make admin"}
                  </Button>
                ) : null}

                {removable ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void removeMember(member)}
                    disabled={pending === `remove:${member.id}`}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------- adding ---------- */}
      {canManage ? (
        <div className="mt-6">
          <h3 className="text-xs font-bold tracking-tight">Add people</h3>
          <div className="mt-2">
            <Field
              label="Find someone"
              placeholder="Name or username"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-subtle p-2">
            {addable === null ? (
              <p className="px-2 py-6 text-center text-xs text-faint">Loading…</p>
            ) : matches.length ? (
              matches.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSelected((prev) =>
                        prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                      )
                    }
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                      on ? "bg-brand-soft" : "hover:bg-surface"
                    }`}
                  >
                    <Avatar
                      person={{ id: p.id, name: p.displayName, avatarUrl: p.avatarUrl }}
                      size="h-8 w-8"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.displayName}</span>
                      <span className="block truncate text-[11px] text-faint">@{p.username}</span>
                    </span>
                  </button>
                );
              })
            ) : addable.length ? (
              <p className="px-2 py-6 text-center text-xs text-faint">Nobody matches that.</p>
            ) : (
              <p className="px-2 py-6 text-center text-xs text-faint">
                Everyone with a login is already in this group.
              </p>
            )}
          </div>

          {selected.length ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-faint">{selected.length} selected</p>
              <Button
                size="sm"
                variant="dark"
                onClick={() => void addSelected()}
                disabled={pending === "add"}
              >
                {pending === "add" ? "Adding…" : "Add to group"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- leaving ---------- */}
      <div className="mt-6 border-t border-line pt-4">
        {confirmLeave ? (
          <div className="rounded-xl bg-bad-soft px-3 py-2.5">
            <p className="text-[11px] font-semibold text-bad">
              {viewerRole === "owner"
                ? detail.members.length === 1
                  ? "You are the last member — leaving deletes this group and its messages."
                  : "You are the owner. Leaving hands the group to its longest-standing admin, or member."
                : "You'll stop receiving these messages. Someone can add you back."}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="danger"
                onClick={() => void leave()}
                disabled={pending === "leave"}
              >
                {pending === "leave" ? "Leaving…" : "Yes, leave"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setConfirmLeave(true)}>
            Leave group
          </Button>
        )}
      </div>

      <FormError>{error}</FormError>

      {/*
        Last in the DOM deliberately. Modal focuses the first enabled input on
        mount, and a `type="file"` matches that selector — put it up beside the
        "Change photo" button it belongs to and the dialog opens with focus on
        something invisible instead of on the group name.
      */}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the SAME file again still fires a change event —
          // otherwise a failed upload cannot be retried.
          e.target.value = "";
          if (file) void uploadAvatar(file);
        }}
      />
    </Modal>
  );
}
