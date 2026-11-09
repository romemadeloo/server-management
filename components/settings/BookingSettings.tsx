"use client";

import { useRouter } from "next/navigation";
import { realtimeHeaders } from "@/lib/realtime/client";
import { useState } from "react";
import { Card } from "@/components/ui/Layout";
import { FormError, Select, Toggle } from "@/components/ui/Form";
import type { OnExpiry, Settings } from "@/lib/types";

/**
 * Booking defaults. Each control saves on change rather than behind a Save
 * button — these are single settings with no interdependency, and the legacy
 * page behaved the same way.
 */
export function BookingSettings({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setError(null);
    setSaving(true);

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);

    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    setSaving(false);

    if (!res?.ok || data.ok === false) {
      setError(data.errors?.join(" ") ?? "Couldn't save that setting.");
      return;
    }
    router.refresh();
  }

  const hourOptions = [1, 2, 4, 8, 12, 24, 48].map((h) => ({
    value: String(h),
    label: h === 24 ? "1 day" : h === 48 ? "2 days" : `${h} hours`,
  }));

  return (
    <Card title="Booking" sub="What the Assign form starts with, and what happens when time runs out.">
      <div className="space-y-4">
        <Select
          label="Default booking length"
          options={hourOptions}
          value={String(settings.defaultBookingHours)}
          disabled={saving}
          onChange={(e) => save({ defaultBookingHours: Number(e.target.value) })}
        />

        <Select
          label="When a booking expires"
          options={[
            { value: "remind", label: "Just show it as expired" },
            { value: "remind-flag", label: "Show it and flag the environment" },
            { value: "auto-release", label: "Free the environment automatically" },
          ]}
          value={settings.onExpiry}
          disabled={saving}
          onChange={(e) => save({ onExpiry: e.target.value as OnExpiry })}
        />

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-body">Claim the whole environment by default</p>
            <p className="mt-0.5 text-xs text-faint">
              Claiming is per-repository, but most bookings take everything. On, the Assign form starts
              with every free repository ticked.
            </p>
          </div>
          <Toggle
            on={settings.assignWholeEnv}
            label="Claim the whole environment by default"
            disabled={saving}
            onChange={(next) => save({ assignWholeEnv: next })}
          />
        </div>

        {settings.onExpiry === "auto-release" ? (
          <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs text-warn">
            Expired claims are deleted by a scheduled job. That job refuses to run unless
            <code className="mx-1 font-mono">CRON_SECRET</code> is set, so check it is configured — an
            expiry setting that silently never fires is worse than one that is off.
          </p>
        ) : null}
      </div>

      <FormError>{error}</FormError>
    </Card>
  );
}
