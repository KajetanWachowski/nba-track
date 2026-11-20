/**
 * Praca w tle (tylko serwer): co godzinę pobiera rozegrane mecze i rozlicza typy.
 * Przy pierwszym uruchomieniu (brak backtestu) po pobraniu historii sam uruchamia backtest,
 * żeby nowy użytkownik dostał rekomendacje bez wpisywania komend.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NBA_EDGE_NO_BACKGROUND === "1") return;
  const { syncSeason } = await import("./lib/sync");
  const { settlePredictions } = await import("./lib/tracking");
  const { latestBacktest, runBacktest } = await import("./lib/backtest");
  const { setMeta } = await import("./lib/db");
  const { invalidateSlate } = await import("./lib/engine");
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const first = !latestBacktest();
      if (first) setMeta("setup:status", { phase: "sync", at: Date.now() });
      await syncSeason({});
      await settlePredictions({ sync: false });
      if (first) {
        console.log("[nba-edge] pierwsze uruchomienie: uruchamiam backtest (kilka–kilkanaście minut)…");
        setMeta("setup:status", { phase: "backtest", at: Date.now() });
        await runBacktest({ tune: false });
        setMeta("setup:status", { phase: "done", at: Date.now() });
        invalidateSlate();
        console.log("[nba-edge] gotowe — rekomendacje są dostępne.");
      }
    } catch (e) {
      console.warn("[nba-edge] praca w tle nie powiodła się:", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  setTimeout(run, 15_000);
  setInterval(run, 60 * 60 * 1000);
}
