"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InstallPromptContext } from "./useInstallPrompt";

/** Capture at the root, including login: the event may arrive before the account
 * menu mounts, and the browser need not send it again after signing in. */
export function InstallPromptProvider({ children }: { children: React.ReactNode }) {
    const prompt_ref = useRef<BeforeInstallPromptEvent | null>(null);
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        function onPrompt(event: BeforeInstallPromptEvent) {
            event.preventDefault();
            prompt_ref.current = event;
            setAvailable(true);
        }
        function onInstalled() {
            prompt_ref.current = null;
            setAvailable(false);
        }
        window.addEventListener("beforeinstallprompt", onPrompt);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onPrompt);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, []);

    const install = useCallback(async () => {
        const prompt_event = prompt_ref.current;
        if (!prompt_event) return;
        // Each event is single-use, even on dismissal. Consume before awaiting
        // so two clicks cannot call prompt() twice or lose the user gesture.
        prompt_ref.current = null;
        setAvailable(false);
        try {
            await prompt_event.prompt();
            await prompt_event.userChoice;
        } catch (error) {
            console.warn("[pwa] installation prompt failed", error);
        }
    }, []);

    return (
        <InstallPromptContext.Provider value={{ available, install }}>
            {children}
        </InstallPromptContext.Provider>
    );
}
