/**
 * Form primitives, ported from H.field / H.select / H.toggle / H.checkbox.
 *
 * Inputs follow the Carbon / Atlassian field: a visible label above, a 36px
 * bordered control (not a borderless grey well — a well is indistinguishable
 * from a disabled field), a brand border plus a soft halo on focus, and an
 * optional hint underneath. The same `CONTROL` string is exported so a one-off
 * input elsewhere can match without re-deriving it.
 */

export const CONTROL =
  "w-full rounded-xl border border-line-2 bg-subtle px-3.5 text-sm text-ink transition-[border-color,box-shadow,background-color] placeholder:text-faint hover:border-faintest focus:border-brand-500 focus:bg-subtle-2 focus:outline-none focus:ring-[3px] focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-60";

export const LABEL = "text-[13px] font-medium text-ink-2";

function Hint({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <span className="mt-1.5 block text-xs leading-4 text-muted">{children}</span>;
}

export function Field({
  label,
  hint,
  span,
  className = "",
  ...rest
}: React.ComponentProps<"input"> & { label: string; hint?: React.ReactNode; span?: boolean }) {
  return (
    <label className={`block ${span ? "sm:col-span-2" : ""}`}>
      <span className={LABEL}>
        {label}
        {rest.required ? <span className="ml-0.5 text-bad" aria-hidden="true">*</span> : null}
      </span>
      <input className={`mt-1.5 h-10 ${CONTROL} ${className}`} {...rest} />
      <Hint>{hint}</Hint>
    </label>
  );
}

export function TextArea({
  label,
  hint,
  className = "",
  ...rest
}: React.ComponentProps<"textarea"> & { label: string; hint?: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <textarea className={`mt-1.5 py-2 leading-5 ${CONTROL} ${className}`} {...rest} />
      <Hint>{hint}</Hint>
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** The inline label-and-control row used throughout Settings. */
export function Select({
  label,
  options,
  className = "",
  ...rest
}: React.ComponentProps<"select"> & { label: string; options: SelectOption[] }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-body">{label}</span>
      <select
        className={`h-9 cursor-pointer rounded-full border border-line-2 bg-subtle pl-3.5 pr-8 text-[13px] font-medium text-ink hover:border-faintest focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/20 [&>option]:bg-[#0e1814] ${className}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange?: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "bg-brand-500" : "bg-line-2 hover:bg-faintest"
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform ${
          on ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function Checkbox({
  label,
  hint,
  className = "",
  ...rest
}: React.ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="group flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        className={`mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-[3px] accent-brand-500 ${className}`}
        {...rest}
      />
      <span>
        <span className="block text-sm text-ink-2">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** The error strip a form shows above its actions. Matches #modal-error. */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      className="mt-4 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad"
      role="alert"
    >
      <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5h1.5v4.25h-1.5V4.5Zm.75 7.25a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
