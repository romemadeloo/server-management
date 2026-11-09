import Link from "next/link";
import { Icon } from "./Icon";
import type { IconName } from "@/lib/shared/tokens";

/**
 * Ported from H.btn / H.iconBtn in the legacy public/js/ui/html.js.
 *
 * The variant names and every class string are unchanged, so a button here looks
 * exactly like a button there. Variants are looked up in a map rather than built
 * by string concatenation, which is what keeps a palette name out of a component.
 */

export type ButtonVariant = "dark" | "ghost" | "brand" | "danger" | "quiet";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  dark: "bg-accent text-on-accent hover:bg-accent-2",
  ghost: "bg-surface text-body shadow-sm ring-1 ring-line-2 hover:text-brand-fg",
  brand: "bg-brand-500 text-white hover:bg-brand-600",
  danger: "text-bad ring-1 ring-bad-soft hover:bg-bad-soft",
  quiet: "text-muted ring-1 ring-line-2 hover:bg-brand-soft hover:text-brand-fg hover:ring-brand-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[11px]",
  md: "px-4 py-2.5 text-xs",
};

function classes(variant: ButtonVariant, size: ButtonSize, extra?: string) {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition",
    "disabled:cursor-not-allowed disabled:opacity-50",
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
  return <button type={type} className={classes(variant, size, className)} {...rest} />;
}

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function ButtonLink({ variant = "ghost", size = "md", className, ...rest }: ButtonLinkProps) {
  return <Link className={classes(variant, size, className)} {...rest} />;
}

/**
 * A round icon-only button. `title` is required, not optional — an icon with no
 * accessible name is a button nobody can identify, and the legacy signature
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
        "grid h-8 w-8 place-items-center rounded-full text-faint ring-1 ring-line-2 transition",
        "hover:bg-brand-soft hover:text-brand-fg hover:ring-brand-soft",
        "disabled:cursor-not-allowed disabled:opacity-50",
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
