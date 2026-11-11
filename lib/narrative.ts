/**
 * „Dlaczego ten typ” — opis zakładu w stylu analizy typera: rola i minuty, forma, matchup, skład, kurs,
 * główne ryzyko i liczby pokrycia linii. Wszystko wyłącznie z danych modelu i statystyk (nic nie jest dopisywane).
 */
import type { BetEval } from "./engine";

export type Tone = "pos" | "neg" | "warn" | "neutral";
export interface NarrativeBlock {
  title: string;
  tone: Tone;
  lines: string[];
}
export interface Narrative {
  headline: string;
  blocks: NarrativeBlock[];
  coverage: { label: string; value: string; tone: Tone }[];
  verdict: { text: string; tone: Tone };
}

const f1 = (x: number | null | undefined) => (x !== null && x !== undefined && Number.isFinite(x) ? x.toFixed(1).replace(".", ",") : "—");
const pc = (x: number) => `${Math.round(x * 100)}%`;
const lineStr = (x: number | null) => (x === null ? "" : String(x).replace(".", ","));

const NOUN: Record<string, string> = {
  pts: "punktów", reb: "zbiórek", ast: "asyst", fg3m: "trafionych trójek", stl: "przechwytów", blk: "bloków", tov: "strat",
  pra: "pkt+zb+as", pr: "pkt+zb", pa: "pkt+as", ra: "zb+as", stocks: "przechwytów+bloków", dd: "double-double", td: "triple-double",
};

/** ton oceny trafień: zielony ≥ 60%, pomarańczowy 45–60%, czerwony < 45% */
export const rateTone = (hits: number, n: number): Tone => (!n ? "neutral" : hits / n >= 0.6 ? "pos" : hits / n >= 0.45 ? "warn" : "neg");

