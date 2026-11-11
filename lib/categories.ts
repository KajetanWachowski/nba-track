import type { Category } from "./assess";

export const CATEGORY: Record<Category, { label: string; cls: string; dot: string }> = {
  najlepsze: { label: "Najlepsza propozycja", cls: "bg-pos text-black", dot: "bg-pos" },
  dobre: { label: "Dobra propozycja", cls: "bg-pos-soft text-pos", dot: "bg-pos" },
  obserwuj: { label: "Warta obserwacji", cls: "bg-warn-soft text-warn", dot: "bg-warn" },
  odrzucone: { label: "Odrzucona przez model", cls: "bg-neg-soft text-neg", dot: "bg-neg" },
};

