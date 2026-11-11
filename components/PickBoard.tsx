"use client";
import { useMemo, useState } from "react";
import type { Category } from "@/lib/assess";
import type { BetEval } from "@/lib/engine";
import { pct, signedPct } from "@/lib/format";
import { MARKET_LABEL } from "@/lib/markets";
import { CATEGORY, PickCard } from "./PickCard";
import { Term } from "./Term";

const ORDER: Category[] = ["najlepsze", "dobre", "obserwuj", "odrzucone"];
const SECTION_TITLE: Record<Category, string> = {
  najlepsze: "Najlepsze propozycje",
  dobre: "Dobre propozycje",
  obserwuj: "Warte obserwacji",
  odrzucone: "Odrzucone przez model",
};
const SECTION_HELP: Record<Category, string> = {
  najlepsze: "Wysokie prawdopodobieństwo, wiarygodne dane, korzystny kurs u polskiego bukmachera i mało ryzyk.",
  dobre: "Spełniają progi, ale z mniejszym zapasem albo z jednym–dwoma istotnymi ryzykami.",
  obserwuj: "Blisko progu, brak kursu polskiego bukmachera albo typ zakładu niezweryfikowany w backteście.",
  odrzucone: "Model nie widzi wystarczających podstaw — mimo że część z nich na pierwszy rzut oka wygląda atrakcyjnie.",
};

