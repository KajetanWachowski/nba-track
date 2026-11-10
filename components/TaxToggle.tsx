"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TaxToggle({ enabled, exempt, books, rate }: { enabled: boolean; exempt: string[]; books: { key: string; title: string }[]; rate: number }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [ex, setEx] = useState<string[]>(exempt);
  const [msg, setMsg] = useState("");
  const save = async (next: { enabled: boolean; exempt: string[] }) => {
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tax: next }) });
    setMsg((await r.json()).message ?? "");
    router.refresh();
  };
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" className="accent-[var(--accent)]" checked={on} onChange={(e) => { setOn(e.target.checked); save({ enabled: e.target.checked, exempt: ex }); }} />
        Uwzględniaj {rate * 100}% podatek od stawki u polskich bukmacherów
      </label>
      {on && (
        <div className="flex flex-wrap gap-4 pl-6 text-ink-2">
          <span className="text-ink-3">Bez podatku (promocja):</span>
          {books.map((b) => (
            <label key={b.key} className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--accent)]" checked={ex.includes(b.key)}
                onChange={(e) => { const n = e.target.checked ? [...ex, b.key] : ex.filter((k) => k !== b.key); setEx(n); save({ enabled: on, exempt: n }); }} />
              {b.title}
            </label>
          ))}
        </div>
      )}
      {msg && <p className="text-xs text-ink-3">{msg}</p>}
    </div>
  );
}
