"use client";

import { Dialog as RadixDialog } from "radix-ui";
import { useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";

/**
 * Dialogs, on Radix's Dialog primitive.
 *
 * The hand-rolled version handled Escape, the backdrop and focus-on-open, but
 * not the parts that are easy to get subtly wrong: focus was not *trapped*, so
 * Tab walked out of the dialog into the page behind it; the page behind still
 * scrolled; nothing told a screen reader the rest of the page was inert; and it
 * rendered in place, so an ancestor with `overflow-hidden` or a transform could
 * clip it. Radix does all four (focus trap, scroll lock, `aria-hidden` on
 * siblings, a portal), and returns focus to the opener on close.
 *
 * Layout follows the Carbon / Atlassian modal: a header with the title, a body
 * that scrolls on its own, and a footer that is always on screen — so a long
 * form never pushes its Save button below the fold. On a phone it becomes a
 * bottom sheet, which is where a thumb can reach it.
 *
 * Callers mount it conditionally (`{open ? <Modal …/> : null}`), so it is always
 * open while it exists; closing is the caller unmounting it.
 */

export type ModalSize = "sm" | "md" | "lg";

const WIDTHS: Record<ModalSize, string> = {
  sm: "sm:max-w-[420px]",
  md: "sm:max-w-[520px]",
  lg: "sm:max-w-[680px]",
};

/** The overlay, panel and header every dialog shares — form or not. */
export function DialogFrame({
  title,
  subtitle,
  size = "md",
  tone = "default",
  onClose,
  children,
  initialFocus = "first-field",
}: {
  title: string;
  subtitle?: React.ReactNode;
  size?: ModalSize;
  tone?: "default" | "danger";
  onClose: () => void;
  children: React.ReactNode;
  /** "first-field" puts the caret in the first input, which is what a form
   *  dialog is opened for. "panel" focuses the dialog itself, for dialogs whose
   *  first control would be a surprising place to land (a destructive button). */
  initialFocus?: "first-field" | "panel";
}) {
  // Where focus goes back to on close, captured during the first render —
  // before Radix's focus scope moves it. Radix would restore to whatever was
  // focused at open, but a dialog opened from a menu item was opened by an
  // element that unmounts with the menu, and focus then falls to <body>. So a
  // menu item is traded for the button that opened the menu.
  const [return_to] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    const active = document.activeElement as HTMLElement | null;
    const menu = active?.closest<HTMLElement>("[role=menu]");
    const trigger_id = menu?.getAttribute("aria-labelledby");
    return (trigger_id ? document.getElementById(trigger_id) : null) ?? active;
  });

  return (
    <RadixDialog.Root open onOpenChange={(open) => (open ? null : onClose())}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-[rgb(2_6_4/0.55)] backdrop-blur-[3px] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <RadixDialog.Content
          onOpenAutoFocus={(event) => {
            const panel = event.currentTarget as HTMLElement;
            const target =
              initialFocus === "first-field"
                ? panel.querySelector<HTMLElement>(
                    "input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])",
                  )
                : null;
            event.preventDefault();
            (target ?? panel).focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!return_to?.isConnected) return;
            event.preventDefault();
            return_to.focus();
          }}
          className={[
            "glass glass-float fixed z-50 flex flex-col border border-line bg-surface shadow-overlay outline-none",
            // phone: a sheet pinned to the bottom edge
            "inset-x-0 bottom-0 max-h-[calc(100dvh-2.5rem)] rounded-t-3xl data-[state=open]:animate-sheet-in",
            // tablet and up: centred, a little above the optical middle
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[12vh] sm:max-h-[min(76vh,52rem)] sm:w-[calc(100vw-3rem)] sm:-translate-x-1/2 sm:rounded-3xl sm:data-[state=open]:animate-dialog-in",
            "data-[state=closed]:animate-dialog-out",
            WIDTHS[size],
          ].join(" ")}
        >
          <header className="flex shrink-0 items-start gap-3 px-6 pb-3 pt-5">
            {tone === "danger" ? (
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bad-soft text-bad">
                <Icon name="alert" className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-lg font-semibold leading-6 tracking-[-0.01em] text-ink">{title}</RadixDialog.Title>
              {subtitle ? (
                <RadixDialog.Description className="mt-0.5 text-[13px] leading-5 text-muted">
                  {subtitle}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-1.5 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-subtle-2 hover:text-ink"
            >
              <Icon name="close" className="h-4 w-4" />
            </RadixDialog.Close>
          </header>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** The scrolling middle of a dialog. */
export function DialogBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-1 ${className}`}>{children}</div>;
}

/** The pinned action row. Primary action last, on the right — the convention
 *  every desktop OS and design system the team uses agrees on. */
export function DialogFooter({ children, start }: { children: React.ReactNode; start?: React.ReactNode }) {
  return (
    <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-subtle px-6 py-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
      {start ? <div className="mr-auto min-w-0 text-xs text-muted">{start}</div> : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </footer>
  );
}

/**
 * The form dialog: everything above, plus a `<form>` around the body and
 * footer so Enter submits, and a Cancel / primary pair in the footer.
 *
 * `variant="danger"` is a confirmation of something destructive: it narrows
 * the dialog, marks the header, makes the primary button red, and focuses the
 * panel rather than any button — so a stray Enter does not confirm it.
 */
export function Modal({
  title,
  subtitle,
  children,
  submitLabel = "Save",
  variant = "dark",
  wide,
  size,
  pending,
  footerStart,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  submitLabel?: string;
  variant?: "dark" | "danger";
  /** Kept for existing callers; same as `size="lg"`. */
  wide?: boolean;
  size?: ModalSize;
  pending?: boolean;
  footerStart?: React.ReactNode;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const danger = variant === "danger";
  const resolved: ModalSize = size ?? (wide ? "lg" : danger ? "sm" : "md");

  return (
    <DialogFrame
      title={title}
      subtitle={subtitle}
      size={resolved}
      tone={danger ? "danger" : "default"}
      initialFocus={danger ? "panel" : "first-field"}
      // While a request is in flight, closing would orphan its result.
      onClose={pending ? () => {} : onClose}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) onSubmit();
        }}
      >
        <DialogBody>{children}</DialogBody>
        <DialogFooter start={footerStart}>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? "destructive" : "primary"} disabled={pending} aria-busy={pending}>
            {pending ? <Spinner /> : null}
            {pending ? "Working…" : submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogFrame>
  );
}

export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
