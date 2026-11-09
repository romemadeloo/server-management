"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { agoText } from "@/lib/shared/format";
import { usePresence } from "@/components/providers/PresenceProvider";
import { useUnread } from "@/components/providers/UnreadProvider";
import { NewConversationDialog } from "./NewConversationDialog";
import { orderConversations, preferLive } from "@/lib/chat/ordering";
import type { ConversationSummary } from "@/lib/db/queries/chat";

export interface Person {
  id: string;
  displayName: string;
  username: string;
  role: string;
  avatarUrl?: string | null;
}

/**
 * The conversation list.
 *
 * ── Ordering is live, and merged rather than refetched ──
 *
 * The server renders these sorted by `last_message_at`, which is correct at the
 * moment the page is built and stale a second later. Rather than refetching the
 * whole tree on every message, the list merges the live `activity` the
 * UnreadProvider has collected over the server's rows, and sorts the result.
 *
 * That is what makes a conversation rise to the top the instant a message is sent
 * or received — including for the **sender**, whose own tab is excluded from the
 * Pusher fan-out by socket id and therefore hears nothing (see `bump`), and
 * including for members who **muted** it, who deliberately get the event without
 * the toast.
 *
 * Merging by conversation id — not concatenating — is what stops a conversation
 * appearing twice: live data can only ever replace a field on a row that already
 * exists. A genuinely NEW conversation still needs the server (there is no row to
 * merge into), which `conversation.added` triggers a refresh for.
 *
 * Unread counts still come from the server on each refresh. They are derived from
 * the read watermark (ADR-006), so the server's answer is authoritative and the
 * live number is only there to bridge the gap until the next render.
 */
export function ConversationList({
  conversations,
  people,
  viewerId,
}: {
  conversations: ConversationSummary[];
  people: Person[];
  viewerId: string;
}) {
  const { online, tracking } = usePresence();
  const { byConversation, activity } = useUnread();
  const params = useParams<{ conversationId?: string }>();
  const activeId = params?.conversationId;
  const [composing, setComposing] = useState(false);

  /**
   * The server's rows with live activity folded in, newest first.
   *
   * The comparison is on the LATER of the two timestamps, never blindly on the
   * live one: a `router.refresh()` can land after an event, and taking the live
   * value unconditionally would walk a conversation backwards if the server's row
   * were somehow newer.
   *
   * Ties break on `seq` — the arrival counter — then on id. Two people sending in
   * the same millisecond is rare but not impossible, and a sort that is not total
   * lets the top two rows swap places on every unrelated render.
   */
  const ordered = useMemo(
    () => orderConversations(conversations, activity),
    [conversations, activity],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold tracking-tight">Chat</h2>
        <Button size="sm" variant="dark" onClick={() => setComposing(true)}>
          New
        </Button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {ordered.length ? (
          ordered.map((c) => {
            const active = c.id === activeId;
            const other = c.kind === "dm" ? c.members.find((m) => m.id !== viewerId) : undefined;
            const live = activity[c.id];
            // Live count when one has arrived this session, otherwise the
            // server's. `?? ` and not `||`, so a live zero — a thread just read
            // — correctly beats a stale non-zero from the last render.
            const unread = byConversation[c.id] ?? c.unreadCount;
            // The newest of the two, for the timestamp and the preview line. Same
            // rule as the sort: never take the live value just because it exists.
            // The SAME predicate the sort used. If these disagreed, a row would
            // move to the top while still showing the previous message under it.
            const useLive = preferLive(c, live);
            const lastAt = useLive && live ? live.lastMessageAt : c.lastMessageAt;
            const preview =
              useLive && live
                ? // In a group, who said it matters as much as what they said. The
                  // server's own preview does not carry a name, so this only
                  // prefixes the live one.
                  live.senderName && c.kind === "group"
                  ? `${live.senderName}: ${live.preview}`
                  : live.preview
                : c.lastMessagePreview;
            return (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                className={`mb-1 flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition ${
                  active ? "bg-brand-soft" : "hover:bg-subtle"
                }`}
              >
                {/* For a DM this is the other member's face; for a group its own
                    photo, falling back to initials of its name — which reads as a
                    group rather than as a person. */}
                <Avatar
                  person={{
                    id: c.id,
                    name: c.title,
                    avatarUrl: c.kind === "group" ? c.avatarUrl : (other?.avatarUrl ?? null),
                  }}
                  size="h-9 w-9"
                  // A dot only where it means something: on one identifiable
                  // person, and only when presence is actually being tracked.
                  online={tracking && other ? online.has(other.id) : undefined}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p
                      className={`min-w-0 flex-1 truncate text-sm ${
                        unread ? "font-bold text-ink" : "font-semibold text-ink-2"
                      }`}
                    >
                      {c.title}
                    </p>
                    {lastAt ? (
                      <span className="shrink-0 text-[10px] text-faint">{agoText(lastAt)}</span>
                    ) : null}
                  </div>

                  <div className="mt-0.5 flex items-center gap-2">
                    <p
                      className={`min-w-0 flex-1 truncate text-[11px] ${
                        unread ? "font-medium text-body" : "text-faint"
                      }`}
                    >
                      {preview ?? "No messages yet"}
                    </p>
                    {unread ? (
                      <span className="shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : null}
                  </div>

                  {c.kind === "group" ? (
                    <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-faintest">
                      {/* Says "group" as well as counting, so a two-person group
                          is not mistaken for a DM at a glance. */}
                      <Icon name="users" className="h-2.5 w-2.5" />
                      {c.members.length} member{c.members.length === 1 ? "" : "s"}
                      {c.viewerRole === "member" ? null : ` · you're the ${c.viewerRole}`}
                    </p>
                  ) : null}
                </div>
              </Link>
            );
          })
        ) : (
          <div className="px-3 py-10 text-center">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-subtle-2 text-faint">
              <Icon name="chat" className="h-5 w-5" />
            </span>
            <p className="mt-3 text-xs text-faint">No conversations yet.</p>
            <p className="mt-1 text-[11px] text-faintest">
              Only people with a login can be messaged.
            </p>
          </div>
        )}
      </div>

      {composing ? (
        <NewConversationDialog people={people} onClose={() => setComposing(false)} />
      ) : null}
    </div>
  );
}
