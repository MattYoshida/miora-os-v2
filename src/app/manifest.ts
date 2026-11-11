import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MIORA OS",
    short_name: "MIORA OS",
    description: "Review, publish and learn from MIORA ads.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f3f0",
    theme_color: "#4a7a8f",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
