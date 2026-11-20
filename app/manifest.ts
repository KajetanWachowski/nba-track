import type { MetadataRoute } from "next";

/** Ustawienia aplikacji na telefon: po „Dodaj do ekranu głównego” strona otwiera się na pełnym ekranie jak aplikacja. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NBA Edge — kupony i analiza NBA",
    short_name: "NBA Edge",
    description: "Typy dnia, kupony i analiza zawodników NBA z kursami polskich bukmacherów.",
    lang: "pl",
    start_url: "/kupony",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0e13",
    theme_color: "#0b0e13",
    categories: ["sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Kupony i wyniki", url: "/kupony", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Propozycje zakładów", url: "/value-bets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
