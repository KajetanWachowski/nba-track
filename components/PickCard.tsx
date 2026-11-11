"use client";
import Link from "next/link";
import { useState } from "react";
import type { Category, Severity } from "@/lib/assess";
import type { BetEval } from "@/lib/engine";
import { ago, dateTime, dec, num, pct, pp, signedPct, tipTime } from "@/lib/format";
import { ProjectionExplain } from "./ProjectionExplain";
import { Term } from "./Term";

export const CATEGORY: Record<Category, { label: string; cls: string; dot: string }> = {
  najlepsze: { label: "Najlepsza propozycja", cls: "bg-pos text-black", dot: "bg-pos" },
  dobre: { label: "Dobra propozycja", cls: "bg-pos-soft text-pos", dot: "bg-pos" },
  obserwuj: { label: "Warta obserwacji", cls: "bg-warn-soft text-warn", dot: "bg-warn" },
  odrzucone: { label: "Odrzucona przez model", cls: "bg-neg-soft text-neg", dot: "bg-neg" },
};

const SEV: Record<Severity, { label: string; cls: string }> = {
  krytyczne: { label: "krytyczne", cls: "bg-neg text-black" },
  istotne: { label: "istotne", cls: "bg-neg-soft text-neg" },
  drobne: { label: "drobne", cls: "bg-surface-2 text-ink-3" },
};

function Mini({ values, line }: { values: { value: number; hit: boolean; opp: string; date: string }[]; line: number | null }) {
  const W = 150, H = 36;
  const max = Math.max(1, line ?? 0, ...values.map((v) => v.value)) * 1.1;
  const slot = W / Math.max(1, values.length);
  const y = (v: number) => H - (v / max) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-[150px]" role="img" aria-label={`Ostatnie ${values.length} wyników: ${values.map((v) => v.value).join(", ")}`}>
      {values.map((v, i) => (
        <rect key={i} x={i * slot + 1} y={y(v.value)} width={Math.max(2, slot - 2)} height={Math.max(1, H - y(v.value))} rx={2} fill={v.hit ? "var(--pos)" : "var(--muted-bar)"}>
          <title>{`${v.opp}: ${v.value}`}</title>
        </rect>
      ))}
      {line !== null && <line x1={0} x2={W} y1={y(line)} y2={y(line)} stroke="var(--ink-2)" strokeDasharray="3 3" strokeWidth={1.5} />}
    </svg>
  );
}

function Score({ k, label, value, sub, tone }: { k: string; label: string; value: string; sub: string; tone: "pos" | "warn" | "neg" }) {
  const c = tone === "pos" ? "text-pos" : tone === "warn" ? "text-warn" : "text-neg";
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-3 py-2">
      <div className="label flex items-start justify-between gap-1 text-[10px] leading-tight tracking-[0.02em]"><span className="min-w-0">{label}</span><Term k={k}>{""}</Term></div>
      <div className={`num text-lg font-black ${c}`}>{value}</div>
      <div className="truncate text-[11px] text-ink-3">{sub}</div>
    </div>
  );
}

function Section({ title, count, children, defaultOpen = false, tone }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; tone?: "neg" | "pos" }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold hover:bg-surface-2">
        <span className={tone === "neg" ? "text-neg" : tone === "pos" ? "text-pos" : ""}>
          {title}{count !== undefined && <span className="ml-1.5 text-xs font-normal text-ink-3">({count})</span>}
        </span>
        <span aria-hidden className="text-ink-3">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-4 pb-4 text-sm">{children}</div>}
    </div>
  );
}

