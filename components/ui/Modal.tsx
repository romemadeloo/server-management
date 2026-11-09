"use client";

import { useEffect, useRef } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";

/**
 * One modal shape, ported from Modals.open in the legacy public/js/ui/modals.js.
 *
 * Closes on the backdrop, the ✕, and Escape — the three the old one supported.
 * Focus moves to the first field on mount and is restored to whatever opened the
 * dialog on unmount, which the string-rendering version could not do.
 */
export function Modal({
  title,
  subtitle,
  children,
  submitLabel = "Save",
  variant = "dark",
  wide,
  pending,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  submitLabel?: string;
  variant?: "dark" | "danger";
  wide?: boolean;
  pending?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const on_close_ref = useRef(onClose);
  on_close_ref.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;

    const first = formRef.current?.querySelector<HTMLElement>(
      "input:not([type=checkbox]):not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])",
    );
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") on_close_ref.current();
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-8"
      // Only a click that both starts and ends on the backdrop closes it, so a
      // drag that began inside the dialog does not dismiss it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl bg-surface shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-faint">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition hover:bg-subtle-2 hover:text-ink-2"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <form
          ref={formRef}
          className="px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <button
              type="submit"
              disabled={pending}
              className={`rounded-full px-4 py-2.5 text-xs font-semibold transition disabled:opacity-50 ${
                variant === "danger"
                  ? "bg-bad-strong text-white hover:brightness-110"
                  : "bg-accent text-on-accent hover:bg-accent-2"
              }`}
            >
              {pending ? "Working…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
