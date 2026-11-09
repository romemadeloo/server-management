"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

/**
 * Transient notifications, bottom-right.
 *
 * Deliberately small in scope: it exists to tell somebody a message arrived
 * while they were looking elsewhere. Decisions worth stating:
 *
 *   - COALESCED PER CONVERSATION. A burst of five messages in one thread
 *     replaces one toast rather than stacking five. Otherwise a lively
 *     conversation buries the screen, which is worse than not notifying at all.
 *   - Capped at three visible, oldest dropped first.
 *   - Auto-dismisses, and the timer RESETS when the same conversation is
 *     updated, so a live thread keeps one toast alive rather than flickering.
 *   - Pauses nothing on hover, but a click navigates and clears — the toast is a
 *     shortcut to the conversation, not a thing to manage.
 */

const VISIBLE_LIMIT = 3;
const DISMISS_MS = 7000;

export interface Toast {
  /** One per conversation: a second message replaces the first. */
  key: string;
  title: string;
  body: string;
  href?: string;
  /** Opens an integration URL outside this Next.js app. */
  external?: boolean;
  /** For the avatar; falls back to initials of `title`. */
  avatarUrl?: string | null;
  count?: number;
}

interface ToastApi {
  show: (toast: Toast) => void;
  dismiss: (key: string) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, dismiss: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(key);
    }
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }, []);

  const show = useCallback(
    (toast: Toast) => {
      setToasts((prev) => {
        const without = prev.filter((t) => t.key !== toast.key);
        // Newest last, and never more than the cap.
        return [...without, toast].slice(-VISIBLE_LIMIT);
      });

      // Restart the clock, so an active conversation keeps one toast alive
      // instead of one expiring while the next appears.
      const existing = timers.current.get(toast.key);
      if (existing) clearTimeout(existing);
      timers.current.set(
        toast.key,
        setTimeout(() => dismiss(toast.key), DISMISS_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* aria-live so a screen reader announces an arrival without stealing focus. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const inner = (
            <>
              <Avatar
                person={{ id: toast.key, name: toast.title, avatarUrl: toast.avatarUrl }}
                size="h-9 w-9"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{toast.title}</span>
                  {toast.count && toast.count > 1 ? (
                    <span className="shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {toast.count}
                    </span>
                  ) : null}
                </span>
                {/* line-clamp keeps a pasted essay from becoming a full-height card. */}
                <span className="mt-0.5 line-clamp-2 block text-xs text-body">{toast.body}</span>
              </span>
            </>
          );

          return (
            <div
              key={toast.key}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl bg-surface p-3 shadow-xl ring-1 ring-line"
            >
              {toast.href && toast.external ? (
                <a
                  href={toast.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => dismiss(toast.key)}
                  className="flex min-w-0 flex-1 items-start gap-3"
                >
                  {inner}
                </a>
              ) : toast.href ? (
                <Link
                  href={toast.href}
                  onClick={() => dismiss(toast.key)}
                  className="flex min-w-0 flex-1 items-start gap-3"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 items-start gap-3">{inner}</div>
              )}

              <button
                type="button"
                onClick={() => dismiss(toast.key)}
                aria-label="Dismiss"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint transition hover:bg-subtle-2 hover:text-ink-2"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
