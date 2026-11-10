/** Background refresh: sync finished games hourly and settle predictions (server runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NBA_EDGE_NO_BACKGROUND === "1") return;
  const { syncSeason } = await import("./lib/sync");
  const { settlePredictions } = await import("./lib/tracking");
  const run = async () => {
    try {
      await syncSeason({});
      await settlePredictions({ sync: false });
    } catch (e) {
      console.warn("[nba-edge] background sync failed:", (e as Error).message);
    }
  };
  setTimeout(run, 15_000);
  setInterval(run, 60 * 60 * 1000);
}
