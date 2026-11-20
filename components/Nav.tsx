"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Pulpit" },
  { href: "/value-bets", label: "Propozycje zakładów" },
  { href: "/kupony", label: "Kupony i wyniki" },
  { href: "/pl-odds", label: "Polskie kursy" },
  { href: "/games", label: "Mecze NBA" },
  { href: "/players", label: "Analiza zawodnika" },
  { href: "/matchups", label: "Analiza rywala" },
  { href: "/odds", label: "Porównanie kursów" },
  { href: "/history", label: "Historia wyników" },
  { href: "/settings", label: "Ustawienia" },
];

export function Nav() {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <nav aria-label="Menu główne" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            active(n.href) ? "bg-surface-2 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {active(n.href) && <span aria-hidden className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />}
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      className="rounded-lg border border-line px-2 py-1 text-xs text-ink-3 hover:text-ink"
      onClick={() => {
        const el = document.documentElement;
        const next = el.dataset.theme === "light" ? "dark" : "light";
        el.dataset.theme = next;
        try { localStorage.setItem("theme", next); } catch { /* private mode */ }
      }}
    >
      Motyw
    </button>
  );
}
