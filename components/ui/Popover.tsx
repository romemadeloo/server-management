"use client";

import { DropdownMenu, Popover as RadixPopover, Tooltip as RadixTooltip } from "radix-ui";
import { Icon } from "./Icon";
import type { IconName } from "@/lib/shared/tokens";

/**
 * Floating surfaces: menus, popovers and tooltips, on Radix.
 *
 * Each of these used to be an absolutely-positioned div under its trigger, with
 * its own mousedown-outside and Escape listeners. That placed them wherever the
 * trigger happened to be, so a menu near the bottom of the sidebar or the right
 * edge of a phone opened half off-screen. Radix measures and flips (`collision
 * Padding`), portals out of any `overflow-hidden` ancestor, and gives menus the
 * keyboard model a menu is expected to have — arrows, Home/End, typeahead.
 *
 * All three share `shadow-overlay` and the same small enter animation, so
 * anything that floats looks like it belongs to the same system.
 */

const SURFACE =
  "glass glass-float z-50 rounded-2xl border border-line bg-surface shadow-overlay outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out";

// ---------- popover ----------

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  side = "bottom",
  align = "end",
  className = "",
  label,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  /** The popover's accessible name. */
  label: string;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={`${SURFACE} ${className}`}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

// ---------- menu ----------

export function Menu({
  trigger,
  children,
  open,
  onOpenChange,
  side = "bottom",
  align = "end",
  className = "w-56",
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    // Non-modal: a menu item that opens a Dialog would otherwise race two focus
    // scopes, and the menu's pointer-events lock on <body> can outlive both.
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={`${SURFACE} p-1.5 ${className}`}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const ITEM =
  "flex h-9 w-full cursor-default select-none items-center gap-2.5 rounded-xl px-2.5 text-[13px] text-ink-2 outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-subtle-2 data-[highlighted]:text-ink";

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
  disabled,
  trailing,
}: {
  icon?: IconName;
  children: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`${ITEM} ${danger ? "data-[highlighted]:bg-bad-soft data-[highlighted]:text-bad" : ""}`}
    >
      {icon ? <Icon name={icon} className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </DropdownMenu.Item>
  );
}

/** A menu entry that navigates. Rendered as the caller's own link element
 *  (`asChild`), so Next's client-side routing and prefetching still apply. */
export function MenuLinkItem({ children }: { children: React.ReactElement }) {
  return (
    <DropdownMenu.Item asChild className={ITEM}>
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DropdownMenu.Label className="px-2 pb-1 pt-2 text-xs font-medium text-muted">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-line" />;
}

/** Non-interactive content at the top of a menu — who you are signed in as. */
export function MenuHeader({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-2 pt-1.5">{children}</div>;
}

// ---------- tooltip ----------

/** Wraps the app once, so every tooltip shares one delay and skipping between
 *  adjacent triggers shows the next one immediately. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[70] max-w-64 rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface data-[state=delayed-open]:animate-pop-in"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
