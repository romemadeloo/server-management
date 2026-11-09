"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

type PermissionState = NotificationPermission | "unsupported";

export function NotificationToggle() {
  const [permission, setPermission] = useState<PermissionState>("unsupported");

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  if (permission === "unsupported") return null;

  const enabled = permission === "granted";
  const denied = permission === "denied";
  const label = enabled
    ? "Browser notifications enabled"
    : denied
      ? "Browser notifications are blocked in browser settings"
      : "Enable browser notifications";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      disabled={denied}
      onClick={async () => setPermission(await Notification.requestPermission())}
      className={`relative grid h-9 w-9 place-items-center rounded-xl ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        enabled
          ? "bg-brand-soft text-brand-fg ring-brand-200"
          : "bg-subtle text-muted ring-line-soft hover:bg-subtle-2 hover:text-ink"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      <Icon name="bell" className="h-4 w-4" />
      {enabled ? (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-surface" />
      ) : null}
    </button>
  );
}
