/** Form primitives, ported from H.field / H.select / H.toggle / H.checkbox. */

export function Field({
  label,
  span,
  className = "",
  ...rest
}: React.ComponentProps<"input"> & { label: string; span?: boolean }) {
  return (
    <label className={`block ${span ? "sm:col-span-2" : ""}`}>
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      <input
        className={`mt-1.5 w-full rounded-xl bg-subtle px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-faintest focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-soft ${className}`}
        {...rest}
      />
    </label>
  );
}

export function TextArea({
  label,
  className = "",
  ...rest
}: React.ComponentProps<"textarea"> & { label: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      <textarea
        className={`mt-1.5 w-full rounded-xl bg-subtle px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-faintest focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-soft ${className}`}
        {...rest}
      />
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
        className={`rounded-xl bg-subtle px-3 py-2 text-xs font-semibold text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand-soft ${className}`}
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
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
        on ? "bg-ok-strong" : "bg-line-2"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-surface shadow transition-all ${
          on ? "left-6" : "left-1"
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
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className={`mt-0.5 h-4 w-4 rounded accent-brand-500 ${className}`}
        {...rest}
      />
      <span>
        <span className="block text-sm font-medium text-ink-2">{label}</span>
        {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
      </span>
    </label>
  );
}

/** The error strip a form shows above its actions. Matches #modal-error. */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-4 rounded-xl bg-bad-soft px-3.5 py-2.5 text-xs font-medium text-bad" role="alert">
      {children}
    </p>
  );
}
