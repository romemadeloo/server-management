"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type JiraNotification,
  useJiraNotifications,
} from "@/components/providers/JiraNotificationProvider";
import { Icon } from "@/components/ui/Icon";
import { agoText } from "@/lib/shared/format";

type NotificationFilter = "all" | JiraNotification["kind"];

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "assigned", label: "Assigned" },
  { id: "status-changed", label: "Status" },
  { id: "conflict", label: "Conflicts" },
];

const KIND_LABELS: Record<JiraNotification["kind"], string> = {
  assigned: "Assigned",
  "status-changed": "Status changed",
  conflict: "Conflict",
};

function BrowserNotificationSetting() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  if (permission === "unsupported") return null;

  const enabled = permission === "granted";
  const denied = permission === "denied";

  return (
    <button
      type="button"
      disabled={denied || enabled}
      onClick={async () => setPermission(await Notification.requestPermission())}
      className="flex w-full items-center gap-2.5 border-t border-line px-4 py-3 text-left text-xs font-semibold text-muted transition hover:bg-subtle disabled:cursor-default disabled:hover:bg-transparent"
    >
      <Icon name="bell" className="h-3.5 w-3.5" />
      <span className="flex-1">
        {enabled
          ? "Browser notifications enabled"
          : denied
            ? "Browser notifications blocked in settings"
            : "Enable browser notifications"}
      </span>
      {enabled ? <Icon name="check" className="h-3.5 w-3.5 text-ok" /> : null}
    </button>
  );
}

export function NotificationCenter() {
  const { history, unread_count, loading, refresh, markRead, markAllRead } = useJiraNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const host_ref = useRef<HTMLDivElement>(null);
  const trigger_ref = useRef<HTMLButtonElement>(null);
  const filtered_history = useMemo(
    () => filter === "all" ? history : history.filter((notification) => notification.kind === filter),
    [history, filter],
  );

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!host_ref.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger_ref.current?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={host_ref}>
      <button
        ref={trigger_ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread_count ? `Notifications, ${unread_count} unread` : "Notifications"}
        title="Notification history"
        onClick={() => {
          setOpen((current_open) => !current_open);
          if (!open) void refresh();
        }}
        className="relative grid h-10 w-10 place-items-center rounded-xl text-faint ring-1 ring-line-2 transition hover:bg-brand-soft hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Icon name="bell" className="h-4 w-4" />
        {unread_count ? (
          <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[9px] font-extrabold leading-none text-white ring-2 ring-surface">
            {unread_count > 9 ? "9+" : unread_count}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          role="dialog"
          aria-label="Notification history"
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(38rem,calc(100vh-6rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.2)] ring-1 ring-line-2"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-ink">Notifications</h2>
              <p className="mt-0.5 text-[11px] text-faint">
                {unread_count ? `${unread_count} unread Jira alert${unread_count === 1 ? "" : "s"}` : "You're all caught up"}
              </p>
            </div>
            {unread_count ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[11px] font-semibold text-brand-fg hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line-soft px-3 py-2">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold transition ${
                  filter === option.id
                    ? "bg-brand-soft text-brand-fg"
                    : "text-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            {loading && !history.length ? (
              <div className="grid min-h-48 place-items-center text-xs text-faint">Loading notifications…</div>
            ) : filtered_history.length ? (
              filtered_history.map((notification) => (
                <a
                  key={notification.id}
                  href={notification.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => void markRead(notification.id)}
                  className={`relative flex gap-3 border-b border-line-soft px-4 py-3.5 transition last:border-0 hover:bg-subtle ${
                    notification.readAt ? "" : "bg-brand-soft/45"
                  }`}
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? "bg-faintest" : "bg-brand-500"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-2">{notification.title}</span>
                      <span className="shrink-0 text-[9px] font-medium text-faint">{agoText(notification.createdAt)} ago</span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-body">{notification.body}</span>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-brand-fg">
                      {notification.ticketId} · {KIND_LABELS[notification.kind]}
                    </span>
                  </span>
                </a>
              ))
            ) : (
              <div className="grid min-h-48 place-items-center px-6 text-center">
                <div>
                  <Icon name="bell" className="mx-auto h-5 w-5 text-faintest" />
                  <p className="mt-2 text-xs font-semibold text-muted">No notifications in this category</p>
                </div>
              </div>
            )}
          </div>

          <BrowserNotificationSetting />
        </section>
      ) : null}
    </div>
  );
}
