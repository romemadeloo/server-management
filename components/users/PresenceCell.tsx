"use client";

import { useIsOnline } from "@/components/providers/PresenceProvider";
import { agoText } from "@/lib/shared/format";

/**
 * Online now, or when they were last seen.
 *
 * A client component because presence is live and the page around it is
 * server-rendered. It deliberately distinguishes three states rather than two:
 *
 *   Online       connected right now
 *   Seen 20m ago connected at some point, not now
 *   —            presence is not being tracked at all, because Pusher is not
 *                configured. Showing "Offline" there would be a lie about
 *                somebody who might well be at their desk.
 */
export function PresenceCell({
  userId,
  lastSeenAt,
}: {
  userId: string | null;
  lastSeenAt: string | null;
}) {
  const online = useIsOnline(userId);

  if (online === undefined) {
    return lastSeenAt ? (
      <span className="whitespace-nowrap text-[11px] text-faint">
        Seen {agoText(lastSeenAt)} ago
      </span>
    ) : (
      <span className="text-[11px] text-faintest">—</span>
    );
  }

  if (online) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        Online
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-faintest" />
      {lastSeenAt ? `Seen ${agoText(lastSeenAt)} ago` : "Offline"}
    </span>
  );
}
