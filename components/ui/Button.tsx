import Link from "next/link";
import { Icon } from "./Icon";
import type { IconName } from "@/lib/shared/tokens";

/**
 * Buttons. Originally ported from H.btn / H.iconBtn in the legacy
 * public/js/ui/html.js; the variant names are kept so no call site had to
 * change. Pills at a fixed height (28 / 36 / 40px) — fixed, rather than
 * padded, so a button lines up with the input beside it. The primary is the
 * mint fill with near-black text and a soft glow on the dark theme: the one
 * saturated, lit object on the page is the thing to press.
 *
 * Variants are looked up in a map rather than built by string concatenation,
 * which is what keeps a palette name out of a component.
 */

export type ButtonVariant =
  | "primary"
  | "dark"
  | "brand"
  | "ghost"
  | "secondary"
  | "quiet"
  | "danger"
  | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const PRIMARY = "glow bg-brand-500 font-semibold text-on-brand hover:bg-brand-600 active:bg-brand-700";
const SECONDARY =
  "border border-line-2 bg-subtle text-ink-2 hover:border-faintest hover:bg-subtle-2 hover:text-ink active:bg-subtle-2";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: PRIMARY,
  brand: PRIMARY,
  /** The legacy name for the primary action — the old charcoal pill was this
   *  app's call to action, so every `variant="dark"` is a primary button. */
  dark: PRIMARY,
  ghost: SECONDARY,
  secondary: SECONDARY,
  quiet: "text-body hover:bg-subtle-2 hover:text-ink active:bg-line",
  /** Outline: a destructive action that is not the point of the screen. */
  danger: "border border-line-2 bg-subtle text-bad hover:border-bad/60 hover:bg-bad-soft",
  /** Solid: the confirm button of a destructive dialog. */
  destructive: "bg-bad-strong text-white hover:brightness-110 active:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-xs",
  md: "h-9 px-4 text-[13px]",
  lg: "h-10 px-5 text-sm",
};

export function buttonClasses(variant: ButtonVariant = "ghost", size: ButtonSize = "md", extra?: string) {
  return [
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium leading-none transition-colors",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    SIZES[size],
    VARIANTS[variant],
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "ghost", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function ButtonLink({ variant = "ghost", size = "md", className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...rest} />;
}

/**
 * A square icon-only button. `title` is required, not optional — an icon with
 * no accessible name is a button nobody can identify, and the legacy signature
 * demanded one for the same reason.
 */
export function IconButton({
  icon,
  title,
  className,
  ...rest
}: React.ComponentProps<"button"> & { icon: IconName; title: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={[
        "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-2 bg-subtle text-muted transition-colors",
        "hover:border-faintest hover:bg-subtle-2 hover:text-ink",
        "disabled:pointer-events-none disabled:opacity-50",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}
