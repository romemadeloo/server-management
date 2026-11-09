"use client";

import { useEffect, useRef } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { MEMBER_ROLE_LABEL } from "@/lib/chat/groups";
import type { ConversationMember } from "@/lib/db/queries/chat";

/**
 * The list that opens when somebody types `@` in a group composer.
 *
 * ── It is a listbox, not a menu, and it never takes focus ──
 *
 * Focus stays in the textarea the whole time. The dropdown is driven entirely by
 * keys the composer forwards (see Thread's `onKeyDown`), because moving focus into
 * a list and back out again loses the caret position — and the caret is exactly
 * what `applyMention` needs to know in order to replace the right span of text.
 *
 * So the ARIA is the `combobox`/`listbox` pairing: the textarea owns
 * `aria-activedescendant` pointing at the highlighted option here, which is how a
 * screen reader is told the selection moved without focus having moved.
 *
 * ── Only members ──
 *
 * `candidates` comes from the conversation's own member list. Somebody who is not
 * in the group is not offered, and the server re-checks membership before writing
 * a mention row — the same "hide in the UI, refuse on the server" split as
 * everything else in this app.
 */
export function MentionPicker({
  candidates,
  activeIndex,
  onPick,
  onHoverIndex,
}: {
  candidates: ConversationMember[];
  activeIndex: number;
  onPick: (member: ConversationMember) => void;
  onHoverIndex: (index: number) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the highlighted row visible when Arrow keys walk past the edge of the
  // scroll box. `block: "nearest"` so it only scrolls when it has to, rather than
  // yanking the list on every keystroke.
  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!candidates.length) return null;

  return (
    <div
      // Above the composer: the composer is at the bottom of the viewport, so a
      // list below it would open off-screen.
      className="absolute bottom-full left-0 z-30 mb-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-surface shadow-xl ring-1 ring-line"
    >
      <p className="border-b border-line px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-faint">
        Mention someone
      </p>

      <ul ref={listRef} id="mention-listbox" role="listbox" className="max-h-56 overflow-y-auto p-1">
        {candidates.map((member, index) => {
          const active = index === activeIndex;
          return (
            <li key={member.id}>
              <button
                type="button"
                id={`mention-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={active}
                // `onMouseDown` with preventDefault, NOT onClick: a click would
                // first blur the textarea, and the blur handler closes this list —
                // so by the time the click landed there would be nothing to pick.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(member);
                }}
                onMouseEnter={() => onHoverIndex(index)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                  active ? "bg-brand-soft" : "hover:bg-subtle"
                }`}
              >
                <Avatar
                  person={{ id: member.id, name: member.displayName, avatarUrl: member.avatarUrl }}
                  size="h-7 w-7"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{member.displayName}</span>
                  <span className="block truncate text-[10px] text-faint">
                    {MEMBER_ROLE_LABEL[member.memberRole]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