export function PickCard({ b }: { b: BetEval }) {
  const a = b.assessment;
  const cat = CATEGORY[a.category];
  const s = a.stats;
  const probTone = a.probability.value >= 0.58 ? "pos" : a.probability.value >= 0.5 ? "warn" : "neg";
  const qTone = a.quality.score >= 75 ? "pos" : a.quality.score >= 55 ? "warn" : "neg";
  const vTone = a.value.ev >= 0.02 ? "pos" : a.value.ev >= -0.02 ? "warn" : "neg";
  const season = s?.windows.find((w) => w.label === "Sezon");
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${cat.cls}`}>{cat.label}</span>
          <span className="text-xs text-ink-3">{b.gameLabel} · {tipTime(b.tipoff)}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-black leading-tight">
              {b.kind === "player" ? <Link href={`/players/${b.subjectId}?market=${b.market}&line=${b.line ?? ""}`} className="hover:text-accent">{b.subjectName}</Link> : b.subjectName}
            </h3>
            <div className="text-sm text-ink-3">{b.kind === "player" ? `${b.teamAbbr} vs ${b.oppAbbr}` : "Linia meczowa"}</div>
            <div className="mt-1 font-semibold">{b.selection}</div>
          </div>
          <div className="text-right">
            <div className="num text-3xl font-black">{dec(b.price)}</div>
            <div className="text-xs text-ink-3">
              {b.playable ? (
                <>{b.book}{b.priceManual ? " · wpisany ręcznie" : ""}{b.taxed ? " · po podatku" : ""}</>
              ) : (
                <span className="text-warn"><Term k="reference">{b.book} — tylko orientacyjnie</Term></span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Score k="prob" label="Szansa" value={pct(a.probability.value, 0)} sub={`${pct(a.probability.low, 0)}–${pct(a.probability.high, 0)}`} tone={probTone} />
          <Score k="quality" label="Jakość danych" value={`${a.quality.score}`} sub={a.quality.level} tone={qTone} />
          <Score k="value" label="Opłacalność" value={signedPct(a.value.ev, 1)} sub={`EV · ${a.value.label}`} tone={vTone} />
        </div>

        {s && (
          <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
            <div>
              <div className="label text-[10px]">Ostatnie 10 meczów</div>
              <Mini values={s.recent} line={b.line} />
              <div className="num text-[11px] text-ink-3">{s.recent.map((r) => r.value).join(" · ")}</div>
            </div>
            <div className="num text-sm">
              <div className="label text-[10px]">Średnia sezonu</div>
              <div className="text-lg font-bold">{num(season?.avg)}</div>
              <div className="text-[11px] text-ink-3"><Term k="hitrate">{season ? `${season.hits}/${season.n} po stronie zakładu` : ""}</Term></div>
            </div>
          </div>
        )}
        <p className="mt-3 text-sm text-ink-2">{a.summary}</p>
        {a.category !== "najlepsze" && a.categoryReasons.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-ink-3">{a.categoryReasons.map((r) => <li key={r}>• {r}</li>)}</ul>
        )}
      </div>

      <Section title="Dlaczego model poleca ten zakład?" count={a.pros.length} tone="pos">
        {a.pros.length ? <ul className="space-y-1 text-ink-2">{a.pros.map((p) => <li key={p}>✓ {p}</li>)}</ul> : <p className="text-ink-3">Brak wyraźnych argumentów za — poza samym prawdopodobieństwem.</p>}
      </Section>

      <Section title="Co przemawia przeciwko zakładowi?" count={a.risks.length} tone="neg" defaultOpen={a.risks.some((r) => r.severity !== "drobne")}>
        {a.risks.length ? (
          <ul className="space-y-1.5">
            {a.risks.map((r) => (
              <li key={r.text} className="flex gap-2 text-ink-2">
                <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEV[r.severity].cls}`}>{SEV[r.severity].label}</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-ink-3">Model nie znalazł istotnych argumentów przeciw.</p>}
      </Section>

      <Section title="Szczegółowa analiza statystyczna">
        <Details b={b} />
      </Section>

      <Section title="Porównanie kursów u bukmacherów" count={b.offers.length}>
        <OddsCompare b={b} />
      </Section>
    </article>
  );
}

function Row({ k, v, term }: { k: string; v: React.ReactNode; term?: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-ink-3">{term ? <Term k={term}>{k}</Term> : k}</span>
      <span className="num text-right font-semibold">{v}</span>
    </div>
  );
}