export function buildNarrative(b: BetEval): Narrative {
  const a = b.assessment;
  const s = a.stats;
  const over = b.side === "over" || b.side === "yes";
  const sideWord = over ? "powyżej" : "poniżej";
  const noun = NOUN[b.market] ?? b.marketLabel.toLowerCase();
  const headline = b.kind === "player"
    ? `${b.subjectName} ${b.line !== null ? `${sideWord} ${lineStr(b.line)} ${noun}` : b.selection}`
    : `${b.subjectName}: ${b.selection}`;
  const blocks: NarrativeBlock[] = [];

  if (s) {
    // 1. rola i minuty
    const dMin = s.minutes.l5 - s.minutes.season;
    const role: string[] = [
      `Średnio ${f1(s.minutes.season)} min w sezonie, ${f1(s.minutes.l5)} min w ostatnich 5 meczach. Model zakłada ${f1(s.minutes.projected)} min (±${f1(s.minutes.sd)}).`,
    ];
    if (s.per36?.season !== null && s.per36?.season !== undefined)
      role.push(`Na 36 minut: ${f1(s.per36.l5)} ${noun} ostatnio vs ${f1(s.per36.season)} w sezonie.`);
    if (s.context.roleChange) role.push(s.context.roleChange);
    if (b.market === "fg3m" || b.market === "pts")
      role.push(`Rzuty za 3: ${f1(s.shooting.fg3aL5)} prób ostatnio vs ${f1(s.shooting.fg3aSeason)} w sezonie${s.shooting.fg3PctSeason !== null ? ` (skuteczność sezonu ${pc(s.shooting.fg3PctSeason)})` : ""}.`);
    const minTone: Tone = Math.abs(dMin) < 2 ? "neutral" : (dMin > 0) === over ? "pos" : "neg";
    blocks.push({ title: "Rola i minuty", tone: minTone, lines: role });

    // 2. forma
    const l5 = s.windows.find((w) => w.label === "Ostatnie 5");
    const l10 = s.windows.find((w) => w.label === "Ostatnie 10");
    const form: string[] = [];
    if (s.recent.length) form.push(`Ostatnie wyniki: ${s.recent.slice(-5).map((r) => `${r.value} (${r.opp})`).join(", ")}.`);
    if (l5) form.push(`${l5.hits}/${l5.n} ostatnich meczów ${sideWord} linii ${lineStr(b.line)}, średnia ${f1(l5.avg)}.`);
    if (l10) form.push(`W 10 ostatnich: ${l10.hits}/${l10.n}, średnia ${f1(l10.avg)}, mediana sezonu ${f1(s.median)}.`);
    form.push(`Regularność: ${s.consistency} (odchylenie ${f1(s.sd)}).`);
    blocks.push({ title: "Forma", tone: l10 ? rateTone(l10.hits, l10.n) : "neutral", lines: form });

    // 3. matchup
    const m = s.matchup;
    const mu: string[] = [];
    if (s.explain?.opponent.length) mu.push(...s.explain.opponent);
    else if (m.oppDrtgRank) mu.push(`${m.opp}: ${m.oppDrtgRank}. obrona ligi (1 = najlepsza).`);
    if (s.likelyDefender) {
      const d = s.likelyDefender;
      mu.push(`Prawdopodobny bezpośredni rywal: ${d.name} (${f1(d.min)} min, ${f1(d.stl)} przechwytu i ${f1(d.blk)} bloku na mecz) — najwięcej minut u ${m.opp} na tej samej pozycji. To przybliżenie: publiczne dane nie mówią, kto kogo kryje 1 na 1.`);
    }
    const sf = m.statFactor;
    const muTone: Tone = Math.abs(sf - 1) < 0.03 ? "neutral" : (sf > 1) === over ? "pos" : "neg";
    if (mu.length) blocks.push({ title: `Matchup z ${m.opp}`, tone: muTone, lines: mu });

    // 4. skład
    const sk: string[] = [];
    for (const t of s.context.teammatesOut) sk.push(`Brak w drużynie: ${t}.`);
    let skTone: Tone = "neutral";
    for (const om of s.oppMissing ?? []) {
      if (om.effect === null) {
        sk.push(`${m.opp} bez ${om.name} (${om.status}) — za mało meczów bez niego, żeby to policzyć.`);
        continue;
      }
      const more = om.effect > 1;
      sk.push(`${m.opp} bez ${om.name} (${om.status}, ${f1(om.min)} min${om.samePos ? ", ta sama pozycja" : ""}): w ${om.nWithout} meczach bez niego rywale tej pozycji zdobywali ${more ? "więcej" : "mniej"} (${more ? "+" : "−"}${Math.abs((om.effect - 1) * 100).toFixed(0)}% na minutę) — gra rezerwowy.`);
      if (Math.abs(om.effect - 1) >= 0.03) skTone = more === over ? "pos" : "neg";
    }
    if (s.context.selfStatus) sk.push(`Status zawodnika: ${s.context.selfStatus}.`);
    if (sk.length) blocks.push({ title: "Skład i kontuzje", tone: skTone, lines: sk });

    // 5. projekcja
    if (s.explain) {
      const p = s.explain;
      const top = [...p.steps].filter((x) => x.key !== "base").sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3);
      const lines = [p.headline, ...top.map((x) => `${x.label}: ${x.delta >= 0 ? "+" : "−"}${f1(Math.abs(x.delta))} — ${x.text}`)];
      const gap = b.line !== null ? (p.projection - b.line) * (over ? 1 : -1) : 0;
      blocks.push({ title: "Projekcja modelu", tone: gap > 0.5 ? "pos" : gap < -0.5 ? "neg" : "warn", lines });
    }
  }

  // 6. kurs
  const kurs: string[] = [`Kurs ${b.price.toFixed(2)} (${b.book}${b.playable ? "" : " — tylko orientacyjnie, nie do zagrania w Polsce"}). Uczciwy kurs wg modelu: ${b.fairOdds.toFixed(2)}.`];
  kurs.push(`Szansa wg modelu ${pc(b.modelProb)} (zakres ${pc(b.pLow)}–${pc(b.pHigh)}), kurs zakłada ${pc(b.impliedProb)}${b.marketProb !== null ? `, rynek bez marży ${pc(b.marketProb)}` : ""}.`);
  kurs.push(`EV ${b.ev >= 0 ? "+" : ""}${(b.ev * 100).toFixed(1)}% — ${b.ev >= 0.02 ? "kurs jest wyższy, niż powinien" : b.ev >= 0 ? "kurs mniej więcej uczciwy" : "kurs za niski względem szans"}.`);
  blocks.push({ title: "Kurs i opłacalność", tone: b.ev >= 0.02 ? "pos" : b.ev >= -0.02 ? "warn" : "neg", lines: kurs });

  // 7. główne ryzyko
  const order = { krytyczne: 0, istotne: 1, drobne: 2 } as const;
  const risks = [...a.risks].sort((x, y) => order[x.severity] - order[y.severity]);
  blocks.push({
    title: "Główne ryzyko",
    tone: risks[0] ? (risks[0].severity === "drobne" ? "warn" : "neg") : "pos",
    lines: risks.length ? risks.slice(0, 3).map((r) => `${r.text} (${r.severity})`) : ["Model nie znalazł istotnych argumentów przeciw."],
  });

  // liczby pokrycia
  const coverage: Narrative["coverage"] = [];
  if (s) {
    for (const w of s.windows) coverage.push({ label: w.label, value: `${w.hits}/${w.n}`, tone: rateTone(w.hits, w.n) });
    if (s.vsOpp.length) {
      const h = s.vsOpp.filter((v) => v.hit).length;
      coverage.push({ label: `Vs ${b.oppAbbr}`, value: `${h}/${s.vsOpp.length}`, tone: rateTone(h, s.vsOpp.length) });
    }
    const ha = s.matchup.home ? s.homeAway.home : s.homeAway.away;
    if (ha.n) coverage.push({ label: s.matchup.home ? "U siebie" : "Na wyjeździe", value: `${ha.hits}/${ha.n}`, tone: rateTone(ha.hits, ha.n) });
  }

  const verdict: Narrative["verdict"] =
    a.category === "najlepsze" ? { text: "Werdykt: mocny typ — wysoka szansa, wiarygodne dane i dobry kurs.", tone: "pos" }
    : a.category === "dobre" ? { text: "Werdykt: dobry typ, ale z mniejszym zapasem — rozważ mniejszą stawkę.", tone: "pos" }
    : a.category === "obserwuj" ? { text: `Werdykt: do obserwacji. ${a.categoryReasons[0] ?? "Blisko progu."} Sprawdź skład i kurs tuż przed meczem.`, tone: "warn" }
    : { text: `Werdykt: odpuść. ${a.categoryReasons[0] ?? ""}`.trim(), tone: "neg" };

  return { headline, blocks, coverage, verdict };
}
