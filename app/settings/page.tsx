import { ActionButton } from "@/components/ActionButton";
import { Card, PageHeader } from "@/components/ui";
import { config, seasonLabel } from "@/lib/config";
import { getDb, getMeta } from "@/lib/db";
import { ago, num } from "@/lib/format";
import { getCalibration } from "@/lib/model/calibrate";
import { getModelParams } from "@/lib/model/params";
import { oddsApiEnabled } from "@/lib/providers/oddsapi";

export const dynamic = "force-dynamic";

export default function Settings() {
  const db = getDb();
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const lastFetch = (like: string) => (db.prepare("SELECT MAX(fetched_at) t FROM http_cache WHERE key LIKE ?").get(like) as { t: number | null }).t;
  const lastSync = getMeta<{ at: number; report: { boxScores: number; errors: string[] } }>("lastSeasonSync");
  const params = getModelParams();
  const calP = getCalibration("player");
  const calG = getCalibration("game");
  const sources = [
    { name: "ESPN scoreboard / schedule", host: "site.api.espn.com", key: "%/scoreboard%", note: "Scores, schedule, DraftKings game lines (open & current). No key." },
    { name: "ESPN box scores", host: "site.api.espn.com", key: "%/summary%", note: "Per-game player & team stats; source of usage, pace, defense, splits." },
    { name: "ESPN injury report", host: "site.api.espn.com", key: "%/injuries", note: "Out / Day-to-Day; Questionable/Doubtful/Probable parsed from report text." },
    { name: "ESPN player game logs", host: "site.web.api.espn.com", key: "%/gamelog%", note: "Prior-season logs used as Bayesian priors." },
    { name: "DraftKings props via ESPN", host: "sports.core.api.espn.com", key: "%/propBets%", note: "Player props (O/U, milestones, DD/TD) incl. opening prices." },
  ];
  return (
    <>
      <PageHeader eyebrow={`Season ${seasonLabel()} · model ${config.modelVersion}`} title="Settings" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Data sources">
          <ul className="space-y-3 text-sm">
            {sources.map((s) => {
              const t = lastFetch(s.key);
              return (
                <li key={s.name} className="flex gap-3">
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t ? "bg-pos" : "bg-ink-3"}`} />
                  <span><span className="font-semibold">{s.name}</span> <span className="text-ink-3">· {s.host} · last fetch {ago(t)}</span><span className="block text-xs text-ink-3">{s.note}</span></span>
                </li>
              );
            })}
            <li className="flex gap-3">
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${oddsApiEnabled() ? "bg-pos" : "bg-warn"}`} />
              <span>
                <span className="font-semibold">The Odds API (multi-book)</span> <span className="text-ink-3">· {oddsApiEnabled() ? `enabled · regions ${config.oddsApiRegions} · last fetch ${ago(lastFetch("oddsapi:%"))}` : "disabled"}</span>
                <span className="block text-xs text-ink-3">
                  Optional. Adds FanDuel, BetMGM, Caesars, Pinnacle (eu region) etc. Get a key at the-odds-api.com, put <code>ODDS_API_KEY=…</code> in <code>.env.local</code> and restart.
                  Each refresh costs credits (markets × regions per event); responses are cached {config.ttl.oddsApi / 60} min.
                </span>
              </span>
            </li>
          </ul>
          <p className="mt-4 text-xs text-ink-3">
            stats.nba.com is not used: it blocks non-browser clients. Cache TTLs — scoreboard {config.ttl.scoreboardToday}s, props {config.ttl.propsLive}s,
            injuries {config.ttl.injuries}s; finished games are cached permanently. If a source fails, the last good copy is shown and marked stale; nothing is invented.
          </p>
        </Card>
        <Card title="Database">
          <dl className="num grid grid-cols-2 gap-2 text-sm">
            {[
              ["Regular-season games", count("SELECT COUNT(*) n FROM games")],
              ["Box scores stored", count("SELECT COUNT(*) n FROM games WHERE box_synced = 1")],
              ["Player game rows", count("SELECT COUNT(*) n FROM player_games")],
              ["Prop lines stored", count("SELECT COUNT(*) n FROM prop_lines")],
              ["Predictions logged", count("SELECT COUNT(*) n FROM predictions")],
              ["Backtest runs", count("SELECT COUNT(*) n FROM backtest_runs")],
            ].map(([k, v]) => <div key={k as string} className="rounded-lg bg-surface-2 p-2"><dt className="text-xs text-ink-3">{k}</dt><dd className="text-lg font-bold">{Number(v).toLocaleString()}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-ink-3">Last season sync {ago(lastSync?.at)} {lastSync ? `(${lastSync.report.boxScores} new box scores, ${lastSync.report.errors.length} errors)` : ""} · file {config.dataDir}/nba-edge.db</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ActionButton endpoint="/api/sync" label="Refresh today's slate" />
            <ActionButton endpoint="/api/sync" body={{ scope: "season" }} label="Sync finished games" />
            <ActionButton endpoint="/api/backtest" body={{ tune: true }} label="Backtest + tune params" note="slower; tunes on training dates only" />
          </div>
        </Card>
        <Card title="Model parameters (live)">
          <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-3">Prior strength (minutes)</dt><dd>{params.priorStrength}</dd>
            <dt className="text-ink-3">Positional prior (minutes)</dt><dd>{params.posPriorStrength}</dd>
            <dt className="text-ink-3">Rate half-life (games)</dt><dd>{params.rateHalfLife}</dd>
            <dt className="text-ink-3">Minutes half-life (games)</dt><dd>{params.minHalfLife}</dd>
            <dt className="text-ink-3">Minutes de-bias</dt><dd>×{num(params.minutesAdj, 3)}</dd>
            <dt className="text-ink-3">Rate de-bias</dt><dd>{Object.entries(params.rateAdj).map(([k, v]) => `${k} ×${num(v, 3)}`).join(" · ") || "none"}</dd>
          </dl>
          <div className="label mb-1 mt-4">Calibration</div>
          <p className="num text-sm text-ink-2">
            Props: a={num(calP.a, 3)}, b(model)={num(calP.b, 3)}, c(market)={num(calP.c, 3)} · n={calP.n} · {calP.fittedAt ? `fitted ${ago(calP.fittedAt)}` : "not fitted"}<br />
            Games: a={num(calG.a, 3)}, b={num(calG.b, 3)}, c={num(calG.c, 3)} · n={calG.n} · {calG.fittedAt ? `fitted ${ago(calG.fittedAt)}` : "not fitted"}
          </p>
        </Card>
        <Card title="How the probability engine works">
          <ul className="space-y-2 text-sm text-ink-2">
            <li><b>Per-minute rates</b> — recency-weighted (half-life {params.rateHalfLife} games) Gamma posterior, shrunk to last season (or league positional rate) — sample size is built in.</li>
            <li><b>Minutes</b> — blend of recent and season minutes, regressed to last season on small samples; back-to-back factor estimated league-wide; teammate absences via with/without splits or a conservative redistribution.</li>
            <li><b>Context</b> — opponent per-possession defense vs the player&apos;s position, game pace, home/away, a heavily shrunk head-to-head residual.</li>
            <li><b>Distribution</b> — Monte-Carlo with var = κμ + φμ² per stat (κ≈2 for points) and a shared game factor that correlates stats for PRA and double-doubles.</li>
            <li><b>Calibration</b> — logistic blend of model and no-vig market, learned from leak-free walk-forward backtests.</li>
            <li><b>Extending</b> — <code>projectPlayer</code> returns per-stat factors; a gradient-boosted or neural model can replace or stack on these features, evaluated by the same backtest harness.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
