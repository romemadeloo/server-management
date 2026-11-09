"use client";

import { useEffect, useRef, useState } from "react";
import {
  REACTION_EMOJI,
  REACTION_LABEL,
  reactedByViewer,
  reactionTooltip,
  type ReactionEmoji,
  type ReactionGroup,
} from "@/lib/chat/reactions";

/**
 * Reactions, in two pieces that live in two different places.
 *
 * ── Why they are split ──
 *
 * They answer different questions and therefore belong in different parts of the
 * bubble's layout:
 *
 *   `ReactionPicker`  the ⊕ that ADDS one. An action, so it sits ADJACENT to the
 *                     bubble in the same row as the avatar, and stays hidden until
 *                     the message is hovered. A permanent ⊕ under every message is
 *                     a column of grey circles down the whole thread.
 *
 *   `ReactionPills`   the ⊕👍 3 that are already there. Data, so it is always
 *                     visible, and it belongs UNDER the bubble where it reads as
 *                     being about that message.
 *
 * Keeping them in one component is what put the ⊕ below the bubble and made every
 * message taller by a row it did not need.
 */

/** Shared by both halves: hover reveal that survives the popover being open. */
function revealClasses(pinned: boolean): string {
  return pinned
    ? "opacity-100"
    : // `focus-within` is not decoration — a control that is only `opacity-0` is
      // still in the tab order, so without this it is reachable by Tab and
      // invisible while focused.
      //
      // `max-md:opacity-100` because HOVER DOES NOT EXIST ON A TOUCHSCREEN. A
      // hover-only affordance is an affordance a phone cannot reach at all, so
      // below the md breakpoint it is simply always there.
      "opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100";
}

/**
 * The ⊕ beside a message, and the panel it opens.
 *
 * ── Three ways to find out who reacted ──
 *
 * The requirement is one thing; the affordance has to be three, because `title`
 * does not exist on a touchscreen:
 *
 *   hover     `title` on each pill — free, and what a mouse reaches for first.
 *   tap       this panel lists every reaction with its reactors, no hover involved.
 *   keyboard  the pills and this ⊕ are real buttons, so Tab reaches them.
 */
export function ReactionPicker({
  reactions,
  viewerId,
  onToggle,
  align,
}: {
  reactions: ReactionGroup[];
  viewerId: string;
  onToggle: (emoji: string) => void;
  /** Which side of the bubble this sits on, so the popover opens inward rather
   *  than off the edge of the thread. */
  align: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else, and on Escape. Registered only while open, so
  // a thread of fifty messages is not fifty idle document listeners.
  useEffect(() => {
    if (!open) return;

    function onDocumentDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    // `pinned` while open: letting the hover rule win would make the panel vanish
    // the moment the pointer travelled from the ⊕ into it.
    <div ref={wrapper} className={`relative shrink-0 ${revealClasses(open)}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={reactions.length ? "React, or see who reacted" : "Add a reaction"}
        title={reactions.length ? "React, or see who reacted" : "Add a reaction"}
        className={`grid h-6 w-6 place-items-center rounded-full text-[11px] transition ${
          open
            ? "bg-brand-soft text-brand-fg ring-1 ring-brand-soft"
            : "text-faintest ring-1 ring-line-2 hover:bg-subtle hover:text-muted"
        }`}
      >
        <span aria-hidden="true">☺</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Reactions"
          // Above the ⊕ rather than below it: the newest messages sit at the
          // bottom of the scroller, where "below" is off-screen.
          className={`absolute bottom-full z-20 mb-1 w-max max-w-[15rem] rounded-2xl bg-surface p-2 shadow-xl ring-1 ring-line ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center gap-0.5">
            {REACTION_EMOJI.map((emoji) => {
              const group = reactions.find((g) => g.emoji === emoji);
              const mine = !!group && reactedByViewer(group, viewerId);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggle(emoji);
                    // Closed on pick. Reacting twice in a row is rare; a panel
                    // left open over the next message is not.
                    setOpen(false);
                  }}
                  aria-pressed={mine}
                  title={`${REACTION_LABEL[emoji as ReactionEmoji]}${mine ? " — remove yours" : ""}`}
                  className={`grid h-8 w-8 place-items-center rounded-full text-base transition hover:bg-subtle ${
                    mine ? "bg-brand-soft ring-1 ring-brand-soft" : ""
                  }`}
                >
                  <span aria-hidden="true">{emoji}</span>
                  <span className="sr-only">{REACTION_LABEL[emoji as ReactionEmoji]}</span>
                </button>
              );
            })}
          </div>

          {reactions.length ? (
            <div className="mt-2 space-y-1 border-t border-line pt-2">
              {reactions.map((group) => (
                <p key={group.emoji} className="flex items-start gap-1.5 text-[11px] text-faint">
                  <span aria-hidden="true" className="shrink-0">
                    {group.emoji}
                  </span>
                  {/* The full list here, not the abbreviated tooltip — this panel
                      is what somebody opens BECAUSE they want all the names. */}
                  <span className="min-w-0">
                    {group.users.map((u) => (u.id === viewerId ? "You" : u.displayName)).join(", ")}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The pills under a message.
 *
 * Always visible — they are content, not a control. Renders nothing at all when
 * there are none, so a message nobody reacted to costs no vertical space.
 *
 * Tapping a pill toggles YOUR reaction with that emoji, which is the gesture
 * every other chat app has already taught everybody. A single control with a menu
 * would put a click between the reader and the thing they wanted to agree with.
 */
export function ReactionPills({
  reactions,
  viewerId,
  onToggle,
  align,
}: {
  reactions: ReactionGroup[];
  viewerId: string;
  onToggle: (emoji: string) => void;
  align: "left" | "right";
}) {
  if (!reactions.length) return null;

  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-1 ${align === "right" ? "justify-end" : ""}`}
    >
      {reactions.map((group) => {
        const mine = reactedByViewer(group, viewerId);
        return (
          <button
            key={group.emoji}
            type="button"
            onClick={() => onToggle(group.emoji)}
            // The hover affordance. Says who, not just how many.
            title={`${reactionTooltip(group, viewerId)} reacted ${group.emoji}`}
            // Announced as a toggle, so a screen reader says "pressed" rather than
            // leaving the reader to infer it from a ring they cannot see.
            aria-pressed={mine}
            aria-label={`${group.users.length} ${group.emoji} — ${reactionTooltip(group, viewerId)}`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
              mine
                ? "bg-brand-soft text-brand-fg ring-1 ring-brand-soft"
                : "bg-subtle-2 text-muted ring-1 ring-line-2 hover:bg-subtle"
            }`}
          >
            <span aria-hidden="true">{group.emoji}</span>
            <span>{group.users.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Hover-revealed wrapper for the other per-message action (delete), so it
 *  appears and disappears in step with the ⊕ beside it. */
export function HoverAction({ children }: { children: React.ReactNode }) {
  return <span className={`shrink-0 ${revealClasses(false)}`}>{children}</span>;
}
