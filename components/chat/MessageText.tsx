"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { linkLabel, previewableLink, segments, youtubeEmbedUrl } from "@/lib/chat/links";
import { mentionSegments } from "@/lib/chat/mentions";
import type { LinkPreviewView } from "@/lib/db/queries/link-previews";

/**
 * A message body, with its links clickable — and no HTML anywhere.
 *
 * ── How this keeps the escaping invariant ──
 *
 * Invariant 7 in CLAUDE.md, and the note at the top of the Bubble component, is
 * that everything a user types is escaped: chat is the whole XSS surface of this
 * app. "Make links clickable" is the classic reason people reach for
 * `dangerouslySetInnerHTML`, and doing that here would hand one member's typing to
 * another member's DOM as markup.
 *
 * So `segments()` splits the body into text runs and links, and this maps them to
 * a string child or an `<a>`. **React escapes every one of them exactly as it did
 * when the body was a single text child.** There is no path from a message to
 * markup, and there must not be one.
 *
 * The `href` is separately validated: `safeHref` parses the URL and only http and
 * https survive, so a `javascript:` or `data:` URL renders as the text somebody
 * typed rather than as a link that runs in our origin.
 */

/** One renderable run: a mention, a link, or plain text. `key` is assigned during
 *  the two-pass split so React has a stable one without leaning on array index. */
type RenderPart =
  | { kind: "mention"; userId: string; name: string; raw: string; key: string }
  | { kind: "link"; value: string; href: string; key: string }
  | { kind: "text"; value: string; key: string };

export function MessageText({
  body,
  mine,
  viewerId,
  members,
  onOpenPerson,
}: {
  body: string;
  mine: boolean;
  /** So a mention of you can be highlighted differently — that is the whole point
   *  of being mentioned. */
  viewerId?: string;
  /** The conversation's current members, for resolving a mention's id to whatever
   *  that person is called TODAY. */
  members?: readonly { id: string; displayName: string }[];
  onOpenPerson?: (userId: string) => void;
}) {
  /**
   * Mentions are resolved before links.
   *
   * Order matters: a mention token contains parentheses and a uuid, and the URL
   * matcher would happily chew through the middle of one. Splitting on mentions
   * first means the link matcher only ever sees the plain text between them.
   */
  // Annotated, because `flatMap` over two differently-shaped branches infers a
  // union of arrays rather than an array of the union.
  const parts: RenderPart[] = mentionSegments(body).flatMap(
    // The callback's return type is annotated, not just the result: `flatMap` over
    // two differently-shaped branches otherwise infers a union of arrays, which is
    // not assignable to an array of the union.
    (part, outer): RenderPart[] =>
      part.kind === "mention"
        ? [{ ...part, key: `m${outer}` }]
        : segments(part.value).map((inner, i) => ({ ...inner, key: `t${outer}-${i}` })),
  );

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part) =>
        part.kind === "mention" ? (
          <MentionChip
            key={part.key}
            userId={part.userId}
            // Today's name where we have one, the name baked into the token
            // otherwise — which is what somebody who has since left the group
            // renders as. Without the fallback an old message would read
            // "@Former member" where a name used to be.
            name={members?.find((m) => m.id === part.userId)?.displayName ?? part.name}
            mine={mine}
            isViewer={part.userId === viewerId}
            onOpen={onOpenPerson}
          />
        ) : part.kind === "link" ? (
          <a
            key={part.key}
            href={part.href}
            target="_blank"
            // `noopener` so the opened page cannot reach back through
            // `window.opener`; `noreferrer` belts-and-braces over the app's global
            // `Referrer-Policy: no-referrer`, so an external site is never told
            // which internal page a link came from. `nofollow ugc` because this is
            // user-generated: nobody should be able to build ranking by pasting
            // links into a work chat.
            rel="noopener noreferrer nofollow ugc"
            // The full URL, because the label is deliberately abbreviated and
            // somebody hovering wants to know where they are actually going.
            title={part.href}
            className={`underline decoration-1 underline-offset-2 transition ${
              mine ? "text-white hover:decoration-2" : "text-brand-fg hover:decoration-2"
            }`}
          >
            {linkLabel(part.value)}
          </a>
        ) : (
          // A plain string child. Escaped by React, same as it always was.
          <span key={part.key}>{part.value}</span>
        ),
      )}
    </span>
  );
}

/**
 * A module-level cache of previews already asked for.
 *
 * Shared across every bubble, so scrolling a thread that repeats a link does not
 * re-ask for it, and a remount (a refresh, a navigation back) paints from memory
 * instead of round-tripping. The server caches too; this saves the request.
 *
 * The promise is stored, not the result, so two bubbles mounting in the same tick
 * with the same URL make ONE request rather than two.
 */
const inflight = new Map<string, Promise<LinkPreviewView | null>>();

