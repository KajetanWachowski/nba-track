/**
 * Jak prawdopodobny bezpośredni obrońca może wpłynąć na zakład. Krycie 1 na 1 nie jest publiczne, więc oceniamy
 * obrońcę po jego aktywności w obronie (przechwyty i bloki na 36 minut) względem średniej ligi dla tej pozycji.
 * To informacja pomocnicza — nie zmienia projekcji modelu (nie dało się jej sprawdzić w backteście).
 */
import type { PlayerProjection } from "./model/player";

export type DefenderInfo = NonNullable<PlayerProjection["likelyDefender"]>;
export interface DefenderImpact {
  tone: "pos" | "neg" | "neutral";
  verdict: string;
  text: string;
}

const SCORING = new Set(["pts", "fg3m", "pra", "pr", "pa"]);

export function defenderImpact(d: DefenderInfo, market: string, side: string): DefenderImpact | null {
  const over = side !== "under";
  const pct = (x: number) => `${x >= 1 ? "+" : "−"}${Math.round(Math.abs(x - 1) * 100)}%`;
  const act = `${d.stl36.toFixed(1)} przechwytu i ${d.blk36.toFixed(1)} bloku na 36 min (${pct(d.stlIdx)} i ${pct(d.blkIdx)} vs średnia ligi na tej pozycji)`;
  const label = d.rating === "mocny" ? "Mocny obrońca" : d.rating === "słaby" ? "Słaby obrońca" : "Przeciętny obrońca";
  let effect = 0; // > 0 pomaga wynikowi „powyżej”, < 0 przeszkadza
  let why = "";
  if (SCORING.has(market)) {
    effect = d.rating === "mocny" ? -1 : d.rating === "słaby" ? 1 : 0;
    why = d.rating === "mocny" ? "może utrudnić zdobywanie punktów" : d.rating === "słaby" ? "nie powinien mocno przeszkadzać w zdobywaniu punktów" : "nie powinien wyraźnie zmienić liczby punktów";
  } else if (market === "tov") {
    effect = d.stlIdx >= 1.25 ? 1 : d.stlIdx <= 0.8 ? -1 : 0;
    why = d.stlIdx >= 1.25 ? "często przechwytuje — więcej okazji do strat" : d.stlIdx <= 0.8 ? "rzadko przechwytuje — mniej strat" : "przeciętnie przechwytuje";
  } else if (market === "ast") {
    effect = d.stlIdx >= 1.25 ? -1 : 0;
    why = d.stlIdx >= 1.25 ? "czyta linie podań — może zabrać część asyst" : "nie powinien wyraźnie zmienić liczby asyst";
  } else {
    why = "na tę statystykę bezpośredni obrońca ma niewielki wpływ";
  }
  const helps = effect === 0 ? null : (effect > 0) === over;
  return {
    tone: helps === null ? "neutral" : helps ? "pos" : "neg",
    verdict: label,
    text: `${d.name}: ${act} — ${why}. Wpływ raczej mały i nie zmienia projekcji (dane o kryciu 1 na 1 nie są publiczne).`,
  };
}
