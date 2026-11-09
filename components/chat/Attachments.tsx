"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { attachmentKind, formatBytes, typeLabel } from "@/lib/chat/attachments";
import type { AttachmentView } from "@/lib/db/queries/attachments";

/**
 * Attachments, as they appear inside a message bubble.
 *
 * ── Every file is fetched from us, never from the store ──
 *
 * `/api/chat/attachments/<id>` is the only URL that appears here. There is no blob
 * URL in this component, in the props it receives, or in the realtime event that
 * delivered them — the store is private, and the proxy re-checks conversation
 * membership on every single read. That is what makes access revocable: somebody
 * removed from a group stops being able to load these images, and a link pasted
 * elsewhere is worthless to whoever receives it.
 *
 * ── Two renderings, decided by kind and not by count ──
 *
 *   image  a thumbnail that opens a lightbox. Sized from the stored width/height
 *          so the bubble reserves the right box and the thread does not reflow
 *          when the picture lands.
 *   other  a file card: name, type, size, and an action. A PDF opens in a tab
 *          because browsers render PDFs; everything else downloads.
 */

/** Where the bytes come from. One place, so nothing can accidentally build a
 *  store URL instead. */
export function attachmentHref(id: string, opts?: { download?: boolean }): string {
  return `/api/chat/attachments/${id}${opts?.download ? "?download=1" : ""}`;
}

export function AttachmentGrid({
  attachments,
  mine,
  onOpenImage,
}: {
  attachments: AttachmentView[];
  /** Tints the file cards to sit legibly on the sender's own bubble colour. */
  mine: boolean;
  onOpenImage: (attachment: AttachmentView) => void;
}) {
  if (!attachments.length) return null;

  const images = attachments.filter((a) => attachmentKind(a.mime) === "image");
  const files = attachments.filter((a) => attachmentKind(a.mime) !== "image");

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length ? (
        // One image gets the full width; several tile in two columns. A grid that
        // is always two columns makes a lone screenshot half the size it should
        // be, and a grid that is never two columns makes five of them a column
        // half a screen tall.
        <div className={`grid gap-1.5 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onOpenImage(image)}
              title={`${image.filename} — ${formatBytes(image.bytes)}`}
              className="group/img relative overflow-hidden rounded-xl bg-subtle-2 ring-1 ring-line-2 transition hover:ring-brand-soft"
            >
              {/* A plain <img>, not next/image: these are already re-encoded to a
                  bounded WebP on the way in, and next/image would put its own
                  loader in front of an authenticated route for no benefit.
                  eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachmentHref(image.id)}
                alt={image.filename}
                // Stored dimensions, so the box is the right shape before the
                // bytes arrive. Without these the thread jumps as each image
                // loads, which on a long scrollback is unusable.
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                loading="lazy"
                decoding="async"
                className="max-h-72 w-full object-cover"
              />
              <span className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover/img:bg-black/10" />
            </button>
          ))}
        </div>
      ) : null}

      {files.map((file) => {
        const kind = attachmentKind(file.mime);
        return (
          <a
            key={file.id}
            // A PDF opens inline in a new tab; anything else downloads. `download`
            // as a *parameter*, not the HTML attribute — the attribute is ignored
            // cross-origin and, more to the point, the server is what decides
            // whether a file may render in this origin at all.
            href={attachmentHref(file.id, { download: kind !== "pdf" })}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition ${
              mine
                ? "bg-white/15 hover:bg-white/25"
                : "bg-surface ring-1 ring-line-2 hover:ring-brand-soft"
            }`}
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[9px] font-bold ${
                mine ? "bg-white/20 text-white" : "bg-subtle-2 text-muted"
              }`}
            >
              {/* The type, not a generic paperclip: "PDF" and "Excel" tell you
                  whether you can open it before you click. */}
              {typeLabel(file.mime).slice(0, 4).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-xs font-semibold ${mine ? "text-white" : ""}`}>
                {file.filename}
              </span>
              <span className={`block text-[10px] ${mine ? "text-white/70" : "text-faint"}`}>
                {typeLabel(file.mime)} · {formatBytes(file.bytes)}
              </span>
            </span>
            <Icon
              name={kind === "pdf" ? "external" : "chevron"}
              className={`h-3.5 w-3.5 shrink-0 ${mine ? "text-white/80" : "text-faint"} ${
                kind === "pdf" ? "" : "rotate-90"
              }`}
            />
          </a>
        );
      })}
    </div>
  );
}

/**
 * The larger view of an image.
 *
 * Deliberately not a route or a modal component: it is one overlay over the
 * thread, so opening it does not navigate, does not lose scroll position, and
 * closes on Escape or a click on the backdrop — the three ways everybody already
 * expects to get out of a photo.
 *
 * The image is the same file the thumbnail used, so it is already in the browser
 * cache and opens instantly. There is no second, larger copy stored; see
 * ATTACHMENT_OPTIONS in lib/media/optimizer.ts for why.
 */