function loadPreview(url: string): Promise<LinkPreviewView | null> {
  const existing = inflight.get(url);
  if (existing) return existing;

  const request = fetch("/api/chat/link-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { preview?: LinkPreviewView | null } | null) => data?.preview ?? null)
    .catch(() => null);

  inflight.set(url, request);
  return request;
}

/**
 * The card under a message that contains a link.
 *
 * ── Lazy, and silent when it fails ──
 *
 * Fetched after the message renders, never as part of it: a card is a nice extra,
 * and blocking a thread on somebody else's slow server to get one would be the
 * wrong trade. Until it arrives there is nothing — no skeleton, no spinner. A
 * placeholder that resolves to nothing (which is the common case, for pages with
 * no og: tags) is a flash of furniture for no reason.
 *
 * A failure renders nothing at all, deliberately. "Couldn't load preview" is noise
 * bolted to a link that is probably perfectly fine, and the link itself is right
 * there and clickable.
 *
 * ── One card per message ──
 *
 * `previewableLink` takes the first link only. A message pasting six URLs would
 * otherwise become a wall of cards taller than the conversation.
 */
export function LinkPreviewCard({ body, mine }: { body: string; mine: boolean }) {
  const url = previewableLink(body);
  const embedUrl = url ? youtubeEmbedUrl(url) : null;
  const [preview, setPreview] = useState<LinkPreviewView | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    void loadPreview(url).then((result) => {
      // Guarded, because a thread scrolls fast and a bubble can unmount while its
      // request is still open.
      if (!cancelled) setPreview(result);
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return null;
    }
  })();

  return (
    <>
      {embedUrl ? (
        <div className="mt-1.5 aspect-video overflow-hidden rounded-xl bg-black">
          <iframe
            src={embedUrl}
            title="YouTube video"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>
      ) : null}
      {!preview ? null : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className={`mt-1.5 block overflow-hidden rounded-xl transition ${
            mine
              ? "bg-white/15 hover:bg-white/25"
              : "bg-surface ring-1 ring-line-2 hover:ring-brand-soft"
          }`}
        >
      {preview.hasImage ? (
        // Through our own proxy, never the remote URL — see the route's comment. A
        // fixed height with object-cover so a card is the same shape whatever
        // aspect ratio the site advertises, and the thread does not reflow as
        // images land.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/chat/link-preview/image?url=${encodeURIComponent(url)}`}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-32 w-full bg-subtle-2 object-cover"
          // A card whose image 404s should be a card without an image, not a
          // broken-image icon.
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}

      <div className="px-2.5 py-2">
        <p
          className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
            mine ? "text-white/70" : "text-faint"
          }`}
        >
          <Icon name="external" className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{preview.siteName ?? host}</span>
        </p>

        {preview.title ? (
          <p
            className={`mt-0.5 line-clamp-2 text-xs font-bold ${mine ? "text-white" : "text-ink-2"}`}
          >
            {preview.title}
          </p>
        ) : null}

        {preview.description ? (
          <p className={`mt-0.5 line-clamp-2 text-[11px] ${mine ? "text-white/70" : "text-faint"}`}>
            {preview.description}
          </p>
        ) : null}
          </div>
        </a>
      )}
    </>
  );
}

/**
 * One `@Name` inside a message.
 *
 * ── A button, because a mention is a link to a person ──
 *
 * Tapping it opens that person's details. Not an `<a href>`: there is no page per
 * person in this app, and the useful thing in a chat is a card you can glance at
 * without leaving the thread — so the parent decides what "open" means and this
 * only reports the id.
 *
 * ── A mention OF YOU looks different ──
 *
 * That is the entire point of being mentioned: in a group of ten, the message
 * addressed to you has to be findable by eye while scrolling past forty that are
 * not. Every other mention is tinted but quiet.
 *
 * The name is a text child, escaped by React like everything else here. The chip
 * renders the CURRENT name resolved from the member list, not the one stored in
 * the token — which is what makes a mention survive a rename.
 */
function MentionChip({
  userId,
  name,
  mine,
  isViewer,
  onOpen,
}: {
  userId: string;
  name: string;
  mine: boolean;
  isViewer: boolean;
  onOpen?: (userId: string) => void;
}) {
  const tone = mine
    ? isViewer
      ? "bg-white/35 text-white font-bold"
      : "bg-white/20 text-white"
    : isViewer
      ? "bg-brand-500 text-white font-bold"
      : "bg-brand-soft text-brand-fg";

  return (
    <button
      type="button"
      onClick={() => onOpen?.(userId)}
      title={isViewer ? `${name} — this mentions you` : `See ${name}`}
      className={`mx-px rounded px-1 py-px transition hover:brightness-110 ${tone}`}
    >
      @{name}
    </button>
  );
}
