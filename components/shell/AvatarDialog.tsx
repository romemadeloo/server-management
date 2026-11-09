"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { realtimeHeaders } from "@/lib/realtime/client";
import type { AuthUser } from "@/lib/types";

/** Must match AVATAR_MAX_BYTES on the server. Checked here only so a bad pick is
 *  reported instantly; the server is what actually enforces it. */
const MAX_BYTES = 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Pick a picture, see it, upload it.
 *
 * The preview is a local object URL, so it appears the instant a file is chosen
 * rather than after a round trip. What actually gets stored is the optimiser's
 * output, and the result line says so — a 900 KB photo becoming a 4 KB WebP is
 * worth showing, because it explains why the 1 MB limit is not stingy.
 */
export function AvatarDialog({
  user,
  currentUrl,
  onClose,
  onDone,
}: {
  user: AuthUser;
  currentUrl: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<{ from: number; to: number } | null>(null);

  function choose(picked: File | undefined) {
    setError(null);
    setSaved(null);
    if (!picked) return;

    if (picked.size > MAX_BYTES) {
      setError(
        `That image is ${(picked.size / (1024 * 1024)).toFixed(1)} MB. Please use one under 1 MB.`,
      );
      setFile(null);
      setPreview(null);
      return;
    }
    if (!ACCEPT.split(",").includes(picked.type)) {
      setError("Use a PNG, JPEG, WebP, GIF or AVIF image.");
      setFile(null);
      setPreview(null);
      return;
    }

    setFile(picked);
    // Revoked when the dialog unmounts with the component; a handful of object
    // URLs over a session is not worth tracking more carefully than that.
    setPreview(URL.createObjectURL(picked));
  }

  async function upload() {
    if (!file) {
      setError("Choose an image first.");
      return;
    }

    setError(null);
    setPending(true);

    const form = new FormData();
    form.set("file", file);

    const res = await fetch("/api/me/avatar", {
      method: "POST",
      headers: realtimeHeaders(),
      body: form,
    }).catch(() => null);

    const data = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      originalSize?: number;
      processedSize?: number;
    };
    setPending(false);

    if (!res?.ok || !data.ok) {
      setError(data.error ?? "Couldn't save that picture.");
      return;
    }

    setSaved({ from: data.originalSize ?? file.size, to: data.processedSize ?? 0 });
    onDone();
  }

  async function remove() {
    setError(null);
    setPending(true);
    const res = await fetch("/api/me/avatar", { method: "DELETE", headers: realtimeHeaders() }).catch(
      () => null,
    );
    setPending(false);

    if (!res?.ok) {
      setError("Couldn't remove that picture.");
      return;
    }
    setFile(null);
    setPreview(null);
    setSaved(null);
    onDone();
  }

  return (
    <Modal
      title="Profile picture"
      subtitle="Shown on the board, on your claims, and in chat."
      submitLabel={file ? "Save picture" : "Choose an image"}
      pending={pending}
      onSubmit={() => (file ? void upload() : input.current?.click())}
      onClose={onClose}
    >
      <div className="flex items-center gap-4">
        <Avatar
          person={{
            id: user.id,
            name: user.displayName,
            avatarUrl: preview ?? currentUrl,
          }}
          size="h-20 w-20"
        />

        <div className="min-w-0 flex-1">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => choose(e.target.files?.[0])}
          />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => input.current?.click()} disabled={pending}>
              {file ? "Pick another" : "Choose image"}
            </Button>
            {currentUrl || file ? (
              <Button size="sm" variant="danger" onClick={remove} disabled={pending}>
                Remove
              </Button>
            ) : null}
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            PNG, JPEG, WebP, GIF or AVIF, <strong>under 1 MB</strong>.
            {file ? ` Selected: ${kb(file.size)}.` : ""}
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-xl bg-subtle px-3.5 py-2.5 text-[11px] leading-relaxed text-muted">
        Your image is resized to 256&times;256 and re-encoded as WebP by the{" "}
        <a
          href="https://media-optimizer.eliesertajanlangit.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-fg hover:underline"
        >
          media optimiser
        </a>
        . That also strips the file&apos;s metadata, so a photo taken on a phone does not carry its
        location along with it.
      </p>

      {saved ? (
        <p className="mt-3 rounded-xl bg-ok-soft px-3.5 py-2.5 text-xs font-medium text-ok">
          Saved — {kb(saved.from)} optimised down to {kb(saved.to)}.
        </p>
      ) : null}

      <FormError>{error}</FormError>
    </Modal>
  );
}
