"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
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
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [palette, setPalette] = useState<ThemePalette>("violet");
  const [primary_color, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const generated = useMemo(() => generateThemeTokens(primary_color), [primary_color]);

  useEffect(() => {
    try {
      const stored_mode = localStorage.getItem(THEME_STORAGE.mode);
      const stored_palette = localStorage.getItem(THEME_STORAGE.palette);
      const stored_primary = localStorage.getItem(THEME_STORAGE.primary)?.toLowerCase();
      const next_mode = isMode(stored_mode) ? stored_mode : "dark";
      const next_palette = isPalette(stored_palette) ? stored_palette : "violet";
      const next_primary = isHexColor(stored_primary) ? stored_primary : DEFAULT_PRIMARY;

      setMode(next_mode);
      setPalette(next_palette);
      setPrimaryColor(next_primary);
      applyTheme(next_mode, next_palette, next_primary);
    } catch {
      applyTheme("dark", "violet", DEFAULT_PRIMARY);
    }
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system", palette, primary_color);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode, palette, primary_color]);

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
    <Popover
      label="Appearance"
      open={open}
      onOpenChange={setOpen}
      className="w-72 p-3"
      trigger={
        <button type="button" aria-label="Appearance" title="Appearance" className="relative grid h-9 w-9 place-items-center rounded-full border border-line-2 bg-subtle text-muted transition-colors hover:bg-subtle-2 hover:text-ink data-[state=open]:bg-subtle-2 data-[state=open]:text-ink">
          <Icon name="gear" className="h-4 w-4" />
        </button>
      }
    >
          <p className="text-xs font-medium text-muted">Brightness</p>
          <div role="radiogroup" aria-label="Brightness" className="mt-1.5 grid grid-cols-3 gap-0.5 rounded-md bg-subtle-2 p-0.5">
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mode === option.id}
                onClick={() => chooseMode(option.id)}
                className={`h-7 rounded px-2 text-xs font-medium transition-colors ${
                  mode === option.id
                    ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]"
                    : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className="pb-1.5 pt-4 text-xs font-medium text-muted">Color theme</p>
          <div className="space-y-0.5">
            {PALETTES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => choosePalette(option.id)}
                aria-pressed={palette === option.id}
                className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors ${
                  palette === option.id ? "bg-subtle-2 font-medium text-ink" : "text-body hover:bg-subtle hover:text-ink"
                }`}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/15"
                  style={{ backgroundColor: option.swatch }}
                />
                <span className="flex-1">{option.label}</span>
                {palette === option.id ? <Icon name="check" className="h-3.5 w-3.5 text-brand-fg" /> : null}
              </button>
            ))}
          </div>

          <div
            className={`mt-2 rounded-md border p-2.5 ${
              palette === "custom" ? "border-brand-500 bg-brand-soft" : "border-line bg-subtle"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => choosePalette("custom")}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-[13px] font-medium text-ink">Custom color</span>
                <span className="block truncate text-xs text-muted">{generated.harmony}</span>
              </button>
              <label htmlFor="topbar-custom-primary" className="sr-only">Choose a custom primary color</label>
              <input
                id="topbar-custom-primary"
                type="color"
                value={primary_color}
                onChange={(event) => choosePrimary(event.target.value)}
                className="h-8 w-10 cursor-pointer rounded-md border border-line-2 bg-surface p-0.5"
              />
            </div>
          </div>
    </Popover>
  );
}
