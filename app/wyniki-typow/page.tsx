import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RefreshButton } from "@/components/RefreshButton";
import { Notice, PageHeader, TeamLogo } from "@/components/ui";
import { dailyResults, summarize, type LegResult, type LegStatus, type SetResult } from "@/lib/daily-results";
import { SET_TITLE, SET_ORDER } from "@/lib/daily-picks";
import { dayLabel, tipTime } from "@/lib/format";
import { getTeams } from "@/lib/store";

export const dynamic = "force-dynamic";

const pc = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const BADGE: Record<LegStatus, { label: string; cls: string }> = {
  oczekuje: { label: "Przed meczem", cls: "bg-surface-2 text-ink-3" },
  live: { label: "Na żywo", cls: "bg-warn-soft text-warn" },
  weszlo: { label: "Weszło ✓", cls: "bg-pos-soft text-pos" },
  "nie-weszlo": { label: "Nie weszło ✗", cls: "bg-neg-soft text-neg" },
  zwrot: { label: "Zwrot (nie zagrał)", cls: "bg-surface-2 text-ink-2" },
};
const BORDER: Record<LegStatus, string> = { oczekuje: "border-line", live: "border-warn", weszlo: "border-pos", "nie-weszlo": "border-neg", zwrot: "border-line" };

export default async function ResultsPage() {
  const results = await dailyResults(14);
  const anyLive = results.some((r) => r.legs.some((l) => l.gameState === "in"));
  const sum = summarize(results);
  const teams = [...getTeams().values()];
  const logo = (abbr: string) => teams.find((t) => t.abbr === abbr)?.logo;
  const days = [...new Set(results.map((r) => r.set.day))];

  return (
    <>
      {anyLive && <AutoRefresh seconds={60} />}
      <PageHeader eyebrow="Archiwum" title="Wyniki" accent="typów dnia" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RefreshButton />
        <span className="text-xs text-ink-3">
          {anyLive ? "Mecze trwają — strona odświeża się sama co minutę." : "Wyniki z darmowych danych ESPN — odświeżanie nie zużywa limitu OddsPapi."}
        </span>
      </div>
      <p className="mb-5 max-w-3xl text-sm text-ink-2">
        Typy dnia i kupony dnia są zapisywane <b>przed meczami</b>. Do rozpoczęcia pierwszego meczu mogą się jeszcze zmienić (nowe kursy, kontuzje), potem są
        <b> zamrożone</b> — tutaj widać dokładnie to, co było polecane, i jak się skończyło. Zawodnik, który nie zagrał, to zwrot (tak rozliczają to bukmacherzy).
      </p>

      {/* podsumowanie */}
      <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Typy dnia (pojedyncze)" value={sum.typy.done ? `${sum.typy.won}/${sum.typy.done}` : "—"} sub={sum.typy.done ? pc(sum.typy.won / sum.typy.done) + " trafionych" : "brak rozliczonych"} tone={sum.typy.done ? (sum.typy.won / sum.typy.done >= 0.55 ? "pos" : "neg") : undefined} />
        {SET_ORDER.filter((k) => k !== "typy").map((k) => {
          const a = sum.coupons.get(k);
          return <Tile key={k} label={SET_TITLE[k]} value={a ? `${a.won}/${a.done}` : "—"} sub={a ? `${a.profit >= 0 ? "+" : ""}${a.profit.toFixed(1)} j. przy stawce 1` : "brak rozliczonych"} tone={a ? (a.profit >= 0 ? "pos" : "neg") : undefined} />;
        })}
      </section>

      {!results.length && (
        <Notice tone="neutral">Archiwum jest puste. Typy zapisują się automatycznie, gdy otworzysz stronę przed meczami (np. „Propozycje” albo „Kupony dnia”).</Notice>
      )}

      {days.map((day) => (
        <section key={day} className="mb-8">
          <h2 className="mb-3 text-lg font-black capitalize">{dayLabel(day)}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {results.filter((r) => r.set.day === day).map((r) => <SetCard key={r.set.kind} r={r} logo={logo} />)}
          </div>
        </section>
      ))}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "pos" | "neg" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-3">
      <div className="truncate text-[11px] text-ink-3">{label}</div>
      <div className={`num text-2xl font-black ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}>{value}</div>
      <div className="truncate text-[11px] text-ink-3">{sub}</div>
    </div>
  );
}

function SetCard({ r, logo }: { r: SetResult; logo: (a: string) => string | undefined }) {
  const isCoupon = r.set.kind !== "typy";
  return (
    <article className={`overflow-hidden rounded-2xl border-2 bg-surface ${isCoupon ? BORDER[r.status] : "border-line"}`}>
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div>
          <h3 className="font-black">{SET_TITLE[r.set.kind]}</h3>
          <div className="text-[11px] text-ink-3">{r.locked ? "zamrożony (mecze się zaczęły)" : "może się jeszcze zmienić do pierwszego meczu"}</div>
        </div>
        {isCoupon && (
          <div className="text-right">
            <div className="num text-2xl font-black">{r.odds.toFixed(2)}</div>
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${BADGE[r.status].cls}`}>{r.status === "weszlo" && r.legs.some((l) => l.gameState !== "post") ? "Wchodzi…" : BADGE[r.status].label}</span>
          </div>
        )}
      </div>
      <ol className="divide-y divide-line border-t border-line">
        {r.legs.map((l) => <LegRow key={l.bet.id} l={l} logo={logo} />)}
      </ol>
      {isCoupon && <div className="px-4 py-2 text-[11px] text-ink-3">Szansa wg modelu przed meczem: {pc(r.prob, 1)} (wchodzi średnio 1 na {Math.max(1, Math.round(1 / Math.max(r.prob, 1e-6)))})</div>}
    </article>
  );
}

