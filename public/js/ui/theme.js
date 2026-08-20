/**
 * Per-browser palette and appearance preferences.
 *
 * Components consume semantic CSS variables from index.html. This module
 * chooses the palette and resolves System/Light/Dark into the `dark` class,
 * so components do not need theme-specific variants.
 *
 * The class is applied by an inline script in <head> before first paint;
 * this module owns the switcher and remembers both choices.
 */

const Theme = (() => {
  const PALETTE_KEY = "serverManager.colorTheme";
  const MODE_KEY = "serverManager.theme";
  const PRIMARY_KEY = "serverManager.primaryColor";
  const CUSTOM_TOKENS_KEY = "serverManager.customThemeTokens";
  const PRESET_PALETTES = ["violet", "ocean", "emerald"];
  const PALETTES = [...PRESET_PALETTES, "custom"];
  const MODES = ["system", "light", "dark"];
  // The `violet` id is retained so existing saved preferences keep working;
  // it now represents the default Glophics brand combination.
  const PALETTE_LABELS = { violet: "Glophics", ocean: "Ocean", emerald: "Emerald", custom: "Custom" };
  const MODE_LABELS = { system: "System", light: "Light", dark: "Dark" };
  const SWATCHES = {
    violet: ["#3d3d3d", "#18b69e", "#d1d2d3"],
    ocean: ["#0369a1", "#67c9e4", "#e8f7fc"],
    emerald: ["#047857", "#6ee7b7", "#ecfdf5"]
  };
  const PALETTE_ICON = '<path d="M12 3a9 9 0 100 18h1.2a1.8 1.8 0 001.3-3.1 1.8 1.8 0 011.3-3.1H18a3 3 0 003-3C21 6.9 17 3 12 3z"/><path d="M7.5 10h.01M10 6.8h.01M14 6.8h.01M17 10h.01"/>';
  const media = matchMedia("(prefers-color-scheme: dark)");

  let palette = readChoice(PALETTE_KEY, PALETTES, "violet");
  let mode = readChoice(MODE_KEY, MODES, "system");
  let custom_color = readColor(PRIMARY_KEY, "#007f6d");
  let open = false;

  function readChoice(key, choices, fallback) {
    try {
      const value = localStorage.getItem(key);
      return choices.includes(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* storage blocked */ }
  }

  function readColor(key, fallback) {
    try {
      const value = String(localStorage.getItem(key) || "").toLowerCase();
      return /^#[0-9a-f]{6}$/.test(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToHsl(hex) {
    const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255);
    const max = Math.max(...rgb);
    const min = Math.min(...rgb);
    const lightness = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: lightness * 100 };
    const delta = max - min;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (max === rgb[0]) hue = 60 * (((rgb[1] - rgb[2]) / delta) % 6);
    else if (max === rgb[1]) hue = 60 * (((rgb[2] - rgb[0]) / delta) + 2);
    else hue = 60 * (((rgb[0] - rgb[1]) / delta) + 4);
    return { h: hue < 0 ? hue + 360 : hue, s: saturation * 100, l: lightness * 100 };
  }

  function hslToHex(hue, saturation, lightness) {
    const s = clamp(saturation, 0, 100) / 100;
    const l = clamp(lightness, 0, 100) / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const section = ((hue % 360) + 360) % 360 / 60;
    const x = chroma * (1 - Math.abs((section % 2) - 1));
    const pairs = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
    const [red, green, blue] = pairs[Math.floor(section) % 6];
    const match = l - chroma / 2;
    return "#" + [red, green, blue].map((value) => Math.round((value + match) * 255).toString(16).padStart(2, "0")).join("");
  }

  function relativeLuminance(hex) {
    const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastWithWhite(hex) {
    return 1.05 / (relativeLuminance(hex) + 0.05);
  }

  function accessiblePrimary(hue, saturation, lightness) {
    let next_lightness = Math.min(lightness, 48);
    let color = hslToHex(hue, saturation, next_lightness);
    while (contrastWithWhite(color) < 4.5 && next_lightness > 20) {
      next_lightness -= 1;
      color = hslToHex(hue, saturation, next_lightness);
    }
    return { color, lightness: next_lightness };
  }

  function chooseHarmony(primary_hsl, palette_saturation) {
    // Neutral selections need a useful accent rather than a meaningless hue
    // rotation. Chromatic selections use a split-complementary pair: enough
    // separation for hierarchy without the harshness of a direct complement.
    if (primary_hsl.s < 8) {
      return { secondary_hue: 168, tertiary_hue: 208, saturation: 68, label: "Teal accent harmony" };
    }
    return {
      secondary_hue: (primary_hsl.h + 150) % 360,
      tertiary_hue: (primary_hsl.h + 210) % 360,
      saturation: clamp(palette_saturation * 0.82, 52, 72),
      label: "Split-complementary harmony"
    };
  }

  function generateThemeTokens(primary_color) {
    const primary_hsl = hexToHsl(primary_color);
    const palette_saturation = primary_hsl.s < 8 ? 0 : clamp(primary_hsl.s, 45, 85);
    const neutral_saturation = palette_saturation === 0 ? 0 : clamp(palette_saturation * 0.14, 6, 12);
    const harmony = chooseHarmony(primary_hsl, palette_saturation);
    const status_saturation = clamp(palette_saturation * 0.8, 58, 78);
    const accessible = accessiblePrimary(primary_hsl.h, palette_saturation, primary_hsl.l);
    const secondary = accessiblePrimary(harmony.secondary_hue, harmony.saturation, 42);
    const tertiary = accessiblePrimary(harmony.tertiary_hue, harmony.saturation, 42);
    const success_strong = accessiblePrimary(145, status_saturation, 38).color;
    const warning_strong = accessiblePrimary(38, Math.min(88, status_saturation + 10), 38).color;
    const danger_strong = accessiblePrimary(350, status_saturation, 40).color;
    const color = (hue, saturation, lightness) => hslToHex(hue, saturation, lightness);
    const light = {
      "--color-brand-50": color(primary_hsl.h, palette_saturation, 97),
      "--color-brand-100": color(primary_hsl.h, palette_saturation, 93),
      "--color-brand-200": color(primary_hsl.h, palette_saturation, 85),
      "--color-brand-300": color(primary_hsl.h, palette_saturation, 72),
      "--color-brand-500": accessible.color,
      "--color-brand-600": color(primary_hsl.h, palette_saturation, Math.max(22, accessible.lightness - 8)),
      "--color-brand-700": color(primary_hsl.h, palette_saturation, Math.max(16, accessible.lightness - 16)),
      "--color-canvas": color(primary_hsl.h, neutral_saturation, 94),
      "--color-surface": color(primary_hsl.h, neutral_saturation, 100),
      "--color-panel": color(primary_hsl.h, neutral_saturation, 98),
      "--color-subtle": color(primary_hsl.h, neutral_saturation, 97),
      "--color-subtle-2": color(primary_hsl.h, neutral_saturation, 94),
      "--color-line": color(primary_hsl.h, neutral_saturation, 93),
      "--color-line-2": color(primary_hsl.h, neutral_saturation, 87),
      "--color-line-soft": color(primary_hsl.h, neutral_saturation, 95),
      "--color-ink": color(primary_hsl.h, neutral_saturation + 5, 12),
      "--color-ink-2": color(primary_hsl.h, neutral_saturation + 4, 25),
      "--color-body": color(primary_hsl.h, neutral_saturation + 2, 36),
      "--color-muted": color(primary_hsl.h, neutral_saturation, 44),
      "--color-faint": color(primary_hsl.h, neutral_saturation, 60),
      "--color-faintest": color(primary_hsl.h, neutral_saturation, 78),
      "--color-accent": color(primary_hsl.h, neutral_saturation + 5, 12),
      "--color-accent-2": color(primary_hsl.h, neutral_saturation + 4, 22),
      "--color-on-accent": "#ffffff",
      "--color-ok": success_strong, "--color-ok-soft": color(145, status_saturation, 96), "--color-ok-strong": success_strong,
      "--color-warn": warning_strong, "--color-warn-soft": color(38, status_saturation, 96), "--color-warn-strong": warning_strong,
      "--color-bad": danger_strong, "--color-bad-soft": color(350, status_saturation, 96), "--color-bad-strong": danger_strong,
      "--color-info": accessible.color, "--color-info-soft": color(primary_hsl.h, palette_saturation, 96),
      "--color-alt": secondary.color, "--color-alt-soft": color(harmony.secondary_hue, harmony.saturation, 96),
      "--color-secondary": secondary.color, "--color-secondary-soft": color(harmony.secondary_hue, harmony.saturation, 96),
      "--color-tertiary": tertiary.color, "--color-tertiary-soft": color(harmony.tertiary_hue, harmony.saturation, 96),
      "--color-brand-fg": accessible.color, "--color-brand-soft": color(primary_hsl.h, palette_saturation, 96),
      "--color-neutral": color(primary_hsl.h, neutral_saturation, 40), "--color-neutral-soft": color(primary_hsl.h, neutral_saturation, 94)
    };
    const dark = {
      "--color-brand-50": color(primary_hsl.h, palette_saturation, 13),
      "--color-brand-100": color(primary_hsl.h, palette_saturation, 18),
      "--color-brand-200": color(primary_hsl.h, palette_saturation, 25),
      "--color-brand-300": color(primary_hsl.h, palette_saturation, 70),
      "--color-brand-500": accessible.color,
      "--color-brand-600": color(primary_hsl.h, palette_saturation, Math.max(22, accessible.lightness - 8)),
      "--color-brand-700": color(primary_hsl.h, palette_saturation, Math.max(16, accessible.lightness - 16)),
      "--color-canvas": color(primary_hsl.h, neutral_saturation + 2, 5),
      "--color-surface": color(primary_hsl.h, neutral_saturation + 2, 9),
      "--color-panel": color(primary_hsl.h, neutral_saturation + 2, 7),
      "--color-subtle": color(primary_hsl.h, neutral_saturation + 2, 12),
      "--color-subtle-2": color(primary_hsl.h, neutral_saturation + 2, 16),
      "--color-line": color(primary_hsl.h, neutral_saturation + 2, 16),
      "--color-line-2": color(primary_hsl.h, neutral_saturation + 2, 22),
      "--color-line-soft": color(primary_hsl.h, neutral_saturation + 2, 13),
      "--color-ink": color(primary_hsl.h, neutral_saturation, 92),
      "--color-ink-2": color(primary_hsl.h, neutral_saturation, 80),
      "--color-body": color(primary_hsl.h, neutral_saturation, 68),
      "--color-muted": color(primary_hsl.h, neutral_saturation, 60),
      "--color-faint": color(primary_hsl.h, neutral_saturation, 48),
      "--color-faintest": color(primary_hsl.h, neutral_saturation, 34),
      "--color-accent": color(primary_hsl.h, neutral_saturation, 92),
      "--color-accent-2": color(primary_hsl.h, neutral_saturation, 82),
      "--color-on-accent": color(primary_hsl.h, neutral_saturation + 2, 5),
      "--color-ok": color(145, status_saturation, 68), "--color-ok-soft": color(145, status_saturation * 0.72, 12), "--color-ok-strong": success_strong,
      "--color-warn": color(42, Math.min(90, status_saturation + 10), 68), "--color-warn-soft": color(42, status_saturation * 0.72, 12), "--color-warn-strong": warning_strong,
      "--color-bad": color(350, Math.min(85, status_saturation + 7), 72), "--color-bad-soft": color(350, status_saturation * 0.72, 13), "--color-bad-strong": danger_strong,
      "--color-info": color(primary_hsl.h, palette_saturation, 75), "--color-info-soft": color(primary_hsl.h, 48, 13),
      "--color-alt": color(harmony.secondary_hue, harmony.saturation, 75), "--color-alt-soft": color(harmony.secondary_hue, 48, 13),
      "--color-secondary": color(harmony.secondary_hue, harmony.saturation, 75), "--color-secondary-soft": color(harmony.secondary_hue, 48, 13),
      "--color-tertiary": color(harmony.tertiary_hue, harmony.saturation, 75), "--color-tertiary-soft": color(harmony.tertiary_hue, 48, 13),
      "--color-brand-fg": color(primary_hsl.h, palette_saturation, 75), "--color-brand-soft": color(primary_hsl.h, 48, 13),
      "--color-neutral": color(primary_hsl.h, neutral_saturation, 60), "--color-neutral-soft": color(primary_hsl.h, neutral_saturation + 2, 16)
    };
    return {
      light, dark,
      secondary: light["--color-secondary"],
      tertiary: light["--color-tertiary"],
      neutral: light["--color-neutral"],
      warning: light["--color-warn"],
      danger: light["--color-bad"],
      harmony: harmony.label
    };
  }

  function resolvedDark() {
    return mode === "dark" || (mode === "system" && media.matches);
  }

  function customProperties() {
    return Object.keys(generateThemeTokens(custom_color).light);
  }

  function clearCustomTheme() {
    customProperties().forEach((property) => document.documentElement.style.removeProperty(property));
  }

  function applyCustomTheme() {
    const generated = generateThemeTokens(custom_color);
    const tokens = resolvedDark() ? generated.dark : generated.light;
    Object.entries(tokens).forEach(([property, value]) => document.documentElement.style.setProperty(property, value));
    remember(CUSTOM_TOKENS_KEY, JSON.stringify({ light: generated.light, dark: generated.dark }));
  }

  function apply() {
    document.documentElement.dataset.theme = palette;
    document.documentElement.classList.toggle("dark", resolvedDark());
    clearCustomTheme();
    if (palette === "custom") applyCustomTheme();
    render();
  }

  function setPalette(value) {
    if (!PALETTES.includes(value)) return;
    palette = value;
    remember(PALETTE_KEY, palette);
    apply();
  }

  function setCustomColor(value) {
    const next_color = String(value || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(next_color)) return;
    custom_color = next_color;
    palette = "custom";
    remember(PRIMARY_KEY, custom_color);
    remember(PALETTE_KEY, palette);
    apply();
  }

  function setMode(value) {
    if (!MODES.includes(value)) return;
    mode = value;
    remember(MODE_KEY, mode);
    apply();
  }

  function getPalette() { return palette; }
  function getMode() { return mode; }
  function getPrimaryColor() { return custom_color; }
  function isDark() { return document.documentElement.classList.contains("dark"); }

  function paletteOption(value) {
    const swatches = SWATCHES[value].map((color) =>
      `<span class="h-5 flex-1 first:rounded-l-full last:rounded-r-full" style="background:${color}"></span>`
    ).join("");
    return `<label class="cursor-pointer rounded-xl bg-subtle p-2.5 text-left ring-1 ring-line-2 transition hover:ring-brand-300 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:checked]:bg-brand-soft has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
      <input class="sr-only" type="radio" name="color-theme" value="${value}" data-change="theme-palette" ${palette === value ? "checked" : ""} />
      <span class="flex overflow-hidden rounded-full ring-1 ring-black/5" aria-hidden="true">${swatches}</span>
      <span class="mt-2 flex items-center justify-between gap-1 text-xs font-semibold text-ink-2">
        ${PALETTE_LABELS[value]}
        ${palette === value ? '<span aria-hidden="true">✓</span>' : ""}
      </span>
    </label>`;
  }

  function modeOption(value) {
    return `<label class="cursor-pointer rounded-lg px-3 py-2 text-center text-xs font-semibold text-muted transition hover:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:checked]:bg-surface has-[:checked]:text-brand-fg has-[:checked]:shadow-sm">
      <input class="sr-only" type="radio" name="appearance-mode" value="${value}" data-change="theme-mode" ${mode === value ? "checked" : ""} />
      ${mode === value ? '<span aria-hidden="true">✓</span> ' : ""}${MODE_LABELS[value]}
    </label>`;
  }

  function customPicker() {
    const generated = generateThemeTokens(custom_color);
    const preview_colors = [custom_color, generated.secondary, generated.tertiary, generated.neutral, generated.warning, generated.danger];
    const preview = preview_colors.map((color) =>
      `<span class="h-4 flex-1 first:rounded-l-full last:rounded-r-full" style="background:${color}"></span>`
    ).join("");
    const selected_class = palette === "custom" ? "bg-brand-soft ring-2 ring-brand-500" : "bg-subtle ring-1 ring-line-2";
    return `<div class="mt-3 rounded-xl p-3 ${selected_class}">
      <div class="flex items-center gap-3">
        <label for="custom-primary-color" class="text-xs font-semibold text-ink-2">Custom primary</label>
        <span class="ml-auto font-mono text-[11px] font-semibold text-muted" aria-live="polite">${custom_color.toUpperCase()}</span>
        ${palette === "custom" ? '<span class="text-xs font-bold text-brand-fg" aria-hidden="true">✓</span>' : ""}
        <input id="custom-primary-color" name="custom-primary" type="color" value="${custom_color}"
               data-change="theme-custom-color" aria-describedby="custom-theme-help"
               class="h-10 w-12 cursor-pointer rounded-lg bg-surface p-1 ring-1 ring-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" />
      </div>
      <div class="mt-2 flex overflow-hidden rounded-full ring-1 ring-black/5" aria-hidden="true">${preview}</div>
      <p id="custom-theme-help" class="mt-2 text-[11px] leading-4 text-muted">${generated.harmony}. Automatically balances secondary, tertiary, neutral, status, surface, and text colors.</p>
    </div>`;
  }

  function render() {
    const trigger = document.getElementById("theme-toggle");
    const panel = document.getElementById("appearance-popover");
    if (!trigger || !panel) return;
    const focused = panel.contains(document.activeElement)
      ? { name: document.activeElement.name, value: document.activeElement.value }
      : null;

    const summary = `${PALETTE_LABELS[palette]} theme, ${MODE_LABELS[mode]} appearance`;
    trigger.setAttribute("title", summary);
    trigger.setAttribute("aria-label", `${open ? "Close" : "Open"} appearance settings. ${summary}.`);
    trigger.setAttribute("aria-expanded", String(open));
    trigger.innerHTML = `<span class="relative">
      <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PALETTE_ICON}</svg>
      <span class="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-surface" aria-hidden="true"></span>
    </span>`;

    panel.className = "absolute right-0 top-14 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-2xl bg-surface p-4 text-ink shadow-2xl ring-1 ring-line-2";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Appearance settings");
    panel.innerHTML = `<fieldset>
      <legend class="text-xs font-bold uppercase tracking-[0.12em] text-faint">Color theme</legend>
      <div class="mt-3 grid grid-cols-3 gap-2">${PRESET_PALETTES.map(paletteOption).join("")}</div>
      ${customPicker()}
    </fieldset>
    <fieldset class="mt-5">
      <legend class="text-xs font-bold uppercase tracking-[0.12em] text-faint">Appearance</legend>
      <div class="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-subtle-2 p-1">${MODES.map(modeOption).join("")}</div>
    </fieldset>
    <div class="mt-5 flex items-center justify-between gap-4 rounded-xl bg-subtle p-3">
      <div><p class="text-xs font-semibold text-ink-2">Confetti</p><p class="mt-0.5 text-[11px] text-faint">Show it across the app</p></div>
      ${H.toggle(Confetti.isEnabled(), { "data-action": "toggle-confetti" })}
    </div>`;
    panel.hidden = !open;
    if (focused && open) {
      const next = Array.from(panel.querySelectorAll(`input[name="${focused.name}"]`))
        .find((input) => input.value === focused.value);
      if (next) next.focus();
    }
  }

  // The popover is not modal: Tab may move through it and continue into the
  // rest of the header. Escape is the explicit close-and-return shortcut.
  function setOpen(value, restoreFocus) {
    open = !!value;
    render();
    if (restoreFocus) document.getElementById("theme-toggle")?.focus();
  }

  function toggle() { setOpen(!open, false); }

  function onDocumentClick(event) {
    if (!open) return;
    const switcher = document.getElementById("appearance-switcher");
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (switcher && !path.includes(switcher) && !switcher.contains(event.target)) setOpen(false, false);
  }

  function onDocumentKeydown(event) {
    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpen(false, true);
    }
  }

  function init() {
    apply();
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeydown);
    const onSystemChange = () => { if (mode === "system") apply(); };
    if (media.addEventListener) media.addEventListener("change", onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  return { init, render, toggle, setPalette, setCustomColor, setMode, getPalette, getMode, getPrimaryColor, isDark };
})();

Actions.on("toggle-appearance", () => Theme.toggle());
Actions.onChange("theme-palette", (el) => Theme.setPalette(el.value));
Actions.onChange("theme-custom-color", (el) => Theme.setCustomColor(el.value));
Actions.onChange("theme-mode", (el) => Theme.setMode(el.value));
Actions.on("toggle-confetti", () => {
  Confetti.setEnabled(!Confetti.isEnabled());
  Theme.render();
});
