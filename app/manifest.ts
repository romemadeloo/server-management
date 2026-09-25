import type { MetadataRoute } from "next";

/** Static installation colours come from the default palette in globals.css.
 * Custom palettes remain a page preference; the manifest cannot follow them. */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Glophics Portal",
        short_name: "Glophics",
        description: "Which QA/staging environments are free, and which are held by a Jira ticket.",
        id: "/",
        start_url: "/dashboard",
        scope: "/",
        display: "standalone",
        background_color: "#ecefee",
        theme_color: "#007f6d",
        // Separate artwork keeps the maskable mark inside its circular safe zone.
        icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Every role can visit these pages; chat has a separate capability gate.
        shortcuts: [
            { name: "Dashboard", url: "/dashboard" },
            { name: "Environments", url: "/environments" },
            { name: "My tickets", url: "/my-tickets" },
        ],
    };
}
