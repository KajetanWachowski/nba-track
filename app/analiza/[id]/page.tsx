import Link from "next/link";
import { ChartCard, CoverageTile, GamesVsLine, Gauge, HBars, OutcomeHistogram, Waterfall, toneFill, toneText, type Tone } from "@/components/AnalysisCharts";
import { CATEGORY } from "@/lib/categories";
import { Term } from "@/components/Term";
import { Notice } from "@/components/ui";
import { shortDate, tipTime } from "@/lib/format";
import { buildNarrative } from "@/lib/narrative";
import { loadSlate } from "@/lib/page-data";

export const dynamic = "force-dynamic";

const SEV_TONE = { krytyczne: "neg", istotne: "neg", drobne: "warn" } as const;

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const betId = decodeURIComponent(id);
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Nie udało się wczytać meczów: {error}</Notice>;
  const b = a.bets.find((x) => x.id === betId);
  if (!b) {
    return (
      <div className="space-y-3">
        <Notice>Tego zakładu nie ma już w dzisiejszej analizie (zmieniła się linia, kurs albo mecz już się odbył).</Notice>
        <Link href="/value-bets" className="text-accent">← Wróć do propozycji</Link>
      </div>
    );
  }
  const as = b.assessment;
  const s = as.stats;
  const n = buildNarrative(b);
  const over = b.side === "over" || b.side === "yes";
  const cat = CATEGORY[as.category];
  const probTone: Tone = as.probability.value >= 0.58 ? "pos" : as.probability.value >= 0.5 ? "warn" : "neg";
  const qTone: Tone = as.quality.score >= 75 ? "pos" : as.quality.score >= 55 ? "warn" : "neg";
  const vTone: Tone = as.value.ev >= 0.02 ? "pos" : as.value.ev >= -0.02 ? "warn" : "neg";
  const bestDec = Math.max(...b.offers.map((o) => o.eff));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/value-bets" className="text-sm text-accent">← Wszystkie propozycje</Link>

      {/* nagłówek */}
      <header className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${cat.cls}`}>{cat.label}</span>
          <span className="text-xs text-ink-3">{b.gameLabel} · {tipTime(b.tipoff)}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black leading-tight sm:text-3xl">{n.headline}</h1>
            <div className="mt-1 text-sm text-ink-3">
              {b.kind === "player" ? <Link className="hover:text-accent" href={`/players/${b.subjectId}?market=${b.market}&line=${b.line ?? ""}`}>{b.subjectName}</Link> : b.subjectName}
              {b.kind === "player" && ` · ${b.teamAbbr} vs ${b.oppAbbr}`}
            </div>
          </div>
          <div className="text-right">
            <div className="num text-4xl font-black">{b.price.toFixed(2)}</div>
            <div className="text-xs text-ink-3">{b.playable ? b.book : <span className="text-warn">{b.book} — tylko orientacyjnie</span>}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Gauge label="Szansa" value={as.probability.value * 100} display={`${Math.round(as.probability.value * 100)}%`} tone={probTone} sub={`${Math.round(as.probability.low * 100)}–${Math.round(as.probability.high * 100)}%`} />
          <Gauge label="Jakość danych" value={as.quality.score} display={`${as.quality.score}`} tone={qTone} sub={as.quality.level} />
          <Gauge label="Opłacalność (EV)" value={50 + as.value.ev * 250} display={`${as.value.ev >= 0 ? "+" : ""}${(as.value.ev * 100).toFixed(1)}%`} tone={vTone} sub={as.value.label} />
        </div>
        <div className={`mt-4 rounded-xl px-3 py-2.5 text-sm font-semibold ${n.verdict.tone === "pos" ? "bg-pos-soft text-pos" : n.verdict.tone === "warn" ? "bg-warn-soft text-warn" : "bg-neg-soft text-neg"}`}>
          {n.verdict.text}
        </div>
      </header>

      {/* pokrycie linii */}
      {n.coverage.length > 0 && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {n.coverage.map((c) => <CoverageTile key={c.label} {...c} />)}
        </section>
      )}

      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Ostatnie 10 meczów vs linia" sub={`Wynik zawodnika w każdym meczu (${b.marketLabel.toLowerCase()}).`}
            legend={[{ tone: "pos", label: "trafione" }, { tone: "neg", label: "nietrafione" }, { tone: "warn", label: "o włos (±10% linii)" }]}>
            <GamesVsLine over={over} line={b.line} games={s.recent.map((r) => ({ value: r.value, label: r.opp, sub: shortDate(r.date) }))} />
          </ChartCard>
          <ChartCard title="Jak może się skończyć ten mecz?" sub="Rozkład wyników z 8 000 symulacji modelu (przed kalibracją). Zielone = zakład wchodzi.">
            <OutcomeHistogram bins={s.hist ?? []} line={b.line} over={over} projection={s.explain?.projection ?? b.projection?.mean ?? null} />
            <p className="mt-2 text-[11px] text-ink-3">
              Surowe symulacje dają {Math.round(b.rawProb * 100)}%, ale ostateczna szansa ({Math.round(b.modelProb * 100)}%) jest skalibrowana: łączy model z rynkiem według tego, jak oba sprawdzały się w backteście. Surowy model bywa zbyt pewny siebie.
            </p>
          </ChartCard>
        </div>
      )}

      {s?.explain && (
        <ChartCard title="Skąd ta projekcja?" sub={s.explain.headline}>
          <Waterfall start={s.explain.start} end={s.explain.projection} line={b.line} over={over}
            steps={s.explain.steps.filter((x) => x.key !== "base").map((x) => ({ label: x.label, delta: x.delta, text: x.text }))} />
        </ChartCard>
      )}

      {/* narracja */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-lg font-black">Dlaczego ten typ?</h2>
        <p className="mt-0.5 text-xs text-ink-3">Opis złożony wyłącznie z danych: statystyk, składu, rywala i kursów. Kolor paska po lewej: zielony = przemawia za, czerwony = przeciw, pomarańczowy = na granicy.</p>
        <ol className="mt-4 space-y-3">
          {n.blocks.map((bl, i) => (
            <li key={bl.title} className="flex gap-3 rounded-xl bg-surface-2 p-3">
              <span className="w-1 shrink-0 rounded-full" style={{ background: toneFill[bl.tone] }} aria-hidden />
              <div className="min-w-0">
                <h3 className={`text-sm font-black ${toneText[bl.tone]}`}>{i + 1}. {bl.title}</h3>
                <ul className="mt-1 space-y-1 text-sm text-ink-2">{bl.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Argumenty" legend={[{ tone: "pos", label: "za" }, { tone: "neg", label: "przeciw (istotne)" }, { tone: "warn", label: "przeciw (drobne)" }]}>
          <ul className="space-y-1.5 text-sm">
            {as.pros.map((p) => <li key={p} className="flex gap-2"><span className="text-pos" aria-hidden>✓</span><span className="text-ink-2">{p}</span></li>)}
            {as.risks.map((r) => (
              <li key={r.text} className="flex gap-2"><span className={toneText[SEV_TONE[r.severity]]} aria-hidden>✗</span><span className="text-ink-2">{r.text} <span className={`text-[11px] font-bold uppercase ${toneText[SEV_TONE[r.severity]]}`}>{r.severity}</span></span></li>
            ))}
          </ul>
        </ChartCard>

        {s && (
          <ChartCard title="Minuty w ostatnich meczach" sub={`Kreska = minuty zakładane przez model (${s.minutes.projected.toFixed(1)}).`}>
            <GamesVsLine neutral over line={Math.round(s.minutes.projected * 10) / 10} lineLabel="model" height={170}
              games={s.recent.map((r) => ({ value: Math.round(r.min), label: r.opp }))} />
          </ChartCard>
        )}

        {s && s.vsOpp.length > 0 && (
          <ChartCard title={`Mecze z ${b.oppAbbr}`} sub="Ten i poprzedni sezon.">
            <GamesVsLine over={over} line={b.line} height={170} games={s.vsOpp.map((v) => ({ value: v.value, label: shortDate(v.date), sub: v.season === "ten" ? "ten sezon" : "poprz." }))} />
          </ChartCard>
        )}

        {s && (
          <ChartCard title="Procent trafień linii" sub={`Jak często wynik był ${over ? "powyżej" : "poniżej"} ${b.line ?? ""}.`}>
            <HBars max={1} format={(v) => `${Math.round(v * 100)}%`}
              items={[
                ...s.windows.map((w) => ({ label: `${w.label} (${w.hits}/${w.n})`, value: w.hitRate, tone: (w.hitRate >= 0.6 ? "pos" : w.hitRate >= 0.45 ? "warn" : "neg") as Tone })),
                { label: "Model (szansa)", value: b.modelProb, tone: probTone },
                { label: "Kurs zakłada", value: b.impliedProb, tone: "neutral" as Tone },
              ]} />
          </ChartCard>
        )}

        {b.offers.length > 0 && (
          <ChartCard title="Porównanie kursów" sub={`Uczciwy kurs wg modelu: ${b.fairOdds.toFixed(2)}. Zielony = kurs powyżej uczciwego.`}>
            <HBars max={Math.max(bestDec, b.fairOdds) * 1.05}
              items={[...b.offers].sort((x, y) => y.eff - x.eff).map((o) => ({
                label: `${o.book}${o.polish ? "" : " (USA)"}${o.source === "manual" ? " · ręcznie" : ""}`,
                value: o.eff,
                tone: (o.eff >= b.fairOdds * 1.02 ? "pos" : o.eff >= b.fairOdds * 0.98 ? "warn" : "neg") as Tone,
              }))} />
          </ChartCard>
        )}

        {s && (s.likelyDefender || (s.oppMissing?.length ?? 0) > 0) && (
          <ChartCard title={`Obrona ${b.oppAbbr}`} sub="Bezpośredni rywal to przybliżenie: zawodnik rywala z najwięcej minut na tej samej pozycji. Publiczne dane nie mówią, kto kogo kryje.">
            {s.likelyDefender && (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="col-span-4 text-left text-sm font-bold sm:col-span-1">{s.likelyDefender.name}</div>
                {[["min", s.likelyDefender.min], ["przechwyty", s.likelyDefender.stl], ["bloki", s.likelyDefender.blk]].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg bg-surface-2 p-2"><div className="num text-lg font-black">{(v as number).toFixed(1)}</div><div className="text-[11px] text-ink-3">{l} / mecz</div></div>
                ))}
              </div>
            )}
            {(s.oppMissing ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-ink-2">
                {s.oppMissing!.map((m) => {
                  const t: Tone = m.effect === null || Math.abs(m.effect - 1) < 0.03 ? "neutral" : (m.effect > 1) === over ? "pos" : "neg";
                  return (
                    <li key={m.name}>
                      <b>{m.name}</b> ({m.status}) nie zagra —{" "}
                      {m.effect === null ? "za mało meczów bez niego, żeby policzyć wpływ." : <span className={toneText[t]}>rywale tej pozycji zdobywali bez niego {m.effect >= 1 ? "+" : "−"}{Math.abs((m.effect - 1) * 100).toFixed(0)}% na minutę ({m.nWithout} mecze)</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </ChartCard>
        )}
      </div>

      <p className="text-xs text-ink-3">
        <Term k="prob">Szansa</Term> to skalibrowane prawdopodobieństwo modelu sprawdzone w backteście. Żaden typ nie jest pewny — nawet przy 60% co czwarty–piąty kupon z trzech nóg przegrywa.
      </p>
    </div>
  );
}
