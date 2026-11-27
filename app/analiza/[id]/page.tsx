import Link from "next/link";
import { ChartCard, CoverageTile, Gauge, HBars, OutcomeHistogram, Waterfall, toneFill, toneText, type Tone } from "@/components/AnalysisCharts";
import { CATEGORY } from "@/lib/categories";
import { GameBarsPanel } from "@/components/GameBarsPanel";
import { LineBarChart } from "@/components/LineChart";
import { Term } from "@/components/Term";
import { Notice, TeamLogo } from "@/components/ui";
import { getPlayerAnalysis } from "@/lib/analysis";
import { statOf } from "@/lib/assess";
import type { PlayerMarket } from "@/lib/markets";
import { getTeams } from "@/lib/store";
import { shortDate, tipTime } from "@/lib/format";
import { buildNarrative } from "@/lib/narrative";
import { loadSlate } from "@/lib/page-data";
import { findArchivedBet } from "@/lib/daily-picks";
import { defenderImpact } from "@/lib/defender";

export const dynamic = "force-dynamic";

const SEV_TONE = { krytyczne: "neg", istotne: "neg", drobne: "warn" } as const;

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const betId = decodeURIComponent(id);
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Nie udało się wczytać meczów: {error}</Notice>;
  const live = a.bets.find((x) => x.id === betId);
  const archived = live ? null : findArchivedBet(betId);
  const b = live ?? archived?.bet;
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
  const teams = getTeams();
  const team = teams.get(b.teamId) ?? [...teams.values()].find((t) => t.abbr === b.teamAbbr);
  const opp = [...teams.values()].find((t) => t.abbr === b.oppAbbr);
  const pa = b.kind === "player" ? await getPlayerAnalysis(b.subjectId).catch(() => null) : null;
  const side: "over" | "under" = over ? "over" : "under";
  // zapis sprzed meczu: pokazujemy tylko mecze rozegrane przed tym zakładem
  const bars = (pa?.games ?? []).filter((g) => g.min > 0 && (!archived || Date.parse(g.date) < Date.parse(b.tipoff) - 3600_000)).map((g) => ({
    key: g.game_id,
    value: statOf(g, b.market as PlayerMarket),
    opp: pa?.teams[g.opp_id]?.abbr ?? "",
    logo: pa?.teams[g.opp_id]?.logo,
    date: shortDate(g.date),
    home: !!g.home,
    min: Math.round(g.min),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {archived && (
        <Notice tone="neutral">
          Mecz już się rozpoczął — to <b>zapis analizy sprzed meczu</b> (stan z {new Date(archived.savedAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short" })}).
          Wynik na żywo i rozliczenie znajdziesz w zakładce <Link href="/kupony#wyniki" className="text-accent">Kupony i wyniki</Link>.
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/value-bets" className="text-sm text-accent">← Wszystkie propozycje</Link>
        {b.kind === "player" && !archived && (
          <Link href={`/historia/${encodeURIComponent(b.id)}`} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-black hover:opacity-90">Historia typu — grafiki ▶</Link>
        )}
      </div>

      {/* nagłówek */}
      <header className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${cat.cls}`}>{cat.label}</span>
          <span className="text-xs text-ink-3">{b.gameLabel} · {tipTime(b.tipoff)}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {pa?.headshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pa.headshot} alt={b.subjectName} width={130} height={95} className="h-20 w-28 shrink-0 rounded-2xl bg-surface-2 object-cover object-top sm:h-24 sm:w-32" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-black leading-tight sm:text-3xl">{n.headline}</h1>
            <div className="mt-1 text-sm text-ink-3">
              {b.kind === "player" ? <Link className="hover:text-accent" href={`/players/${b.subjectId}?market=${b.market}&line=${b.line ?? ""}`}>{b.subjectName}</Link> : b.subjectName}
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm font-bold">
              <TeamLogo src={team?.logo} abbr={b.teamAbbr} size={28} />
              <span>{b.teamAbbr}</span>
              <span className="text-ink-3">{s?.matchup.home ? "vs" : "@"}</span>
              <TeamLogo src={opp?.logo} abbr={b.oppAbbr} size={28} />
              <span>{b.oppAbbr}</span>
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

      {bars.length > 0 && (
        <ChartCard title={`${b.marketLabel} mecz po meczu`} sub="Najedź na słupek, żeby zobaczyć datę, rywala i minuty.">
          <GameBarsPanel games={bars} line={b.line} side={side} statLabel={b.marketLabel} vsOpp={b.oppAbbr} />
        </ChartCard>
      )}

      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Jak może się skończyć ten mecz?" sub="Rozkład wyników z 8 000 symulacji modelu (przed kalibracją). Zielone = zakład wchodzi.">
            <OutcomeHistogram bins={s.hist ?? []} line={b.line} over={over} projection={s.explain?.projection ?? b.projection?.mean ?? null} />
            <p className="mt-2 text-[11px] text-ink-3">
              Surowe symulacje dają {Math.round(b.rawProb * 100)}%, ale ostateczna szansa ({Math.round(b.modelProb * 100)}%) jest skalibrowana: łączy model z rynkiem według tego, jak oba sprawdzały się w backteście. Surowy model bywa zbyt pewny siebie.
            </p>
          </ChartCard>
          {s.explain && (
            <ChartCard title="Skąd ta projekcja?" sub={s.explain.headline}>
              <Waterfall start={s.explain.start} end={s.explain.projection} line={b.line} over={over}
                steps={s.explain.steps.filter((x) => x.key !== "base").map((x) => ({ label: x.label, delta: x.delta, text: x.text }))} />
            </ChartCard>
          )}
        </div>
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
            <LineBarChart height={200} line={Math.round(s.minutes.projected * 10) / 10}
              data={bars.slice(-10).map((g) => ({ key: g.key, value: g.min, label: g.opp, logo: g.logo, tooltip: [`${g.home ? "vs" : "@"} ${g.opp} · ${g.date}`, `${g.min} min (model: ${s.minutes.projected.toFixed(1)})`] }))} />
          </ChartCard>
        )}

        {s && s.vsOpp.length > 0 && (
          <ChartCard title={`Mecze z ${b.oppAbbr}`} sub="Ten i poprzedni sezon (tylko w obecnej drużynie). Najedź na słupek — zobaczysz minuty.">
            <LineBarChart height={200} line={b.line} side={side}
              data={s.vsOpp.map((v, i) => ({
                key: `${v.date}-${i}`, value: v.value, label: shortDate(v.date), dim: v.otherRole,
                tooltip: [
                  `vs ${b.oppAbbr} · ${shortDate(v.date)} (${v.season === "ten" ? "ten sezon" : "poprzedni sezon"})`,
                  `${b.marketLabel}: ${v.value} (${v.hit ? "trafione" : "nietrafione"})`,
                  v.min !== undefined ? `${v.min} min (teraz model zakłada ok. ${Math.round(s.minutes.projected)} min)` : "",
                  v.otherRole ? "Inna rola (inne minuty) — nie liczy się do bilansu" : "",
                ].filter(Boolean),
              }))} />
            {(s.vsOpp.some((v) => v.otherRole) || (s.vsOppOtherTeam ?? 0) > 0) && (
              <p className="mt-2 text-[11px] text-ink-3">
                {s.vsOpp.some((v) => v.otherRole) && "Przygaszone słupki: mecze przy wyraźnie innych minutach niż teraz (inna rola) — nie liczą się do bilansu. "}
                {(s.vsOppOtherTeam ?? 0) > 0 && `Pominięto ${s.vsOppOtherTeam} mecz(e) z poprzedniego sezonu, gdy grał w innej drużynie.`}
              </p>
            )}
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

        {s && (() => {
          const d = s.likelyDefender && s.likelyDefender.stl36 !== undefined ? s.likelyDefender : null;
          const di = d ? defenderImpact(d, b.market, b.side) : null;
          const missing = (s.oppMissing ?? []).filter((m) => m.effect !== null && Math.abs(m.effect - 1) >= 0.02);
          if (!di && !missing.length) return null;
          const idxTone = (x: number): Tone => (x >= 1.25 ? "neg" : x <= 0.8 ? "pos" : "warn");
          return (
            <ChartCard title={`Obrona ${b.oppAbbr}`} sub="Krycie 1 na 1 nie jest publiczne — prawdopodobny obrońca to gracz rywala z najwięcej minut na tej samej pozycji.">
              {d && di && (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{d.name}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${di.tone === "pos" ? "bg-pos-soft text-pos" : di.tone === "neg" ? "bg-neg-soft text-neg" : "bg-surface-2 text-ink-2"}`}>{di.verdict}</span>
                    <span className="text-xs text-ink-3">{d.min.toFixed(1)} min / mecz</span>
                  </div>
                  <div className="mt-2">
                    <HBars max={2} format={(v) => `${v >= 1 ? "+" : "−"}${Math.round(Math.abs(v - 1) * 100)}%`}
                      items={[
                        { label: `Przechwyty (${d.stl36.toFixed(1)}/36 min)`, value: d.stlIdx, tone: idxTone(d.stlIdx) },
                        { label: `Bloki (${d.blk36.toFixed(1)}/36 min)`, value: d.blkIdx, tone: idxTone(d.blkIdx) },
                      ]} />
                    <p className="mt-1 text-[11px] text-ink-3">Względem średniej ligi dla tej pozycji (środek paska = średnio).</p>
                  </div>
                  <p className={`mt-2 text-sm ${toneText[di.tone]}`}>{di.text}</p>
                </div>
              )}
              {missing.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-ink-2">
                  {missing.map((m) => {
                    const t: Tone = (m.effect! > 1) === over ? "pos" : "neg";
                    return (
                      <li key={m.name}>
                        <b>{m.name}</b> ({m.status}) nie zagra — <span className={toneText[t]}>w {m.nWithout} meczach bez niego rywale tej pozycji zdobywali {m.effect! >= 1 ? "+" : "−"}{Math.abs((m.effect! - 1) * 100).toFixed(0)}% na minutę</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ChartCard>
          );
        })()}
      </div>

      <p className="text-xs text-ink-3">
        <Term k="prob">Szansa</Term> to skalibrowane prawdopodobieństwo modelu sprawdzone w backteście. Żaden typ nie jest pewny — nawet przy 60% co czwarty–piąty kupon z trzech nóg przegrywa.
      </p>
    </div>
  );
}
