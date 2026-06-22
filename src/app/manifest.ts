import type { MetadataRoute } from "next";
import { copy } from "@/lib/copy";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: copy.app.name,
    short_name: copy.app.name,
    description: copy.app.description,
    id: "/",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#e8dcc2",
    theme_color: "#e8dcc2",
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
