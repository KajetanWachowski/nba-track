"use client";
import { useState } from "react";
import { LineBarChart } from "./LineChart";

export interface GameBar {
  key: string;
  value: number;
  opp: string;
  logo?: string;
  date: string; // np. „8 lis”
  home: boolean;
  min: number;
}

/** Słupki mecz po meczu (jak w „Analizie zawodnika”) z przełącznikiem okna i kafelkami trafień. */
export function GameBarsPanel({ games, line, side, statLabel, vsOpp }: { games: GameBar[]; line: number | null; side: "over" | "under"; statLabel: string; vsOpp?: string }) {
  const [win, setWin] = useState(10);
  const [onlyOpp, setOnlyOpp] = useState(false);
  const pool = onlyOpp && vsOpp ? games.filter((g) => g.opp === vsOpp) : games;
  const shown = win === 0 ? pool : pool.slice(-win);
  const hit = (v: number) => line !== null && (side === "under" ? v < line : v > line);
  const hits = shown.filter((g) => hit(g.value)).length;
  const avg = shown.length ? shown.reduce((s, g) => s + g.value, 0) / shown.length : NaN;
  const rate = shown.length ? hits / shown.length : 0;
  const tone = !shown.length ? "text-ink-2" : rate >= 0.6 ? "text-pos" : rate >= 0.45 ? "text-warn" : "text-neg";
  const btn = (active: boolean) => `rounded-md px-2.5 py-1 font-semibold ${active ? "bg-surface-2 text-ink" : "text-ink-3"}`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex gap-1 rounded-lg border border-line p-1">
          {[5, 10, 20, 0].map((w) => (
            <button key={w} type="button" onClick={() => setWin(w)} className={btn(w === win)}>{w === 0 ? "Sezon" : `${w} meczów`}</button>
          ))}
        </div>
        {vsOpp && (
          <button type="button" onClick={() => setOnlyOpp(!onlyOpp)} className={`rounded-lg border border-line px-2.5 py-1.5 font-semibold ${onlyOpp ? "bg-surface-2 text-ink" : "text-ink-3"}`}>
            tylko vs {vsOpp}
          </button>
        )}
      </div>
      {shown.length ? (
        <LineBarChart
          line={line}
          side={side}
          data={shown.map((g) => ({
            key: g.key,
            value: g.value,
            label: g.opp,
            logo: g.logo,
            tooltip: [`${g.home ? "vs" : "@"} ${g.opp} · ${g.date}`, `${statLabel}: ${g.value}${line !== null ? ` (${hit(g.value) ? "trafione" : "nietrafione"})` : ""}`, `${g.min} min`],
          }))}
        />
      ) : (
        <p className="py-10 text-center text-sm text-ink-3">Brak meczów w tym zakresie.</p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] text-ink-3">Trafione</div>
          <div className={`num text-xl font-black ${tone}`}>{shown.length ? `${hits}/${shown.length}` : "—"}</div>
          <div className="mt-1.5 h-1.5 rounded bg-[var(--grid)]"><div className="h-1.5 rounded" style={{ width: `${rate * 100}%`, background: rate >= 0.6 ? "var(--pos)" : rate >= 0.45 ? "var(--warn)" : "var(--neg)" }} /></div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] text-ink-3">Średnia</div>
          <div className="num text-xl font-black">{Number.isFinite(avg) ? avg.toFixed(1) : "—"}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] text-ink-3">Linia</div>
          <div className="num text-xl font-black">{line ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}
