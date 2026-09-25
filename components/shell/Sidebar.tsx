"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useIsOnline } from "@/components/providers/PresenceProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { BADGE_TONES, GROUP_LABELS, NAV, type NavCounts, type NavGroup, type NavItem } from "@/lib/shared/nav";
import { roleCan, roleLabel } from "@/lib/shared/roles";
import { AvatarDialog } from "./AvatarDialog";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import type { AuthUser, EnvStatus } from "@/lib/types";
import { useUnread } from "@/components/providers/UnreadProvider";
import { useInstallPrompt } from "@/components/pwa/useInstallPrompt";

/**
 * Sidebar navigation and the per-account list.
 *
 * A client component because the active link and controls use local interaction state.
 * Everything it renders is passed in from the server layout — it does no fetching
 * or business logic.
 */

export interface AccountRollup {
  id: string;
  displayName: string;
  free: number;
  total: number;
  worst: EnvStatus;
}

function accountShortcut(displayName: string) {
  const words = displayName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0]?.slice(0, 3).toUpperCase();

  return words
    .slice(0, 3)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

function Badge({ item, counts, liveUnread }: { item: NavItem; counts: NavCounts; liveUnread: number }) {
  if (!item.badge) return null;
  // The chat badge is the one count that must change the instant an event lands,
  // rather than on the next server render. Everything else is fine server-side.
  const count = item.badge === "unreadChats" ? liveUnread : counts[item.badge];
  if (!count) return null;

  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${BADGE_TONES[item.tone ?? "plain"]}`}>
      {count}
    </span>
  );
}

function NavLink({
  item,
  counts,
  active,
  onNavigate,
  liveUnread,
  collapsed = false,
}: {
  item: NavItem;
  counts: NavCounts;
  active: boolean;
  onNavigate?: () => void;
  liveUnread: number;
  collapsed?: boolean;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={`relative flex items-center rounded-xl py-2.5 text-sm transition ${
        collapsed ? "justify-center px-2" : "gap-3 px-3"
      } ${
        active
          ? "bg-brand-soft font-semibold text-brand-fg"
          : "font-medium text-muted hover:bg-subtle hover:text-ink"
      }`}
    >
      <Icon name={item.icon} className="h-4.5 w-4.5 shrink-0" />
      {collapsed ? null : <span className="flex-1">{item.label}</span>}
      <span className={collapsed ? "absolute -right-0.5 -top-1 scale-75" : ""}>
        <Badge item={item} counts={counts} liveUnread={liveUnread} />
      </span>
    </Link>
  );
}

export function Sidebar({
  user,
  avatar_url,
  counts,
  accounts,
}: {
  user: AuthUser;
  avatar_url: string | null;
  counts: NavCounts;
  accounts: AccountRollup[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const visible = NAV.filter((item) => !item.requires || roleCan(user.role, item.requires));
  const online = useIsOnline(user.id);
  const [user_menu_open, setUserMenuOpen] = useState(false);
  const [avatar_open, setAvatarOpen] = useState(false);
  const [password_open, setPasswordOpen] = useState(false);
  const [signing_out, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const user_menu_ref = useRef<HTMLDivElement>(null);
  const user_menu_trigger_ref = useRef<HTMLButtonElement>(null);
  const { total: liveUnread } = useUnread();
  const { available: install_available, install } = useInstallPrompt();

  const groups: NavGroup[] = ["overview", "activity"];
  const footer_items = visible.filter((item) => item.group === "settings");

  useEffect(() => {
    if (!user_menu_open) return;

    function onPointerDown(event: MouseEvent) {
      if (!user_menu_ref.current?.contains(event.target as Node)) setUserMenuOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setUserMenuOpen(false);
      user_menu_trigger_ref.current?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [user_menu_open]);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-line bg-canvas transition-[width] duration-200 ${
        collapsed ? "w-20" : "w-60"
      }`}
    >
      <div className={`flex items-center py-5 ${collapsed ? "gap-1 px-1" : "gap-2.5 px-5"}`}>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/30">
          <Icon name="servers" className="h-4.5 w-4.5" />
        </span>
        {collapsed ? null : <span className="flex-1 text-[17px] font-bold tracking-tight">Glophics</span>}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Icon
            name="chevron"
            className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
          />
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5">
        {groups.map((group) => {
          const items = visible.filter((n) => n.group === group);
          // A group whose every entry is hidden by role hides its heading too,
          // rather than leaving a label over nothing.
          if (!items.length) return null;

          return (
            <div key={group} className="mt-5 first:mt-0">
              {collapsed ? null : (
                <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  {GROUP_LABELS[group]}
                </p>
              )}
              <nav className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    counts={counts}
                    // startsWith so a detail route keeps its parent highlighted,
                    // but guarded so /health never lights up /health-something.
                    active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                    liveUnread={liveUnread}
                    collapsed={collapsed}
                  />
                ))}
              </nav>
            </div>
          );
        })}

        <div className="mt-6">
          {collapsed ? null : (
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Accounts</p>
          )}
          {accounts.length ? (
            <div className="space-y-0.5">
              {accounts.map((account) => (
                <Link
                  key={account.id}
                  href={`/environments?account=${encodeURIComponent(account.id)}`}
                  title={collapsed ? `${account.displayName}: ${account.free}/${account.total} free` : undefined}
                  aria-label={collapsed ? `${account.displayName}: ${account.free}/${account.total} free` : undefined}
                  className={`flex items-center rounded-xl py-2 transition hover:bg-subtle ${
                    collapsed ? "justify-center px-2" : "gap-3 px-3"
                  }`}
                >
                  {collapsed ? (
                    <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-subtle-2 text-[10px] font-bold tracking-wide text-ink-2 ring-1 ring-line-soft">
                      {accountShortcut(account.displayName)}
                      <span
                        className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-canvas ${
                          account.worst === "issue" ? "bg-bad" : account.free ? "bg-ok" : "bg-warn"
                        }`}
                      />
                    </span>
                  ) : (
                    <>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          account.worst === "issue" ? "bg-bad" : account.free ? "bg-ok" : "bg-warn"
                        }`}
                      />
                      <span className="flex-1 truncate text-sm font-medium text-ink-2">{account.displayName}</span>
                      <span className="text-[11px] font-semibold text-faint">
                        {account.free}/{account.total}
                      </span>
                    </>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            collapsed ? null : <p className="px-3 py-2 text-xs text-faint">No accounts yet.</p>
          )}
        </div>
      </div>

      <div className="relative shrink-0 border-t border-line p-3" ref={user_menu_ref}>
        {user_menu_open ? (
          <div
            id="sidebar-user-navigation"
            role="menu"
            className={`absolute z-50 overflow-hidden rounded-2xl bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.2)] ring-1 ring-line-2 ${
              collapsed ? "bottom-0 left-full ml-2 w-60" : "bottom-full left-3 right-3 mb-2"
            }`}
          >
            <div className="border-b border-line bg-panel px-4 py-3">
              <p className="truncate text-sm font-bold text-ink">{user.displayName}</p>
              <p className="mt-0.5 truncate text-[11px] text-faint">
                @{user.username} · {roleLabel(user.role)}
              </p>
            </div>

            {footer_items.length ? (
              <nav aria-label="User and settings" className="space-y-0.5 border-b border-line p-2">
                {footer_items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    counts={counts}
                    active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                    onNavigate={() => setUserMenuOpen(false)}
                    liveUnread={liveUnread}
                  />
                ))}
              </nav>
            ) : null}

            <div className="p-2">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  setAvatarOpen(true);
                }}
                className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold text-body transition hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Icon name="users" className="h-3.5 w-3.5 shrink-0 text-faint" />
                Profile picture
              </button>
              {install_available ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void install();
                    setUserMenuOpen(false);
                    user_menu_trigger_ref.current?.focus();
                  }}
                  className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold text-body transition hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Icon name="plus" className="h-3.5 w-3.5 shrink-0 text-faint" />
                  Install app
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  setPasswordOpen(true);
                }}
                className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold text-body transition hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Icon name="key" className="h-3.5 w-3.5 shrink-0 text-faint" />
                Change password
              </button>
              <button
                type="button"
                disabled={signing_out}
                onClick={signOut}
                className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold text-body transition hover:bg-bad-soft hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
              >
                <Icon name="logout" className="h-3.5 w-3.5 shrink-0 text-faint" />
                {signing_out ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        ) : null}

        <button
          ref={user_menu_trigger_ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={user_menu_open}
          aria-controls="sidebar-user-navigation"
          onClick={() => setUserMenuOpen((value) => !value)}
          title={collapsed ? user.displayName : undefined}
          className={`flex w-full items-center rounded-xl py-2 text-left transition hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            collapsed ? "justify-center px-1" : "gap-2.5 px-2"
          }`}
        >
          <Avatar
            person={{ id: user.id, name: user.displayName, avatarUrl: avatar_url }}
            size="h-9 w-9"
            online={online}
          />
          {collapsed ? null : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-bold leading-tight text-ink-2">
                {user.displayName}
              </span>
              <span className="mt-0.5 block truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-faint">
                {roleLabel(user.role)}
              </span>
            </span>
          )}
          {collapsed ? null : (
            <Icon
              name="chevron"
              className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform ${
                user_menu_open ? "-rotate-90" : "rotate-90"
              }`}
            />
          )}
        </button>
      </div>

      {avatar_open ? (
        <AvatarDialog
          user={user}
          currentUrl={avatar_url}
          onClose={() => setAvatarOpen(false)}
          onDone={() => {
            setAvatarOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {password_open ? (
        <ChangePasswordDialog
          onClose={() => setPasswordOpen(false)}
          onDone={() => {
            setPasswordOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </aside>
  );
}
