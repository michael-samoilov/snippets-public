import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Snippets",
    short_name: "Snippets",
    description:
      "A pocket commonplace book. Catch the stories, jokes, and stray thoughts of your day before they evaporate.",
    id: "/",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f0e2",
    theme_color: "#f6f0e2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
