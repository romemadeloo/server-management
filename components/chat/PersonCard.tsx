"use client";

import { Dialog as RadixDialog } from "radix-ui";
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
  // Radix Dialog rather than a hand-rolled overlay: it traps focus inside the
  // card, hands it back to the mention that opened it, and marks the thread
  // underneath inert for a screen reader — the old div did none of the three.
  return (
    <RadixDialog.Root open onOpenChange={(open) => (open ? null : onClose())}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-[rgb(10_14_13/0.45)] data-[state=open]:animate-overlay-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-xs -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg bg-surface shadow-overlay outline-none data-[state=open]:animate-dialog-in"
        >
        <div className="flex items-start gap-3 p-4">
          <Avatar
            person={{ id: member.id, name: member.displayName, avatarUrl: member.avatarUrl }}
            size="h-12 w-12"
            online={tracking ? online : undefined}
          />
          <div className="min-w-0 flex-1">
            <RadixDialog.Title className="truncate text-sm font-semibold text-ink">
              {member.displayName}
              {isViewer ? <span className="font-normal text-muted"> (you)</span> : null}
            </RadixDialog.Title>
            <p className="mt-0.5 text-xs text-muted">
              {MEMBER_ROLE_LABEL[member.memberRole]} in this conversation
            </p>
            {tracking ? (
              <p
                className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium ${
                  online ? "text-ok" : "text-muted"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${online ? "bg-ok" : "bg-faintest"}`}
                />
                {online ? "Online" : "Offline"}
              </p>
            ) : null}
          </div>

          <RadixDialog.Close
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-subtle-2 hover:text-ink"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </RadixDialog.Close>
        </div>

        <p className="flex items-center gap-1.5 border-t border-line bg-subtle px-4 py-2.5 text-xs text-muted">
          <Icon name="clock" className="h-3 w-3 shrink-0" />
          Joined {formatDateTime(member.joinedAt) ?? "this conversation"}
        </p>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