export function PickBoard({ bets, totals, compact = false, showRejected = true, emptyMessage = !compact }: {
  bets: BetEval[];
  /** liczba wszystkich zakładów w każdej kategorii (lista może być przycięta) */
  totals?: Partial<Record<Category, number>>;
  /** widok skrócony (pulpit): bez filtrów i bez pustych sekcji */
  compact?: boolean;
  showRejected?: boolean;
  /** pokaż komunikat, gdy brak zakładów „Najlepsze”/„Dobre” */
  emptyMessage?: boolean;
}) {
  const [minProb, setMinProb] = useState(0.5);
  const [minEv, setMinEv] = useState(-0.05);
  const [minOdds, setMinOdds] = useState(1.5);
  const [market, setMarket] = useState("all");
  const [team, setTeam] = useState("all");
  const [q, setQ] = useState("");
  const [plOnly, setPlOnly] = useState(false);
  const [sort, setSort] = useState<"rank" | "prob" | "ev">("rank");
  const [openRejected, setOpenRejected] = useState(false);
  const [limits, setLimits] = useState<Record<Category, number>>({ najlepsze: 20, dobre: 20, obserwuj: compact ? 6 : 20, odrzucone: 10 });

  const markets = useMemo(() => [...new Set(bets.map((b) => b.market))], [bets]);
  const teams = useMemo(() => [...new Set(bets.flatMap((b) => [b.teamAbbr, b.oppAbbr]).filter(Boolean))].sort(), [bets]);
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return bets
      .filter((b) => b.assessment.category === "odrzucone" || (b.modelProb >= minProb && b.ev >= minEv && b.price >= minOdds))
      .filter((b) => market === "all" || b.market === market)
      .filter((b) => team === "all" || b.teamAbbr === team || b.oppAbbr === team)
      .filter((b) => !plOnly || b.playable)
      .filter((b) => !ql || b.subjectName.toLowerCase().includes(ql) || b.gameLabel.toLowerCase().includes(ql))
      .sort((a, b) => (sort === "prob" ? b.modelProb - a.modelProb : sort === "ev" ? b.ev - a.ev : b.assessment.rankScore - a.assessment.rankScore));
  }, [bets, minProb, minEv, minOdds, market, team, plOnly, q, sort]);
  const by = (c: Category) => filtered.filter((b) => b.assessment.category === c);
  const recommended = by("najlepsze").length + by("dobre").length;
  const sel = "rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink";

  return (
    <div>
      {!compact && (
        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-3">
          <label className="flex flex-col gap-1"><span className="label">Zawodnik / mecz</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj…" className={`${sel} w-40`} />
          </label>
          <label className="flex flex-col gap-1"><span className="label">Rynek</span>
            <select value={market} onChange={(e) => setMarket(e.target.value)} className={sel}>
              <option value="all">Wszystkie</option>
              {markets.map((m) => <option key={m} value={m}>{MARKET_LABEL[m]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Drużyna</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)} className={sel}>
              <option value="all">Wszystkie</option>{teams.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label"><Term k="prob">Min. prawdopodobieństwo {pct(minProb, 0)}</Term></span>
            <input type="range" min={0.3} max={0.85} step={0.01} value={minProb} onChange={(e) => setMinProb(+e.target.value)} className="w-36 accent-[var(--accent)]" />
          </label>
          <label className="flex flex-col gap-1"><span className="label"><Term k="ev">Min. EV {signedPct(minEv, 0)}</Term></span>
            <input type="range" min={-0.15} max={0.2} step={0.01} value={minEv} onChange={(e) => setMinEv(+e.target.value)} className="w-36 accent-[var(--accent)]" />
          </label>
          <label className="flex flex-col gap-1"><span className="label">Min. kurs {minOdds.toFixed(2)}</span>
            <input type="range" min={1.01} max={2.5} step={0.05} value={minOdds} onChange={(e) => setMinOdds(+e.target.value)} className="w-32 accent-[var(--accent)]" />
          </label>
          <label className="flex flex-col gap-1"><span className="label">Sortuj</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={sel}>
              <option value="rank">Ocena ogólna</option><option value="prob">Prawdopodobieństwo</option><option value="ev">EV</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-2">
            <input type="checkbox" checked={plOnly} onChange={(e) => setPlOnly(e.target.checked)} className="accent-[var(--accent)]" />
            Tylko z kursem polskiego bukmachera
          </label>
        </div>
      )}

      {recommended === 0 && emptyMessage && (
        <div className="mb-5 rounded-2xl border border-dashed border-line bg-surface p-5 text-sm">
          <div className="font-semibold">System nie znalazł zakładów spełniających kryteria „Najlepsze” lub „Dobre”.</div>
          <p className="mt-1 text-ink-3">
            To prawidłowy wynik — model woli nic nie polecić, niż polecić zakład bez solidnych podstaw. Najczęstsze powody: brak kursów polskiego
            bukmachera (wpisz kurs Superbet lub pobierz kursy na stronie „Polskie kursy”), za niski kurs względem szans albo zbyt wiele ryzyk.
          </p>
        </div>
      )}

      {ORDER.filter((c) => c !== "odrzucone" || showRejected).map((c) => {
        const list = by(c);
        const total = totals?.[c];
        if (!list.length && (compact || c !== "najlepsze")) return null;
        const hidden = c === "odrzucone" && !openRejected;
        return (
          <section key={c} className="mb-6">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-black">
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${CATEGORY[c].dot}`} />
                {SECTION_TITLE[c]} <span className="text-sm font-normal text-ink-3">{list.length}{total !== undefined && total > list.length ? ` z ${total}` : ""}</span>
              </h2>
              {c === "odrzucone" && (
                <button type="button" className="text-xs text-accent" onClick={() => setOpenRejected(!openRejected)}>{openRejected ? "Ukryj" : "Pokaż, dlaczego model je odrzucił"}</button>
              )}
            </div>
            <p className="mb-3 text-xs text-ink-3">{SECTION_HELP[c]}</p>
            {!hidden && (
              list.length ? (
                <div className="grid gap-3 xl:grid-cols-2">
                  {list.slice(0, limits[c]).map((b) => <PickCard key={b.id} b={b} />)}
                </div>
              ) : <p className="text-sm text-ink-3">Brak.</p>
            )}
            {!hidden && list.length > limits[c] && (
              <button type="button" onClick={() => setLimits({ ...limits, [c]: limits[c] + 20 })} className="mt-3 w-full rounded-xl border border-line py-2 text-sm text-ink-2 hover:text-ink">
                Pokaż więcej ({list.length - limits[c]})
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
