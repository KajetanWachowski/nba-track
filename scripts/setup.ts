/**
 * Pierwsze przygotowanie danych: pobiera mecze sezonu (ESPN) i uczy/testuje model (backtest).
 *   npm run setup
 * Można uruchomić ponownie w każdej chwili — pobiera tylko brakujące mecze.
 */
import { runBacktest } from "../lib/backtest";
import { setMeta } from "../lib/db";
import { syncSeason } from "../lib/sync";

const t0 = Date.now();
const min = () => `${((Date.now() - t0) / 60000).toFixed(1)} min`;
console.log("NBA EDGE — przygotowanie danych\n");
console.log("1/2  Pobieram mecze, statystyki i kursy z ESPN (pierwszy raz kilka–kilkanaście minut)…");
setMeta("setup:status", { phase: "sync", at: Date.now() });
const s = await syncSeason({ log: (l) => process.stdout.write(`     ${l}\n`) });
console.log(`     ✓ gotowe (${min()}) — mecze z protokołami: ${s.boxScores}, linie zawodników: ${s.propLines}${s.errors.length ? `, ostrzeżenia: ${s.errors.length}` : ""}\n`);
console.log("2/2  Testuję model na rozegranych meczach i kalibruję prawdopodobieństwa (backtest)…");
setMeta("setup:status", { phase: "backtest", at: Date.now() });
const b = await runBacktest({ tune: false, log: () => undefined });
setMeta("setup:status", { phase: "done", at: Date.now() });
console.log(`     ✓ gotowe (${min()}) — sprawdzone linie: ${b.rows.test}, model ${b.metrics.player.logLossCal < b.metrics.player.logLossMarket ? "lepszy" : "nie lepszy"} od rynku na zakładach zawodników.\n`);
console.log("Wszystko gotowe. Uruchom aplikację:  npm run app   (albo npm start, jeśli zbudowana)");
