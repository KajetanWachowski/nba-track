import type { Explanation } from "@/lib/model/explain";

/** „Skąd ta projekcja?” — prosty rozkład na kroki (bez procentów i żargonu). */
export function ProjectionExplain({ e, line, unit }: { e: Explanation; line?: number | null; unit: string }) {
  const steps = e.steps.filter((s) => s.key !== "base");
  const maxAbs = Math.max(0.5, ...steps.map((s) => Math.abs(s.delta)));
  const fmt = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold leading-snug">{e.headline}</p>
      <ol className="space-y-2">
        <li className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <span><span className="font-semibold">Start: średnia sezonu</span><span className="block text-xs text-ink-3">{e.steps[0].text}</span></span>
          <span className="num text-lg font-black">{e.start.toFixed(1)}</span>
        </li>
        {steps.map((s) => (
          <li key={s.key} className="rounded-lg px-3 py-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{s.label}</span>
              <span className={`num font-bold ${Math.abs(s.delta) < 0.05 ? "text-ink-3" : s.delta > 0 ? "text-pos" : "text-neg"}`}>{fmt(s.delta)}</span>
            </div>
            <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="flex w-1/2 justify-end">{s.delta < 0 && <div className="h-full rounded-l-full bg-neg" style={{ width: `${(Math.abs(s.delta) / maxAbs) * 100}%` }} />}</div>
              <div className="w-1/2">{s.delta > 0 && <div className="h-full rounded-r-full bg-pos" style={{ width: `${(s.delta / maxAbs) * 100}%` }} />}</div>
            </div>
            <p className="mt-1 text-xs text-ink-3">{s.text}</p>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 rounded-lg border border-line px-3 py-2">
          <span className="font-semibold">= Projekcja modelu</span>
          <span className="num text-lg font-black">{e.projection.toFixed(1)}</span>
        </li>
      </ol>
      {line !== undefined && line !== null && (
        <p className="text-xs text-ink-2">
          Linia {line} — projekcja jest o <b>{Math.abs(e.projection - line).toFixed(1)} {unit}</b> {e.projection < line ? "niżej" : "wyżej"}. To średnia z symulacji;
          rzeczywiste wyniki rozrzucają się wokół niej, dlatego szansa nie wynosi 0% ani 100%.
        </p>
      )}
      {e.opponent.length > 0 && (
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="label mb-1">Rywal w liczbach</div>
          <ul className="space-y-1 text-xs text-ink-2">{e.opponent.map((t) => <li key={t}>• {t}</li>)}</ul>
        </div>
      )}
      <p className="text-[11px] text-ink-3">Zielony pasek = podnosi projekcję, czerwony = obniża. Kroki sumują się do projekcji.</p>
    </div>
  );
}
