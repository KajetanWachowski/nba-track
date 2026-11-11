import Link from "next/link";
import type { ReactNode } from "react";
import { ago } from "@/lib/format";

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-surface ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="label">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, accent, children }: { eyebrow: string; title: string; accent?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="label text-accent">{eyebrow}</div>
        <h1 className="mt-1 text-3xl font-black uppercase tracking-tight sm:text-4xl">
          {title} {accent && <span className="text-accent">{accent}</span>}
        </h1>
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" | "warn" }) {
  const c = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="label">{label}</div>
      <div className={`num mt-1 text-3xl font-black ${c}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "pos" | "neg" | "warn" | "neutral" | "accent" }) {
  const cls = {
    pos: "bg-pos-soft text-pos",
    neg: "bg-neg-soft text-neg",
    warn: "bg-warn-soft text-warn",
    neutral: "bg-surface-2 text-ink-2",
    accent: "bg-accent/15 text-accent",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export const INJURY_PL: Record<string, string> = {
  OUT: "Nie zagra",
  DOUBTFUL: "Raczej nie zagra",
  QUESTIONABLE: "Niepewny",
  PROBABLE: "Raczej zagra",
  "DAY-TO-DAY": "Z dnia na dzień",
};

export function InjuryBadge({ status }: { status: string }) {
  const tone = status === "OUT" ? "neg" : status === "DOUBTFUL" || status === "QUESTIONABLE" ? "warn" : "neutral";
  return <span title={status}><Badge tone={tone}>{INJURY_PL[status] ?? status}</Badge></span>;
}

export function SourceBar({ sources }: { sources: { name: string; fetchedAt: number | null; ok: boolean; note?: string }[] }) {
  return (
    <div className="mb-6 flex flex-wrap gap-2 text-xs">
      {sources.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-ink-2" title={s.note}>
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.ok ? "bg-pos" : s.fetchedAt ? "bg-warn" : "bg-ink-3"}`} />
          {s.name}: {s.ok ? `aktualizacja ${ago(s.fetchedAt)}` : s.note ?? (s.fetchedAt ? `nieaktualne (${ago(s.fetchedAt)})` : "niedostępne")}
        </span>
      ))}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "neg" | "neutral"; children: ReactNode }) {
  const cls = tone === "neg" ? "border-neg/40 bg-neg-soft text-neg" : tone === "warn" ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-surface-2 text-ink-2";
  return <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-2 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function TeamLogo({ src, abbr, size = 24 }: { src?: string | null; abbr?: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={abbr ?? ""} width={size} height={size} className="inline-block shrink-0 object-contain" /> : <span className="text-xs text-ink-3">{abbr}</span>;
}

export function PlayerLink({ id, name }: { id: string; name: string }) {
  return <Link href={`/players/${id}`} className="font-semibold hover:text-accent">{name}</Link>;
}