function Details({ b }: { b: BetEval }) {
  const a = b.assessment;
  const s = a.stats;
  return (
    <div className="space-y-5">
    {s?.explain && (
      <div>
        <div className="label mb-2">Skąd ta projekcja?</div>
        <ProjectionExplain e={s.explain} line={b.line} unit={b.marketLabel.toLowerCase()} />
      </div>
    )}
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <div className="label mb-1">Model</div>
        <Row k="Prawdopodobieństwo modelu (po kalibracji)" v={pct(b.modelProb, 1)} term="prob" />
        <Row k="Surowy model (przed kalibracją)" v={pct(b.rawProb, 1)} term="calibration" />
        <Row k="Rynek bez marży" v={pct(b.marketProb, 1)} term="novig" />
        <Row k="Prawdopodobieństwo z kursu" v={pct(b.impliedProb, 1)} term="implied" />
        <Row k="Przewaga (EDGE)" v={pp(b.edge)} term="edge" />
        <Row k="Kurs sprawiedliwy" v={dec(b.fairOdds)} term="fair" />
        <Row k="¼ Kelly" v={pct(b.kellyQuarter, 1)} term="kelly" />
        {b.projection && <Row k="Projekcja (80% wyników)" v={`${num(b.projection.mean)} (${num(b.projection.p10, 0)}–${num(b.projection.p90, 0)})`} />}
        <p className="mt-1 text-[11px] text-ink-3">Rynek: {b.marketProbSource}.</p>
        <div className="label mb-1 mt-4">Jakość danych: {a.quality.score}/100</div>
        {a.quality.factors.length ? (
          <ul className="space-y-0.5 text-xs text-ink-2">{a.quality.factors.map((f) => <li key={f.text}>{f.delta ? `${f.delta} ` : ""}{f.text}</li>)}</ul>
        ) : <p className="text-xs text-ink-3">Bez zastrzeżeń.</p>}
      </div>
      {s ? (
        <div>
          <div className="label mb-1">Forma</div>
          <div className="overflow-x-auto">
            <table className="num w-full text-xs">
              <thead><tr className="text-left text-ink-3"><th className="py-1">Okres</th><th>Mecze</th><th>Średnia</th><th><Term k="hitrate">Linia</Term></th></tr></thead>
              <tbody>
                {s.windows.map((w) => (
                  <tr key={w.label} className="border-t border-line"><td className="py-1">{w.label}</td><td>{w.n}</td><td>{num(w.avg)}</td><td>{w.n ? `${w.hits}/${w.n} (${pct(w.hitRate, 0)})` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Row k="Mediana" v={num(s.median)} term="median" />
          <Row k="Odchylenie standardowe" v={num(s.sd)} term="sd" />
          <Row k="Trend (na mecz, 10 meczów)" v={`${s.trendPerGame >= 0 ? "+" : ""}${num(s.trendPerGame, 2)}`} term="trend" />
          <Row k="Regularność" v={s.consistency} />
          <div className="label mb-1 mt-4">Rola i minuty</div>
          <Row k="Minuty: 5 meczów / sezon" v={`${num(s.minutes.l5)} / ${num(s.minutes.season)}`} />
          <Row k="Minuty w projekcji" v={`${num(s.minutes.projected)} ± ${num(s.minutes.sd)}`} />
          <Row k="Usage: 5 meczów / sezon" v={`${num(s.usage.l5)}% / ${num(s.usage.season)}%`} term="usage" />
          <Row k="Rzuty z gry: 5 meczów / sezon" v={`${num(s.shooting.fgaL5)} / ${num(s.shooting.fgaSeason)} (${pct(s.shooting.fgPctSeason)} celnych)`} />
          <Row k="Próby za 3: 5 meczów / sezon" v={`${num(s.shooting.fg3aL5)} / ${num(s.shooting.fg3aSeason)}`} />
          <Row k="Skuteczność za 3: 5 meczów / sezon" v={`${pct(s.shooting.fg3PctL5)} / ${pct(s.shooting.fg3PctSeason)}`} />
          {s.context.roleChange && <p className="mt-1 text-xs text-warn">{s.context.roleChange}</p>}
          <div className="label mb-1 mt-4">Rywal i kontekst</div>
          <Row k={`Obrona ${s.matchup.opp}`} v={s.matchup.oppDrtg ? `${num(s.matchup.oppDrtg)} (#${s.matchup.oppDrtgRank} w lidze)` : "—"} term="drtg" />
          <Row k="Obrona vs ta pozycja (na posiadanie)" v={signedPct(s.matchup.statFactor - 1, 0)} />
          <Row k={`Skuteczność za 3 rywali ${s.matchup.opp}`} v={pct(s.matchup.opp3PctAllowed, 1)} />
          <Row k="Tempo: rywal / przewidywane w meczu" v={`${num(s.matchup.oppPace)} / ${num(s.matchup.gamePace)}`} term="pace" />
          <Row k="Gospodarz / gość" v={s.matchup.home ? "u siebie" : "na wyjeździe"} />
          <Row k="Dni odpoczynku" v={s.matchup.restDays === null ? "—" : s.matchup.restDays === 0 ? "0 (back-to-back)" : s.matchup.restDays} term="b2b" />
          <Row k="Ryzyko blowoutu (≥20 pkt)" v={pct(s.context.blowoutProb, 0)} term="blowout" />
          <Row k="Status zawodnika" v={s.context.selfStatus ?? "brak zgłoszeń"} />
          {s.context.teammatesOut.length > 0 && <Row k="Nieobecni / niepewni koledzy" v={s.context.teammatesOut.join(", ")} />}
        </div>
      ) : (
        <div className="text-ink-3">Linia meczowa — szczegóły drużyn na stronie meczu. <Link className="text-accent" href={`/games/${b.gameId}`}>Otwórz mecz →</Link></div>
      )}
    </div>
    </div>
  );
}

function OddsCompare({ b }: { b: BetEval }) {
  const pl = b.offers.filter((o) => o.polish);
  const us = b.offers.filter((o) => !o.polish);
  const sb = pl.find((o) => o.bookKey === "superbet");
  const best = [...pl].sort((x, y) => y.eff - x.eff)[0];
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[460px] text-sm">
          <thead><tr className="label text-left"><th className="py-1">Bukmacher</th><th>Kurs</th><th>vs Superbet</th><th>Źródło</th><th>Aktualizacja</th></tr></thead>
          <tbody>
            {pl.length === 0 && <tr><td colSpan={5} className="py-2 text-warn">Brak kursów polskich bukmacherów dla tego zakładu. <Link className="underline" href="/pl-odds">Wpisz kurs Superbet →</Link></td></tr>}
            {pl.map((o) => (
              <tr key={o.bookKey} className="border-t border-line">
                <td className="py-1.5 font-semibold">{o.book}{o === best && pl.length > 1 && <span className="ml-1.5 rounded bg-pos-soft px-1 text-[10px] text-pos">najlepszy w PL</span>}</td>
                <td className={o === best ? "font-bold text-pos" : ""}>{dec(o.dec)}{o.eff !== o.dec && <span className="block text-[10px] text-ink-3">po podatku {dec(o.eff)}</span>}</td>
                <td>{sb && o !== sb ? signedPct(o.eff / sb.eff - 1, 1) : o === sb ? "—" : ""}</td>
                <td className={o.source === "manual" ? "text-warn" : "text-ink-3"}>{o.source === "manual" ? <Term k="manual">wpisany ręcznie</Term> : "API"}</td>
                <td className="text-ink-3" title={dateTime(o.seenAt)}>{ago(o.seenAt)}</td>
              </tr>
            ))}
            {us.map((o) => (
              <tr key={o.bookKey} className="border-t border-line text-ink-3">
                <td className="py-1.5"><Term k="reference">{o.book} (USA)</Term></td>
                <td>{dec(o.dec)}</td>
                <td>{sb ? signedPct(o.dec / sb.eff - 1, 1) : ""}</td>
                <td>tylko porównanie</td>
                <td title={dateTime(o.seenAt)}>{ago(o.seenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Kurs użyty do EV: <b className="text-ink">{dec(b.price)} ({b.book})</b>
        {b.priceSource === "superbet" ? " — Superbet jest głównym źródłem." : b.priceSource === "polski" ? " — najlepszy polski kurs (brak Superbet)." : " — kurs USA, wyłącznie orientacyjnie: nie da się go zagrać w Polsce."}
        {b.bestPl && b.superbetPrice && b.bestPl.price > b.superbetPrice && ` U ${b.bestPl.book} kurs ${dec(b.bestPl.price)} daje EV ${signedPct(b.bestPl.ev, 1)}.`}
        {b.priceSeenAt && ` Aktualizacja: ${dateTime(b.priceSeenAt)}.`}
      </p>
    </div>
  );
}
