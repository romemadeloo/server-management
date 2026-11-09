"use client";

import { useEffect } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { MEMBER_ROLE_LABEL } from "@/lib/chat/groups";
import { formatDateTime } from "@/lib/shared/format";
import type { ConversationMember } from "@/lib/db/queries/chat";

/**
 * Who somebody is, opened by tapping their @mention.
 *
 * ── Why a card and not a profile page ──
 *
 * There is no per-person page in this app, and building one to satisfy "clicking a
 * mention opens their details" would be answering a different question. In a chat,
 * the thing you want when you tap a name is to find out who they are **without
 * losing your place in the conversation** — so this is an overlay that closes on
 * Escape or a click outside, and the thread is still underneath it.
 *
 * Everything shown comes from the conversation's own member list, which the thread
 * already has. No fetch, so it opens instantly, and no endpoint that could serve
 * details about somebody the viewer shares no conversation with.
 */
export function PersonCard({
  member,
  online,
  tracking,
  isViewer,
  onClose,
}: {
  member: ConversationMember;
  online: boolean;
  /** Presence is not always being tracked. Undefined-ish state must render as
   *  nothing rather than as "offline", which is a different claim. */
  tracking: boolean;
  isViewer: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={member.displayName}
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Only a press that both starts and ends on the backdrop closes it, so a
        // drag beginning inside the card does not dismiss it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line">
        <div className="flex items-start gap-3 p-4">
          <Avatar
            person={{ id: member.id, name: member.displayName, avatarUrl: member.avatarUrl }}
            size="h-14 w-14"
            online={tracking ? online : undefined}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">
              {member.displayName}
              {isViewer ? <span className="font-normal text-faint"> (you)</span> : null}
            </p>
            <p className="mt-0.5 text-[11px] text-faint">
              {MEMBER_ROLE_LABEL[member.memberRole]} in this conversation
            </p>
            {tracking ? (
              <p
                className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${
                  online ? "text-ok" : "text-faint"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${online ? "bg-ok" : "bg-faintest"}`}
                />
                {online ? "Online" : "Offline"}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition hover:bg-subtle-2 hover:text-ink-2"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-[11px] text-faint">
          <Icon name="clock" className="h-3 w-3 shrink-0" />
          Joined {formatDateTime(member.joinedAt) ?? "this conversation"}
        </p>
      </div>
    </div>
  );
}
