import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeleteManualButton, ManualOddsForm, type FormGame } from "@/components/ManualOddsForm";
import { Card, Empty, Notice, PageHeader, SourceBar } from "@/components/ui";
import { getTaxSettings, isPolishBook, PL_BOOKS, bookTitle } from "@/lib/books";
import type { BetEval } from "@/lib/engine";
import { dayLabel, dec, pct, signedPct, tipTime } from "@/lib/format";
import { listManual } from "@/lib/manual-odds";
import { MARKET_LABEL, type Market } from "@/lib/markets";
import { loadSlate } from "@/lib/page-data";
import { fetchRoster, easternDay } from "@/lib/providers/espn";
import { getUsage, oddsPapiEnabled, refreshCost } from "@/lib/providers/oddspapi";
import { ActionButton } from "@/components/ActionButton";
import { ago } from "@/lib/format";
import { getTeams } from "@/lib/store";

export const dynamic = "force-dynamic";


export default async function PolishOdds({ searchParams }: { searchParams: Promise<{ day?: string; game?: string; type?: string; market?: string }> }) {
  const sp = await searchParams;
  const day = sp.day && /^\d{8}$/.test(sp.day) ? sp.day : easternDay();
  const { a, error } = await loadSlate(day);
  if (!a) return <Notice tone="neg">{error}</Notice>;
  const tax = getTaxSettings();
  const teams = getTeams();
  const pre = a.games.filter((g) => g.state === "pre");

  const formGames: FormGame[] = await Promise.all(
    pre.map(async (g) => {
      const players: FormGame["players"] = [];
      for (const t of [g.home_id, g.away_id]) {
        const roster = await fetchRoster(t).catch(() => []);
        for (const p of roster) players.push({ id: p.athleteId, name: p.name, team: teams.get(t)?.abbr ?? "" });
      }
      const dkLines: Record<string, number> = {};
      for (const b of a.bets) {
        if (b.gameId !== g.id || b.line === null) continue;
        const dk = b.offers.some((o) => o.bookKey === "draftkings");
        if (!dk) continue;
        if (b.marketType === "ou" && b.side === "over") dkLines[`${b.market}|${b.subjectId}`] = b.line;
        if (b.market === "spread" && b.side === "home") dkLines["spread|game"] = b.line;
        if (b.market === "total" && b.side === "over") dkLines["total|game"] = b.line;
      }
      return { id: g.id, label: `${g.away?.abbr} @ ${g.home?.abbr} · ${tipTime(g.date)}`, home: g.home?.abbr ?? "", away: g.away?.abbr ?? "", players, dkLines };
    }),
  );

  const selGame = a.games.find((g) => g.id === sp.game)?.id ?? pre[0]?.id ?? a.games[0]?.id;
  const type = sp.type === "all" ? "all" : "main"; // main = O/U + game lines; all = also "N+" ladders and yes/no
  const allPl = a.bets.filter((b) => b.offers.some((o) => isPolishBook(o.bookKey)));
  const withPl = allPl.filter((b) => b.gameId === selGame && (type === "all" || b.marketType === "ou" || b.marketType === "game") && (!sp.market || b.market === sp.market));
  const present = new Set(allPl.flatMap((b) => b.offers.map((o) => o.bookKey)));
  const COLS = [
    { key: "draftkings", title: "DraftKings" },
    ...[...PL_BOOKS, { key: "fortuna", title: "Fortuna" }, { key: "sts", title: "STS" }, { key: "forbet", title: "Forbet" }].filter((b) => PL_BOOKS.some((x) => x.key === b.key) || present.has(b.key)),
  ];
  const marketsHere = [...new Set(allPl.filter((b) => b.gameId === selGame).map((b) => b.market))];
  const qs = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ day: sp.day, game: selGame, type: sp.type, market: sp.market, ...o })) if (v) q.set(k, v);
    return `/pl-odds?${q}`;
  };
  const byGame = new Map<string, BetEval[]>();
  for (const b of withPl) {
    if (!byGame.has(b.gameId)) byGame.set(b.gameId, []);
    byGame.get(b.gameId)!.push(b);
  }
  const manual = listManual(a.games.map((g) => g.id));
  const gameLabel = (id: string) => {
    const g = a.games.find((x) => x.id === id);
    return g ? `${g.away?.abbr} @ ${g.home?.abbr}` : id;
  };

  return (
    <>
      <AutoRefresh seconds={300} />
      <PageHeader eyebrow={`Superbet · Betclic · Betfan · ${dayLabel(day)}`} title="Polskie" accent="kursy" />
      <SourceBar sources={a.sources.filter((s) => /OddsPapi|Ręcznie|DraftKings/.test(s.name))} />
      {!oddsPapiEnabled() && (
        <Notice tone="neutral">
          Automatyczne kursy polskich bukmacherów wymagają klucza OddsPapi (<code>ODDSPAPI_KEY</code>, patrz Ustawienia). Betfan nie jest dostępny w żadnym
          znanym agregatorze — jego kursy wpisujesz poniżej ręcznie.
        </Notice>
      )}
      {oddsPapiEnabled() && (() => {
        const u = getUsage();
        const cost = refreshCost(pre.length);
        return (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
            <div>
              <div className="font-semibold">Kursy Superbet / Betclic z OddsPapi</div>
              <div className="text-ink-3">
                Ostatnie pobranie: {u.lastRefresh ? ago(u.lastRefresh) : "jeszcze nie pobrano"} · dziś zużyto <b className="text-ink">{u.count}</b> z {u.limit} zapytań ·
                pobranie teraz kosztuje ok. <b className="text-ink">{cost}</b>. Strony nie pobierają kursów same — oszczędzają limit.
              </div>
            </div>
            {u.remaining >= cost ? (
              <ActionButton endpoint="/api/pl-refresh" body={{ day }} label="Pobierz kursy" />
            ) : (
              <span className="text-sm text-warn">Dzienny limit aplikacji osiągnięty (ODDSPAPI_DAILY_LIMIT={u.limit}).</span>
            )}
          </div>
        );
      })()}
      <Notice tone="neutral">
        Podatek od stawki 12%: <b>{tax.enabled ? `uwzględniany (efektywny kurs = kurs × ${(1 - tax.rate).toFixed(2)})` : "nieuwzględniany"}</b>
        {tax.enabled && tax.exempt.length ? ` · bez podatku: ${tax.exempt.map(bookTitle).join(", ")}` : ""}. Zmienisz to w <Link className="underline" href="/settings">Ustawieniach</Link>.
        {!tax.enabled && " EV polskich kursów jest więc liczone tak, jakby cała stawka trafiała do gry."}
      </Notice>

      <Card title="Wpisz kursy z aplikacji bukmachera" className="mb-6">
        {formGames.length ? <ManualOddsForm games={formGames} books={PL_BOOKS} initialGame={selGame} /> : <p className="text-sm text-ink-3">Brak meczów przed rozpoczęciem w tym dniu.</p>}
        <p className="mt-3 text-xs text-ink-3">
          Linia może być inna niż w DraftKings — model liczy prawdopodobieństwo dokładnie dla wpisanej linii (z symulacji rozkładu zawodnika lub modelu meczu).
        </p>
      </Card>

      <h2 className="label mb-2">Porównanie kursów</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {a.games.map((g) => {
          const n = allPl.filter((b) => b.gameId === g.id).length;
          return (
            <Link key={g.id} href={qs({ game: g.id, market: undefined })} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${g.id === selGame ? "border-accent text-accent" : "border-line text-ink-2"}`}>
              {g.away?.abbr} @ {g.home?.abbr} <span className="text-xs font-normal text-ink-3">{n}</span>
            </Link>
          );
        })}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1 text-xs">
        <Link href={qs({ type: undefined })} className={`rounded-md px-2 py-1 ${type === "main" ? "bg-ink text-bg" : "bg-surface text-ink-3"}`}>Linie Over/Under + mecz</Link>
        <Link href={qs({ type: "all" })} className={`mr-3 rounded-md px-2 py-1 ${type === "all" ? "bg-ink text-bg" : "bg-surface text-ink-3"}`}>+ drabinki „N+” i tak/nie</Link>
        <Link href={qs({ market: undefined })} className={`rounded-md px-2 py-1 ${!sp.market ? "bg-ink text-bg" : "bg-surface text-ink-3"}`}>Wszystkie rynki</Link>
        {marketsHere.map((m) => (
          <Link key={m} href={qs({ market: m })} className={`rounded-md px-2 py-1 ${sp.market === m ? "bg-ink text-bg" : "bg-surface text-ink-3"}`}>{MARKET_LABEL[m]}</Link>
        ))}
      </div>
      {withPl.length === 0 ? (
        <Empty title="Brak kursów polskich bukmacherów dla tego meczu i filtra">Wpisz kursy powyżej{oddsPapiEnabled() ? " albo sprawdź w Ustawieniach, czy Twój klucz OddsPapi widzi polskich bukmacherów" : ""}.</Empty>
      ) : (
        [...byGame].map(([gameId, bets]) => (
          <Card key={gameId} title={gameLabel(gameId)} className="mb-4">
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[960px] whitespace-nowrap text-sm">
                <thead>
                  <tr className="label text-left">
                    <th className="py-2">Zakład</th>
                    {COLS.map((c) => <th key={c.key}>{c.title}</th>)}
                    <th>Najlepszy</th><th>Model</th><th>Rynek bez marży</th><th>EV (najlepszy)</th><th>Pewność</th>
                  </tr>
                </thead>
                <tbody>
                  {bets
                    .sort((x, y) => x.subjectName.localeCompare(y.subjectName) || x.market.localeCompare(y.market) || (x.line ?? 0) - (y.line ?? 0) || x.side.localeCompare(y.side))
                    .map((b) => {
                      const bestEff = Math.max(...b.offers.map((o) => o.eff));
                      return (
                        <tr key={b.id} className="border-t border-line">
                          <td className="py-1.5">
                            {b.kind === "player" ? <Link href={`/players/${b.subjectId}?market=${b.market}&line=${b.line ?? ""}`} className="font-semibold hover:text-accent">{b.subjectName}</Link> : <span className="font-semibold">{b.subjectName}</span>}
                            <span className="block text-xs text-ink-3">{b.selection}</span>
                          </td>
                          {COLS.map((c) => {
                            const o = b.offers.find((x) => x.bookKey === c.key);
                            const best = o && o.eff === bestEff;
                            return (
                              <td key={c.key} className={best ? "font-bold text-pos" : ""}>
                                {o ? dec(o.dec) : <span className="text-ink-3">—</span>}
                                {o && o.eff !== o.dec && <span className="block text-[11px] font-normal text-ink-3">po podatku {dec(o.eff)}</span>}
                              </td>
                            );
                          })}
                          <td>{b.book}</td>
                          <td>{pct(b.modelProb)}<span className="block text-[11px] text-ink-3">{pct(b.pLow, 0)}–{pct(b.pHigh, 0)}</span></td>
                          <td title={b.marketProbSource}>{pct(b.marketProb)}</td>
                          <td className={b.ev > 0 ? "font-bold text-pos" : "text-neg"}>{signedPct(b.ev)}</td>
                          <td className={b.confidence === "High" ? "text-pos" : b.confidence === "Medium" ? "text-warn" : "text-neg"}>{b.confidence}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-3">Zielony = najwyższy kurs dla tej strony zakładu (po podatku, jeśli jest włączony). „Rynek bez marży” pochodzi z DraftKings, gdy ma tę samą linię; inaczej z pary kursów polskiego bukmachera.</p>
          </Card>
        ))
      )}

      {manual.length > 0 && (
        <Card title="Wpisane ręcznie" className="mt-6">
          <div className="overflow-x-auto">
          <table className="num w-full min-w-[640px] whitespace-nowrap text-sm">
            <thead><tr className="label text-left"><th className="py-1">Mecz</th><th>Rynek</th><th>Linia</th><th>Bukmacher</th><th>Strona 1</th><th>Strona 2</th><th>Wpisano</th><th /></tr></thead>
            <tbody>
              {manual.map((m) => (
                <tr key={`${m.game_id}${m.market}${m.subject_id}${m.line}${m.book}`} className="border-t border-line">
                  <td className="py-1.5">{gameLabel(m.game_id)}</td>
                  <td>{MARKET_LABEL[m.market as Market]}{m.subject_id !== "game" ? ` · ${a.bets.find((b) => b.subjectId === m.subject_id)?.subjectName ?? m.subject_id}` : ""}</td>
                  <td>{m.market === "ml" ? "—" : m.line}</td><td>{bookTitle(m.book)}</td><td>{dec(m.over_dec)}</td><td>{dec(m.under_dec)}</td>
                  <td className="text-ink-3">{new Date(m.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td><DeleteManualButton q={new URLSearchParams({ gameId: m.game_id, market: m.market, subjectId: m.subject_id, line: String(m.line), book: m.book }).toString()} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </>
  );
}
