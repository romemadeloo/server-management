import type { Metadata, Viewport } from "next";
import NextTopLoader from "nextjs-toploader";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { InstallPromptProvider } from "@/components/pwa/InstallPromptProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glophics Portal",
  description: "Which QA/staging environments are free, and which are held by a Jira ticket.",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Glophics", statusBarStyle: "default" },
};

// System light/dark defaults; following custom palettes is a separate change.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#007f6d" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1211" },
  ],
};

/**
 * Applied before the body renders so a dark-mode user never sees a white flash.
 * Ported from the inline script in the legacy public/index.html.
 *
 * This has to be inline and blocking: any deferred script runs after first paint,
 * which is exactly the flash it exists to prevent. `dangerouslySetInnerHTML` is
 * the only way to emit a script body in JSX, and it is safe here because the
 * content is this constant — nothing user-supplied reaches it.
 *
 * The stored palette values are validated against a whitelist and a strict hex
 * pattern before being written as CSS custom properties, so a tampered
 * localStorage cannot inject a value into the stylesheet.
 */
const THEME_INIT = `
try {
  var palettes = ["violet", "ocean", "emerald", "custom"];
  var modes = ["system", "light", "dark"];
  var palette = localStorage.getItem("serverManager.colorTheme");
  var mode = localStorage.getItem("serverManager.theme");
  if (palettes.indexOf(palette) < 0) palette = "violet";
  if (modes.indexOf(mode) < 0) mode = "system";
  var dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = palette;
  document.documentElement.classList.toggle("dark", dark);
  if (palette === "custom") {
    var stored = JSON.parse(localStorage.getItem("serverManager.customThemeTokens") || "null");
    var tokens = stored && stored[dark ? "dark" : "light"];
    var entries = tokens && Object.keys(tokens);
    var valid = entries && entries.length > 20 && entries.every(function (property) {
      return property.indexOf("--color-") === 0 && /^#[0-9a-f]{6}$/i.test(tokens[property]);
    });
    if (!valid) {
      document.documentElement.dataset.theme = "violet";
    } else {
      entries.forEach(function (property) {
        document.documentElement.style.setProperty(property, tokens[property]);
      });
    }
  }
} catch (e) {
  document.documentElement.dataset.theme = "violet";
  document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches);
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      {/* overflow-hidden guarantees only the sidebar and main pane scroll, never
          the document, so the shell can never be pushed off-screen. */}
      <body className="h-full overflow-hidden bg-canvas font-sans text-ink antialiased">
        {/*
          Navigation progress.

          In the root layout, not the app one, so it also covers the sign-in
          redirect — the one navigation that happens before any session exists.

          The colour is the theme variable rather than a hex, so the bar follows
          whichever palette is active instead of being brand-teal on an ocean
          board. showSpinner is off: a corner spinner competes with the bar for
          attention and says nothing extra.
        */}
        <NextTopLoader
          color="var(--color-brand-500)"
          height={2}
          shadow="0 0 8px var(--color-brand-500)"
          showSpinner={false}
          // Below the modal backdrop (z-50) and the toaster (z-60), so a dialog
          // is never underlined by a progress bar creeping across it.
          zIndex={40}
        />
        <ServiceWorkerRegister />
        <InstallPromptProvider>{children}</InstallPromptProvider>
      </body>
    </html>
  );
}
