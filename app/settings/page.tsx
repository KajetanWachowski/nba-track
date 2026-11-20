import fs from "node:fs";
import path from "node:path";
import { ActionButton } from "@/components/ActionButton";
import { Term } from "@/components/Term";
import { Card, PageHeader } from "@/components/ui";
import { config, seasonLabel } from "@/lib/config";
import { getDb, getMeta } from "@/lib/db";
import { ago, num } from "@/lib/format";
import { getCalibration } from "@/lib/model/calibrate";
import { getModelParams } from "@/lib/model/params";
import { oddsApiEnabled } from "@/lib/providers/oddsapi";
import { TaxToggle } from "@/components/TaxToggle";
import { PL_BOOKS, getTaxSettings } from "@/lib/books";
import { NotFetchedError, bookmakerMap, getUsage, listBookmakers, oddsPapiEnabled } from "@/lib/providers/oddspapi";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const tax = getTaxSettings();
  let papiBooks: Awaited<ReturnType<typeof listBookmakers>> = [];
  let papiError: string | null = null;
  if (oddsPapiEnabled()) {
    try {
      papiBooks = (await listBookmakers()).filter((b) => b.polish); // cache only — costs nothing
    } catch (e) {
      papiError = e instanceof NotFetchedError ? "Lista bukmacherów pojawi się po pierwszym „Pobierz kursy” na stronie Polskie kursy." : (e as Error).message;
    }
  }
  const papiUsage = getUsage();
  const bmap = bookmakerMap();
  const db = getDb();
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const lastFetch = (like: string) => (db.prepare("SELECT MAX(fetched_at) t FROM http_cache WHERE key LIKE ?").get(like) as { t: number | null }).t;
  const lastSync = getMeta<{ at: number; report: { boxScores: number; errors: string[] } }>("lastSeasonSync");
  const params = getModelParams();
  const calP = getCalibration("player");
  const calG = getCalibration("game");
  const sources = [
    { name: "ESPN — mecze i terminarz", host: "site.api.espn.com", key: "%/scoreboard%", note: "Wyniki, terminarz, linie meczowe DraftKings (otwarcie i aktualne). Bez klucza." },
    { name: "ESPN — statystyki meczów", host: "site.api.espn.com", key: "%/summary%", note: "Statystyki zawodników i drużyn z każdego meczu: z nich liczymy usage, tempo, obronę i podziały." },
    { name: "ESPN — raport kontuzji", host: "site.api.espn.com", key: "%/injuries", note: "Out / Day-to-Day; statusy Questionable / Doubtful / Probable odczytywane z treści raportu." },
    { name: "ESPN — mecze z poprzedniego sezonu", host: "site.web.api.espn.com", key: "%/gamelog%", note: "Służą jako punkt wyjścia (prior) dla zawodników z małą liczbą meczów." },
    { name: "DraftKings przez ESPN (USA)", host: "sports.core.api.espn.com", key: "%/propBets%", note: "Kursy na zawodników z kursami otwarcia — tylko punkt odniesienia, nie do zagrania w Polsce." },
  ];
  return (
    <>
      <PageHeader eyebrow={`Sezon ${seasonLabel()} · model ${config.modelVersion}`} title="Ustawienia" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Wersja i aktualizacje">
          {(() => {
            let st: { version?: string | null; versionDate?: string | null; autoUpdate?: boolean; checkedAt?: number; lastUpdateAt?: number; lastError?: string | null } | null = null;
            try { st = JSON.parse(fs.readFileSync(path.join(config.dataDir, "update-status.json"), "utf8")); } catch { st = null; }
            if (!st) return <p className="text-sm text-ink-3">Aplikacja uruchomiona bez startera — aktualizacje automatyczne są wyłączone. Uruchamiaj ją przez „Uruchom NBA EDGE” albo <code>npm run serve</code>, żeby sama się aktualizowała.</p>;
            return (
              <div className="space-y-1 text-sm">
                <div>Wersja: <b className="num">{st.version ?? "—"}</b>{st.versionDate ? ` z ${new Date(st.versionDate).toLocaleDateString("pl-PL")}` : ""}</div>
                <div>Aktualizacje automatyczne: <b className={st.autoUpdate ? "text-pos" : "text-warn"}>{st.autoUpdate ? "włączone" : "wyłączone"}</b> (instalowane w dzień, 10:00–20:00)</div>
                <div className="text-ink-3">Ostatnie sprawdzenie: {st.checkedAt ? ago(st.checkedAt) : "—"}{st.lastUpdateAt ? ` · ostatnia aktualizacja: ${ago(st.lastUpdateAt)}` : ""}</div>
                {st.lastError && <div className="text-warn">Uwaga: {st.lastError}</div>}
              </div>
            );
          })()}
        </Card>
        <Card title="Polscy bukmacherzy (Superbet · Betclic · Betfan)">
          <TaxToggle enabled={tax.enabled} exempt={tax.exempt} books={PL_BOOKS} rate={tax.rate} />
          <p className="mt-2 text-xs text-ink-3">
            Kolejność kursów: Superbet (główne źródło) → Betclic → Betfan → inni legalni polscy bukmacherzy. Kursy amerykańskie są tylko punktem odniesienia.
          </p>
          <div className="label mb-1 mt-5">OddsPapi (automatyczne kursy polskie)</div>
          {oddsPapiEnabled() && (
            <p className="mb-2 text-sm text-ink-2">
              Zapytania dziś: <b>{papiUsage.count}</b>{papiUsage.limit > 0 ? ` / ${papiUsage.limit} (limit aplikacji, ODDSPAPI_DAILY_LIMIT)` : " (bez limitu aplikacji)"} · ostatnie pobranie {ago(papiUsage.lastRefresh)} ·
              tryb: {config.oddsPapiAutoRefreshMin > 0 ? `automatycznie co ${config.oddsPapiAutoRefreshMin} min` : "tylko po kliknięciu „Pobierz kursy”"}. Limit planu sprawdzisz na koncie oddspapi.io.
            </p>
          )}
          {!oddsPapiEnabled() ? (
            <p className="text-sm text-ink-2">
              Wyłączone. Załóż konto na oddspapi.io (jest darmowy plan), wpisz <code>ODDSPAPI_KEY=…</code> do pliku <code>.env.local</code> i uruchom aplikację ponownie.
              Bez klucza kursy polskich bukmacherów wpisujesz ręcznie na stronie „Polskie kursy”.
            </p>
          ) : papiError ? (
            <p className="text-sm text-ink-2">{papiError}</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-ink-2">Polscy bukmacherzy dostępni dla Twojego klucza (✓ = pobierany przez aplikację):</p>
              {papiBooks.length === 0 ? <p className="text-sm text-warn">Twój plan OddsPapi nie obejmuje żadnego polskiego bukmachera.</p> : (
                <ul className="space-y-1 text-sm">
                  {papiBooks.map((b) => (
                    <li key={b.slug}><span className={bmap.has(b.slug) ? "text-pos" : "text-ink-3"}>{bmap.has(b.slug) ? "✓" : "○"}</span> <code>{b.slug}</code> · {b.bookmakerName}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-3">
                Pobierane nazwy (<code>ODDSPAPI_BOOKMAKERS</code>): {[...bmap].map(([slug, key]) => `${slug}→${key}`).join(", ")}. Przykład:
                <code> ODDSPAPI_BOOKMAKERS=superbet.pl:superbet,betclic.pl:betclic,efortuna.pl:fortuna</code>. Betfan nie jest dostępny w OddsPapi — wpisuj go ręcznie.
              </p>
            </>
          )}
        </Card>
        <Card title="Źródła danych">
          <ul className="space-y-3 text-sm">
            {sources.map((s) => {
              const t = lastFetch(s.key);
              return (
                <li key={s.name} className="flex gap-3">
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t ? "bg-pos" : "bg-ink-3"}`} />
                  <span><span className="font-semibold">{s.name}</span> <span className="text-ink-3">· {s.host} · ostatnio {ago(t)}</span><span className="block text-xs text-ink-3">{s.note}</span></span>
                </li>
              );
            })}
            <li className="flex gap-3">
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${oddsApiEnabled() ? "bg-pos" : "bg-ink-3"}`} />
              <span>
                <span className="font-semibold">The Odds API (bukmacherzy zagraniczni)</span> <span className="text-ink-3">· {oddsApiEnabled() ? `włączone · regiony ${config.oddsApiRegions}` : "wyłączone"}</span>
                <span className="block text-xs text-ink-3">Opcjonalne, tylko do porównania (np. Pinnacle). Klucz <code>ODDS_API_KEY</code> z the-odds-api.com.</span>
              </span>
            </li>
          </ul>
          <p className="mt-4 text-xs text-ink-3">
            Nie korzystamy ze stats.nba.com — blokuje programy inne niż przeglądarka. Zakończone mecze są zapisywane na stałe; gdy źródło nie odpowiada,
            pokazujemy ostatnią poprawną kopię z oznaczeniem „nieaktualne”. Niczego nie zmyślamy.
          </p>
        </Card>
        <Card title="Baza danych">
          <dl className="num grid grid-cols-2 gap-2 text-sm">
            {[
              ["Mecze sezonu regularnego", count("SELECT COUNT(*) n FROM games")],
              ["Zapisane statystyki meczów", count("SELECT COUNT(*) n FROM games WHERE box_synced = 1")],
              ["Wiersze statystyk zawodników", count("SELECT COUNT(*) n FROM player_games")],
              ["Zapisane linie bukmacherskie", count("SELECT COUNT(*) n FROM prop_lines")],
              ["Ręcznie wpisane kursy", count("SELECT COUNT(*) n FROM manual_odds")],
              ["Zapisane rekomendacje", count("SELECT COUNT(*) n FROM predictions")],
            ].map(([k, v]) => <div key={k as string} className="rounded-lg bg-surface-2 p-2"><dt className="text-xs text-ink-3">{k}</dt><dd className="text-lg font-bold">{Number(v).toLocaleString("pl-PL")}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-ink-3">Ostatnia synchronizacja sezonu {ago(lastSync?.at)} {lastSync ? `(${lastSync.report.boxScores} nowych meczów, ${lastSync.report.errors.length} błędów)` : ""} · plik {config.dataDir}/nba-edge.db</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ActionButton endpoint="/api/sync" label="Odśwież dzisiejsze mecze" />
            <ActionButton endpoint="/api/sync" body={{ scope: "season" }} label="Pobierz zakończone mecze" />
            <ActionButton endpoint="/api/backtest" body={{ tune: true }} label="Backtest + strojenie" note="wolniej; strojenie tylko na meczach treningowych" />
          </div>
        </Card>
        <Card title="Jak działa model">
          <ul className="space-y-2 text-sm text-ink-2">
            <li><b>Tempo na minutę</b> — z ostatnich meczów (większa waga dla nowszych, okres półtrwania {params.rateHalfLife} meczów), ściągane do poprzedniego sezonu przy małej próbce.</li>
            <li><b>Minuty</b> — mieszanka ostatnich i sezonowych minut, efekt meczu dzień po dniu, nieobecności kolegów (dane z meczów bez nich) i <Term k="blowout">ryzyko blowoutu</Term> z handicapu rynku.</li>
            <li><b>Trójki</b> — osobno liczba prób i skuteczność (rozkład dwumianowy), z korektą na obronę obwodu rywala.</li>
            <li><b>Kontekst</b> — obrona rywala na danej pozycji, tempo meczu, dom/wyjazd, mecze z tym rywalem (mocno wygładzone).</li>
            <li><b>Rozkład</b> — symulacja 8–10 tys. meczów z realistycznym rozrzutem (punkty wpadają po 2–3) i korelacją statystyk w jednym meczu.</li>
            <li><b><Term k="calibration">Kalibracja</Term></b> — połączenie modelu z rynkiem bez marży, dopasowane na <Term k="backtest">backteście</Term> bez przecieku danych.</li>
            <li><b>Ocena zakładu</b> — prawdopodobieństwo, jakość danych i opłacalność osobno, plus lista ryzyk. Ryzyko krytyczne odrzuca zakład bez względu na EV.</li>
          </ul>
          <div className="label mb-1 mt-4">Parametry</div>
          <p className="num text-xs text-ink-2">
            siła priora {params.priorStrength} min · prior pozycji {params.posPriorStrength} min · półtrwanie formy {params.rateHalfLife} / minut {params.minHalfLife} meczów ·
            korekta minut ×{num(params.minutesAdj, 3)} · korekty tempa {Object.entries(params.rateAdj).map(([k, v]) => `${k} ×${num(v, 3)}`).join(", ") || "brak"}
          </p>
          <p className="num mt-1 text-xs text-ink-2">
            Kalibracja: zawodnicy — waga modelu {num(calP.b, 2)}, rynku {num(calP.c, 2)} ({calP.fittedAt ? `dopasowana ${ago(calP.fittedAt)}` : "niedopasowana"}); mecze — waga modelu {num(calG.b, 2)}, rynku {num(calG.c, 2)}.
          </p>
        </Card>
      </div>
    </>
  );
}
