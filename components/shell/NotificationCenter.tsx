"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type JiraNotification,
  useJiraNotifications,
} from "@/components/providers/JiraNotificationProvider";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
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
      className="flex w-full items-center gap-2.5 border-t border-line bg-subtle px-4 py-2.5 text-left text-xs font-medium text-body transition-colors hover:bg-subtle-2 disabled:cursor-default disabled:hover:bg-subtle"
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
  const filtered_history = useMemo(
    () => filter === "all" ? history : history.filter((notification) => notification.kind === filter),
    [history, filter],
  );

  return (
    <Popover
      label="Notification history"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
      className="flex max-h-[min(36rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden"
      trigger={
        <button
          type="button"
          aria-label={unread_count ? `Notifications, ${unread_count} unread` : "Notifications"}
          title="Notification history"
          className="relative grid h-9 w-9 place-items-center rounded-full border border-line-2 bg-subtle text-muted transition-colors hover:bg-subtle-2 hover:text-ink data-[state=open]:bg-subtle-2 data-[state=open]:text-ink"
        >
          <Icon name="bell" className="h-4 w-4" />
          {unread_count ? (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold tabular-nums leading-none text-white ring-2 ring-surface">
              {unread_count > 9 ? "9+" : unread_count}
            </span>
          ) : null}
        </button>
      }
    >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-ink">Notifications</h2>
              <p className="mt-0.5 text-xs text-muted">
                {unread_count ? `${unread_count} unread Jira alert${unread_count === 1 ? "" : "s"}` : "You're all caught up"}
              </p>
            </div>
            {unread_count ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="rounded px-1.5 py-1 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-soft"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div role="tablist" aria-label="Filter notifications" className="no-scrollbar flex shrink-0 gap-4 overflow-x-auto border-b border-line px-4">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                role="tab"
                aria-selected={filter === option.id}
                className={`-mb-px shrink-0 border-b-2 py-2 text-xs font-medium transition-colors ${
                  filter === option.id
                    ? "border-brand-500 text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            {loading && !history.length ? (
              <div className="grid min-h-48 place-items-center text-[13px] text-muted">Loading notifications…</div>
            ) : filtered_history.length ? (
              filtered_history.map((notification) => (
                <a
                  key={notification.id}
                  href={notification.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => void markRead(notification.id)}
                  className={`relative flex gap-3 border-b border-line-soft px-4 py-3 transition-colors last:border-0 hover:bg-subtle ${
                    notification.readAt ? "" : "bg-brand-soft/40"
                  }`}
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${notification.readAt ? "bg-transparent" : "bg-brand-500"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{notification.title}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-faint">{agoText(notification.createdAt)} ago</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-[18px] text-body">{notification.body}</span>
                    <span className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
                      {notification.ticketId} · {KIND_LABELS[notification.kind]}
                    </span>
                  </span>
                </a>
              ))
            ) : (
              <div className="grid min-h-48 place-items-center px-6 text-center">
                <div>
                  <Icon name="bell" className="mx-auto h-5 w-5 text-faintest" />
                  <p className="mt-2 text-[13px] text-muted">No notifications in this category</p>
                </div>
              </div>
            )}
          </div>

          <BrowserNotificationSetting />
    </Popover>
  );
}
