"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/games", label: "NBA Games" },
  { href: "/players", label: "Player Analysis" },
  { href: "/matchups", label: "Matchup Analysis" },
  { href: "/value-bets", label: "Value Bets" },
  { href: "/odds", label: "Odds Comparison" },
  { href: "/history", label: "Historical Performance" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
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
      Theme
    </button>
  );
}
