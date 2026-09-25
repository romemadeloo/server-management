"use client";

import { createContext, useContext } from "react";

export const InstallPromptContext = createContext({
    available: false,
    install: async (): Promise<void> => {},
});

export function useInstallPrompt() {
    return useContext(InstallPromptContext);
}