function LegRow({ l, logo }: { l: LegResult; logo: (a: string) => string | undefined }) {
  const b = l.bet;
  const line = b.line ?? 0;
  const over = b.side !== "under";
  const v = l.value;
  const scale = Math.max(line * 1.4, v ?? 0, 1);
  const pct = v === null ? 0 : v / scale;
  void over;
  const barTone = l.status === "weszlo" ? "var(--pos)" : l.status === "nie-weszlo" ? "var(--neg)" : "var(--warn)";
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <TeamLogo src={logo(b.teamAbbr)} abbr={b.teamAbbr} size={22} />
        <div className="min-w-0 flex-1">
          <Link href={`/analiza/${encodeURIComponent(b.id)}`} className="block truncate text-sm font-bold hover:text-accent">{b.subjectName}</Link>
          <div className="truncate text-xs text-ink-2">{b.selection} · kurs {b.price.toFixed(2)} · szansa {pc(b.modelProb)}</div>
          <div className="truncate text-[11px] text-ink-3">
            {b.teamAbbr} vs {b.oppAbbr} · {l.gameState === "pre" ? tipTime(b.tipoff) : `${l.gameDetail}${l.score ? ` · ${l.score}` : ""}`}
          </div>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${BADGE[l.status].cls}`}>{BADGE[l.status].label}</span>
      </div>
      {v !== null && l.status !== "zwrot" && (
        <div className="mt-2 flex items-center gap-2">
          <div className="relative h-2.5 flex-1 rounded bg-surface-2">
            <div className="h-2.5 rounded" style={{ width: `${pct * 100}%`, background: barTone }} />
            <span className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: `${(line / scale) * 100}%` }} title={`linia ${line}`} />
          </div>
          <span className="num w-28 text-right text-xs"><b>{n1(v)}</b> / {line} {l.min !== null ? <span className="text-ink-3">· {l.min} min</span> : null}</span>
        </div>
      )}
    </li>
  );
}
