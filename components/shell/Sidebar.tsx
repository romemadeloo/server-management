"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useIsOnline } from "@/components/providers/PresenceProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Menu, MenuHeader, MenuItem, MenuLinkItem, MenuSeparator, Tooltip } from "@/components/ui/Popover";
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
    <span
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-none ${BADGE_TONES[item.tone ?? "plain"]}`}
    >
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
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-9 items-center rounded-xl text-[13px] transition-colors ${
        collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"
      } ${
        active
          ? "bg-brand-soft font-medium text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-brand-500)_30%,transparent)]"
          : "text-body hover:bg-subtle-2 hover:text-ink"
      }`}
    >
      {/* The active item is marked by a short bar on the leading edge as well as
          by its surface - colour alone is not a state indicator. */}
      {active && !collapsed ? (
        <span aria-hidden className="absolute -left-3 top-2 h-5 w-[3px] rounded-r-full bg-brand-500 shadow-[0_0_10px_var(--color-brand-500)]" />
      ) : null}
      <Icon name={item.icon} className={`h-4 w-4 shrink-0 ${active ? "text-brand-fg" : "text-faint"}`} />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      <span className={collapsed ? "absolute -right-1 -top-1 scale-90" : ""}>
        <Badge item={item} counts={counts} liveUnread={liveUnread} />
      </span>
    </Link>
  );

  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
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
  const [avatar_open, setAvatarOpen] = useState(false);
  const [password_open, setPasswordOpen] = useState(false);
  const [signing_out, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // A 240px sidebar on a 375px phone leaves the page a column one word wide, so
  // narrow screens start on the icon rail. Read after mount, not in the state
  // initializer: the server has no viewport, and a mismatched first render
  // would be a hydration error. The toggle still works either way.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setCollapsed(true);
  }, []);
  const { total: liveUnread } = useUnread();
  const { available: install_available, install } = useInstallPrompt();

  const groups: NavGroup[] = ["overview", "activity"];
  const footer_items = visible.filter((item) => item.group === "settings");

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  return (
    <aside
      className={`glass flex h-full shrink-0 flex-col border-r border-line bg-canvas transition-[width] duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <div
        className={`flex shrink-0 items-center border-b border-line ${
          collapsed ? "flex-col justify-center gap-1 px-1 py-2" : "h-14 gap-2.5 px-4"
        }`}
      >
        <span className="glow grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-500 text-on-brand">
          <Icon name="servers" className="h-4 w-4" />
        </span>
        {collapsed ? null : (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-sm font-semibold text-ink">Glophics</span>
            <span className="block text-[11px] text-muted">Environment board</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-subtle-2 hover:text-ink"
        >
          <Icon
            name="chevron"
            className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
          />
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => {
          const items = visible.filter((n) => n.group === group);
          // A group whose every entry is hidden by role hides its heading too,
          // rather than leaving a label over nothing.
          if (!items.length) return null;

          return (
            <div key={group} className="mt-5 first:mt-0">
              {collapsed ? null : (
                <p className="px-2.5 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
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
          {collapsed ? (
            <div className="mx-auto mb-3 h-px w-6 bg-line" />
          ) : (
            <p className="flex items-center justify-between px-2.5 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
              Accounts
              <span className="font-normal normal-case tracking-normal">free / total</span>
            </p>
          )}
          {accounts.length ? (
            <div className="space-y-0.5">
              {accounts.map((account) => (
                <Link
                  key={account.id}
                  href={`/environments?account=${encodeURIComponent(account.id)}`}
                  title={collapsed ? `${account.displayName}: ${account.free}/${account.total} free` : undefined}
                  aria-label={collapsed ? `${account.displayName}: ${account.free}/${account.total} free` : undefined}
                  className={`flex items-center rounded-xl transition-colors hover:bg-subtle-2 ${
                    collapsed ? "justify-center px-1 py-1" : "h-8 gap-2.5 px-2.5"
                  }`}
                >
                  {collapsed ? (
                    <span className="relative grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-[10px] font-semibold text-ink-2">
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
                      <span className="min-w-0 flex-1 truncate text-[13px] text-body">{account.displayName}</span>
                      <span className="font-mono text-[11px] tabular-nums text-faint">
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

      <div className="shrink-0 border-t border-line p-2">
        {/* Radix places this: above the trigger when the sidebar is open, beside
            it when collapsed, and flipped if either would leave the viewport. */}
        <Menu
          side={collapsed ? "right" : "top"}
          align={collapsed ? "end" : "start"}
          className="w-[min(15rem,calc(100vw-1.5rem))]"
          trigger={
            <button
              type="button"
              aria-label={collapsed ? `Account: ${user.displayName}` : undefined}
              className={`flex w-full items-center rounded-2xl py-2 text-left transition-colors hover:bg-subtle-2 data-[state=open]:bg-subtle-2 ${
                collapsed ? "justify-center px-1" : "gap-2.5 px-2"
              }`}
            >
              <Avatar
                person={{ id: user.id, name: user.displayName, avatarUrl: avatar_url }}
                size="h-8 w-8"
                online={online}
              />
              {collapsed ? null : (
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-medium text-ink">{user.displayName}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{roleLabel(user.role)}</span>
                </span>
              )}
              {collapsed ? null : (
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="m5 6 3-3 3 3M5 10l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          }
        >
          <MenuHeader>
            <p className="truncate text-[13px] font-medium text-ink">{user.displayName}</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              @{user.username} · {roleLabel(user.role)}
            </p>
          </MenuHeader>
          <MenuSeparator />

          {footer_items.length ? (
            <>
              {footer_items.map((item) => (
                <MenuLinkItem key={item.href}>
                  <Link href={item.href}>
                    <Icon name={item.icon} className="h-3.5 w-3.5 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <Badge item={item} counts={counts} liveUnread={liveUnread} />
                  </Link>
                </MenuLinkItem>
              ))}
              <MenuSeparator />
            </>
          ) : null}

          <MenuItem icon="users" onSelect={() => setAvatarOpen(true)}>
            Profile picture
          </MenuItem>
          <MenuItem icon="key" onSelect={() => setPasswordOpen(true)}>
            Change password
          </MenuItem>
          {install_available ? (
            <MenuItem icon="plus" onSelect={() => void install()}>
              Install app
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem icon="logout" danger disabled={signing_out} onSelect={signOut}>
            {signing_out ? "Signing out…" : "Sign out"}
          </MenuItem>
        </Menu>
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
