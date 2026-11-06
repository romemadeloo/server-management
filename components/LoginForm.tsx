"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormError } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";

/**
 * The one form that has to work before anything else does, so it owns its own
 * state and posts directly rather than going through a shared data layer.
 */
export function LoginForm({ next, expired }: { next?: string; expired?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * We got here carrying a cookie that did not resolve. Clear it.
   *
   * A Server Component cannot delete a cookie — only a Route Handler or Server
   * Action can — so the sign-out endpoint does it. Left in place, the dead cookie
   * would cost a redirect through the app layout on every single navigation.
   */
  useEffect(() => {
    if (!expired) return;
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  }, [expired]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        setError(data.error ?? "That didn't work. Try again.");
        setPending(false);
        return;
      }

      // A path, never a full URL — `next` arrives from the query string, and
      // following an absolute one would make this an open redirect.
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

      // refresh() first so the new session cookie is picked up by the Server
      // Components that are about to render the shell.
      router.refresh();
      router.replace(target);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form className="w-full max-w-sm" onSubmit={onSubmit}>
      <div className="flex items-center gap-2.5 lg:hidden">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-on-brand">
          <Icon name="servers" className="h-4 w-4" />
        </span>
        <span className="text-[15px] font-semibold">Glophics</span>
      </div>

      <h1 className="mt-8 text-xl font-semibold text-ink lg:mt-0">Sign in to Glophics</h1>
      <p className="mt-1 text-[13px] text-muted">Use the credentials your super admin gave you.</p>

      {expired ? (
        <p className="mt-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn" role="status">
          Your session has ended — sign in again.
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        <Field
          label="Username"
          name="username"
          placeholder="e.g. jerome"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          disabled={pending}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>

      <FormError>{error}</FormError>

      <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