export function ImageLightbox({
  attachment,
  onClose,
}: {
  attachment: AttachmentView;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while an overlay is over it, or a trackpad
    // gesture scrolls the thread out from under the picture.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Only a press that starts on the backdrop closes it, so a drag that began
        // on the image does not dismiss it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">
            {attachment.filename}
          </span>
          <span className="block text-[11px] text-white/60">
            {attachment.width && attachment.height
              ? `${attachment.width} × ${attachment.height} · `
              : ""}
            {formatBytes(attachment.bytes)}
          </span>
        </span>

        <a
          href={attachmentHref(attachment.id, { download: true })}
          className="rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/25"
        >
          Download
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachmentHref(attachment.id)}
          alt={attachment.filename}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
    </div>
  );
}

/**
 * One file in the composer, before it is sent.
 *
 * ── Why this has four states and not two ──
 *
 * A file being uploaded, a file that finished, a file that failed, and a file that
 * is too big to have been tried are four different things a person can do
 * something about, and collapsing them into "loading / not loading" is how an
 * upload that failed silently looks like an upload that is still going. The
 * failure carries its reason and a retry; the rest carry a size.
 */
export interface StagedFile {
  /** Local, stable across the upload's lifetime. Not the attachment id — there is
   *  no attachment id until the upload succeeds. */
  key: string;
  filename: string;
  bytes: number;
  mime: string;
  status: "uploading" | "done" | "error";
  /** 0–100. Real, from the XHR's upload progress events. */
  progress: number;
  error?: string;
  /** Present once staged server-side. Its `id` is what the send claims. */
  attachment?: AttachmentView;
  /** A local object URL, so an image previews instantly rather than after a round
   *  trip through the store. */
  localPreview?: string;
}

export function ComposerAttachments({
  files,
  onRemove,
  onRetry,
}: {
  files: StagedFile[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  if (!files.length) return null;

  return (
    <div className="flex flex-wrap gap-2 border-t border-line px-3 pt-2.5">
      {files.map((file) => {
        const isImage = attachmentKind(file.mime) === "image";
        return (
          <div
            key={file.key}
            className={`relative flex w-44 items-center gap-2 overflow-hidden rounded-xl bg-subtle p-1.5 pr-7 ring-1 ${
              file.status === "error" ? "ring-bad" : "ring-line-2"
            }`}
          >
            {isImage && file.localPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.localPreview}
                alt=""
                className="h-9 w-9 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-subtle-2 text-[9px] font-bold text-muted">
                {typeLabel(file.mime).slice(0, 4).toUpperCase()}
              </span>
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold">{file.filename}</span>
              {file.status === "error" ? (
                <button
                  type="button"
                  onClick={() => onRetry(file.key)}
                  title={file.error}
                  className="block max-w-full truncate text-[10px] font-semibold text-bad hover:underline"
                >
                  Failed — retry
                </button>
              ) : file.status === "uploading" ? (
                // A real bar, not a spinner. A spinner on a 20 MB upload over a
                // slow connection is indistinguishable from a hang.
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-subtle-2">
                  <span
                    className="block h-full rounded-full bg-brand-500 transition-[width] duration-150"
                    style={{ width: `${Math.max(4, file.progress)}%` }}
                  />
                </span>
              ) : (
                <span className="block text-[10px] text-faint">{formatBytes(file.bytes)}</span>
              )}
            </span>

            <button
              type="button"
              onClick={() => onRemove(file.key)}
              aria-label={`Remove ${file.filename}`}
              title={`Remove ${file.filename}`}
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-surface/80 text-faint transition hover:text-bad"
            >
              <Icon name="close" className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The paperclip. A button and not a bare `<input type="file">`, because a file
 *  input cannot be styled into something that matches the send button. */
export function AttachButton({
  onPick,
  disabled,
  accept,
}: {
  onPick: (files: File[]) => void;
  disabled?: boolean;
  accept: string;
}) {
  const [inputKey, setInputKey] = useState(0);

  return (
    <label
      title="Attach a file"
      className={`grid h-[42px] w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-faint transition hover:bg-subtle hover:text-brand-fg ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <input
        // Remounted after every pick, which is what makes choosing the SAME file
        // twice fire a change event. Clearing `value` works too, but only if the
        // handler runs — and it does not when the pick is rejected before it.
        key={inputKey}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          setInputKey((k) => k + 1);
          if (picked.length) onPick(picked);
        }}
      />
      <Icon name="plus" className="h-4 w-4" />
      <span className="sr-only">Attach a file</span>
    </label>
  );
}
