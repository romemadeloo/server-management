"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  CUSTOM_THEME_PROPERTIES,
  THEME_STORAGE,
  generateThemeTokens,
  isHexColor,
  type PresetPalette,
  type ThemeMode,
  type ThemePalette,
  type ThemeTokenMap,
} from "@/lib/shared/theme";

const DEFAULT_PRIMARY = "#007f6d";
const MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const PALETTES: { id: PresetPalette; label: string; swatch: string }[] = [
  { id: "violet", label: "Glophics", swatch: "#007f6d" },
  { id: "ocean", label: "Ocean", swatch: "#0369a1" },
  { id: "emerald", label: "Emerald", swatch: "#047857" },
];

function isMode(value: string | null): value is ThemeMode {
  return MODES.some((option) => option.id === value);
}

function isPalette(value: string | null): value is ThemePalette {
  return value === "custom" || PALETTES.some((option) => option.id === value);
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The selected appearance still applies to this tab when storage is blocked.
  }
}

function applyTheme(mode: ThemeMode, palette: ThemePalette, primary_color: string): void {
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  root.dataset.theme = palette;
  root.classList.toggle("dark", dark);

  for (const property of CUSTOM_THEME_PROPERTIES) root.style.removeProperty(property);
  if (palette !== "custom") return;

  const generated = generateThemeTokens(primary_color);
  const tokens: ThemeTokenMap = dark ? generated.dark : generated.light;
  for (const [property, value] of Object.entries(tokens)) root.style.setProperty(property, value);
  remember(THEME_STORAGE.custom_tokens, JSON.stringify({ light: generated.light, dark: generated.dark }));
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>("system");
  const [palette, setPalette] = useState<ThemePalette>("violet");
  const [primary_color, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const host_ref = useRef<HTMLDivElement>(null);
  const trigger_ref = useRef<HTMLButtonElement>(null);
  const generated = useMemo(() => generateThemeTokens(primary_color), [primary_color]);

  useEffect(() => {
    try {
      const stored_mode = localStorage.getItem(THEME_STORAGE.mode);
      const stored_palette = localStorage.getItem(THEME_STORAGE.palette);
      const stored_primary = localStorage.getItem(THEME_STORAGE.primary)?.toLowerCase();
      const next_mode = isMode(stored_mode) ? stored_mode : "system";
      const next_palette = isPalette(stored_palette) ? stored_palette : "violet";
      const next_primary = isHexColor(stored_primary) ? stored_primary : DEFAULT_PRIMARY;

      setMode(next_mode);
      setPalette(next_palette);
      setPrimaryColor(next_primary);
      applyTheme(next_mode, next_palette, next_primary);
    } catch {
      applyTheme("system", "violet", DEFAULT_PRIMARY);
    }
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system", palette, primary_color);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode, palette, primary_color]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!host_ref.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger_ref.current?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function chooseMode(next_mode: ThemeMode): void {
    setMode(next_mode);
    remember(THEME_STORAGE.mode, next_mode);
    applyTheme(next_mode, palette, primary_color);
  }

  function choosePalette(next_palette: ThemePalette): void {
    setPalette(next_palette);
    remember(THEME_STORAGE.palette, next_palette);
    applyTheme(mode, next_palette, primary_color);
  }

  function choosePrimary(next_color: string): void {
    const normalized_color = next_color.toLowerCase();
    if (!isHexColor(normalized_color)) return;
    setPrimaryColor(normalized_color);
    setPalette("custom");
    remember(THEME_STORAGE.primary, normalized_color);
    remember(THEME_STORAGE.palette, "custom");
    applyTheme(mode, "custom", normalized_color);
  }

  return (
    <div className="relative shrink-0" ref={host_ref}>
      <button
        ref={trigger_ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Appearance"
        title="Appearance"
        onClick={() => setOpen((value) => !value)}
        className="grid h-10 w-10 place-items-center rounded-xl text-faint ring-1 ring-line-2 transition hover:bg-brand-soft hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Icon name="gear" className="h-4 w-4" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl bg-surface p-4 shadow-[0_20px_60px_rgba(0,0,0,0.18)] ring-1 ring-line-2"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Brightness</p>
          <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-subtle-2 p-1">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseMode(option.id)}
                className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                  mode === option.id ? "bg-surface text-brand-fg shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className="pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Color theme</p>
          <div className="space-y-1">
            {PALETTES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => choosePalette(option.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                  palette === option.id ? "bg-brand-soft text-brand-fg" : "text-body hover:bg-subtle hover:text-ink"
                }`}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: option.swatch }}
                />
                <span className="flex-1">{option.label}</span>
                {palette === option.id ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
          </div>

          <div
            className={`mt-2 rounded-xl p-3 ${
              palette === "custom" ? "bg-brand-soft ring-2 ring-brand-500" : "bg-subtle ring-1 ring-line-2"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => choosePalette("custom")}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-xs font-bold text-ink-2">Custom color</span>
                <span className="block truncate text-[10px] text-muted">{generated.harmony}</span>
              </button>
              <label htmlFor="topbar-custom-primary" className="sr-only">Choose a custom primary color</label>
              <input
                id="topbar-custom-primary"
                type="color"
                value={primary_color}
                onChange={(event) => choosePrimary(event.target.value)}
                className="h-9 w-10 cursor-pointer rounded-lg bg-surface p-1 ring-1 ring-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
