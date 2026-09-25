"use client";

import { useEffect } from "react";

/** Root-mounted so login gets the fallback too. Never register during HMR. */
export function ServiceWorkerRegister() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
        navigator.serviceWorker
            .register("/sw.js", { scope: "/", updateViaCache: "none" })
            .catch((error) => console.warn("[pwa] service worker registration failed", error));
    }, []);
    return null;
}
