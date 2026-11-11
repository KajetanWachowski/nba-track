"use client";
import { useEffect, useRef, useState } from "react";
import { GLOSSARY } from "@/lib/glossary";

/** Skrót lub pojęcie z ikoną ⓘ — kliknięcie pokazuje proste wyjaśnienie. */
export function Term({ k, children, className = "" }: { k: keyof typeof GLOSSARY | string; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const g = GLOSSARY[k];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  if (!g) return <>{children}</>;
  return (
    <span ref={ref} className={`relative inline-flex items-center gap-1 ${className}`}>
      {children ?? g.term}
      <button
        type="button"
        aria-label={`Co to znaczy: ${g.term}`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(!open); }}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-[10px] font-bold normal-case leading-none tracking-normal text-ink-3 hover:border-ink-3 hover:text-ink"
      >
        i
      </button>
      {open && (
        <span role="tooltip" className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-line bg-surface-2 p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink-2 shadow-xl">
          <span className="mb-1 block font-semibold text-ink">{g.term}</span>
          {g.text}
        </span>
      )}
    </span>
  );
}
