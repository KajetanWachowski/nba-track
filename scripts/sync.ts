/**
 * Pull the season's schedule, box scores, game lines and historical DraftKings prop snapshots
 * into the local SQLite store, then refresh today's slate. Safe to re-run: it is incremental.
 *   npm run sync            # full incremental sync
 *   npm run sync -- --no-props
 */
import { syncSeason, syncSlate } from "../lib/sync";

const withProps = !process.argv.includes("--no-props");
const t0 = Date.now();
const report = await syncSeason({ withProps, log: (s) => console.log(s) });
console.log("season:", { ...report, errors: report.errors.length });
for (const e of report.errors.slice(0, 20)) console.warn("  !", e);
const slate = await syncSlate(undefined, true);
console.log(`slate ${slate.day}: ${slate.games.length} games, errors: ${slate.errors.length}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
