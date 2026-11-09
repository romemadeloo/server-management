"use client";

import { Icon } from "@/components/ui/Icon";
import { attachmentHref } from "./Attachments";
import type { ReplyPreview } from "@/lib/db/queries/chat";

/**
 * The two places a reply shows itself: above the composer while you write it, and
 * inside the bubble once it is sent.
 *
 * They are one component's worth of content in two shells, and both render from
 * the same `ReplyPreview` the server produces — so the quote you see while typing
 * is character-for-character the quote everybody sees afterwards. Building the
 * composer chip from local state and the bubble quote from the server is how those
 * two drift.
 *
 * ── No sender name in the quote ──
 *
 * Just the quoted text (and a thumbnail when there was an image). The name is
 * deliberately absent: the quoted message is one tap away and already carries its
 * own author, and a bold name above one line of grey text made a two-line quote
 * out of what should read as a single line of context. `ReplyPreview.senderName`
 * is still delivered by the server — it is used for the reply's accessible label,
 * and it is there if this is ever reversed.
 */

/** The quoted line itself: a thumbnail when there was an image, then one line of
 *  text. Shared by both shells so they cannot drift. */
function QuoteBody({
  preview,
  thumbnailAttachmentId,
  attachmentCount,
  deleted,
  tone,
}: {
  preview: string;
  thumbnailAttachmentId: string | null;
  attachmentCount: number;
  deleted: boolean;
  /** `onBrand` sits inside the sender's own coloured bubble, where the normal
   *  muted greys are unreadable. */
  tone: "normal" | "onBrand";
}) {
  return (
    <>
      {thumbnailAttachmentId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachmentHref(thumbnailAttachmentId)}
          alt=""
          className="h-7 w-7 shrink-0 rounded-md object-cover"
        />
      ) : null}

      <span
        className={`flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] ${
          tone === "onBrand" ? "text-white/75" : "text-faint"
        }`}
      >
        {/* A paperclip only when there is no thumbnail to speak for the files — a
            picture of the attachment beats a symbol for it. */}
        {attachmentCount > 0 && !thumbnailAttachmentId ? (
          <Icon name="note" className="h-2.5 w-2.5 shrink-0" />
        ) : null}
        <span className={`truncate ${deleted ? "italic" : ""}`}>{preview}</span>
      </span>
    </>
  );
}

/**
 * The chip above the composer while a reply is being written.
 *
 * A left border rather than a box: it reads as a quotation, which is what it is,
 * and it takes one line of vertical space out of a composer that is already
 * competing with the thread for room.
 *
 * "Replying to" with no name after it, on purpose. It is a state label — what this
 * composer is currently doing — and it is what makes the chip legible as something
 * you are in the middle of rather than as a stray quotation.
 */
export function ReplyComposerChip({
  reply,
  onCancel,
}: {
  reply: ReplyPreview;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 pt-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-r-lg border-l-2 border-brand-500 bg-subtle py-1.5 pl-2.5 pr-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-brand-fg">
          Replying to
        </span>
        <QuoteBody
          preview={reply.preview}
          thumbnailAttachmentId={reply.thumbnailAttachmentId}
          attachmentCount={reply.attachmentCount}
          deleted={reply.deleted}
          tone="normal"
        />
      </div>

      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        title="Cancel reply"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition hover:bg-subtle-2 hover:text-ink-2"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * The quote inside a sent reply's bubble.
 *
 * A button, because tapping it jumps to the message being answered — which is the
 * whole reason a reply reference is worth rendering rather than just indenting.
 * `onJump` handles the case where the parent is not loaded yet; see Thread.
 *
 * The author's name is not rendered, but it IS in the accessible label: a sighted
 * reader can see which bubble this points at once they follow it, and a screen
 * reader user cannot, so the one place the name still earns its keep is the thing
 * announced before the jump.
 */
export function ReplyQuote({
  reply,
  viewerId,
  mine,
  onJump,
}: {
  reply: ReplyPreview;
  /** Only for the accessible label — "your message" rather than a name. */
  viewerId: string;
  mine: boolean;
  onJump: (messageId: number) => void;
}) {
  const who =
    reply.senderId === viewerId ? "your message" : `${reply.senderName ?? "a former member"}'s message`;

  return (
    <button
      type="button"
      onClick={() => onJump(reply.id)}
      title="Go to the message this replies to"
      aria-label={`Reply to ${who}: ${reply.preview}. Go to it.`}
      className={`mb-1 flex w-full items-center gap-2 rounded-lg border-l-2 py-1 pl-2 pr-1.5 text-left transition ${
        mine
          ? "border-white/60 bg-white/15 hover:bg-white/25"
          : "border-brand-500 bg-subtle-2 hover:bg-subtle"
      }`}
    >
      <QuoteBody
        preview={reply.preview}
        thumbnailAttachmentId={reply.thumbnailAttachmentId}
        attachmentCount={reply.attachmentCount}
        deleted={reply.deleted}
        tone={mine ? "onBrand" : "normal"}
      />
    </button>
  );
}
