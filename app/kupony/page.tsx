import Link from "next/link";
import { DailyResultsView } from "@/components/DailyResultsView";
import { Notice, PageHeader, SourceBar, TeamLogo } from "@/components/ui";
import { couponHistory } from "@/lib/coupon-history";
import { pickTopBets } from "@/lib/daily-picks";
import { buildDailyCoupons, couponCandidates, type Coupon } from "@/lib/coupons";
import { dayLabel, tipTime } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";
import { getTeams } from "@/lib/store";

export const dynamic = "force-dynamic";

const pc = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const SHORT: Record<string, { label: string; cls: string }> = {
  najlepsze: { label: "najlepszy", cls: "text-pos" }, dobre: { label: "dobry", cls: "text-pos" }, obserwuj: { label: "obserwuj", cls: "text-warn" }, odrzucone: { label: "odrzucony", cls: "text-neg" },
};
const TONE = { pewniaczek: "border-pos", zloty: "border-warn", petarda: "border-neg" } as Record<string, string>;
const BADGE = { pewniaczek: "bg-pos-soft text-pos", zloty: "bg-warn-soft text-warn", petarda: "bg-neg-soft text-neg" } as Record<string, string>;
const ICON = { pewniaczek: "🛡️", zloty: "🥇", petarda: "🧨" } as Record<string, string>;

export default async function CouponsPage({ searchParams }: { searchParams: Promise<{ zrodlo?: string }> }) {
  const sp = await searchParams;
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Nie udało się wczytać meczów: {error}</Notice>;
  const plCands = couponCandidates(a.bets, { onlyPlayable: true });
  const wantPl = sp.zrodlo !== "wszystkie" && plCands.length >= 2;
  const coupons = buildDailyCoupons(a.bets, wantPl);
  const hist = couponHistory();
  const typy = pickTopBets(a.bets.filter((b) => !wantPl || b.playable));
  const teams = [...getTeams().values()];
  const logo = (abbr: string) => teams.find((t) => t.abbr === abbr)?.logo;

  return (
    <>
      <PageHeader eyebrow={`Kupony · ${dayLabel(a.day)}`} title="Kupony" accent="i wyniki" />
      <SourceBar sources={a.sources} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <a href="#typy" className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-2 hover:text-ink">Typy dnia</a>
        <a href="#kupony" className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-2 hover:text-ink">Kupony dnia</a>
        <a href="#wyniki" className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-2 hover:text-ink">Wyniki</a>
      </div>
      <p className="mb-5 max-w-3xl text-sm text-ink-2">
        Kupony składamy z <b>2–3 typów z różnych meczów</b> — tak, żeby wchodziły jak najczęściej przy danym kursie. W testach na rozegranych meczach
        mniej nóg i unikanie bardzo niskich kursów dawały wyraźnie lepszą trafialność. Po rozpoczęciu meczu kupon jest zamrożony, a wynik widać niżej w sekcji „Wyniki”.
      </p>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/kupony" className={`rounded-lg border border-line px-3 py-1.5 font-semibold ${wantPl ? "bg-surface-2 text-ink" : "text-ink-3"}`}>Tylko polscy bukmacherzy</Link>
        <Link href="/kupony?zrodlo=wszystkie" className={`rounded-lg border border-line px-3 py-1.5 font-semibold ${!wantPl ? "bg-surface-2 text-ink" : "text-ink-3"}`}>Także kursy orientacyjne (USA)</Link>
      </div>
      {sp.zrodlo !== "wszystkie" && !wantPl && (
        <Notice>Za mało zakładów z kursem polskiego bukmachera — pokazuję kupony po kursach orientacyjnych DraftKings. Pobierz kursy na stronie „Polskie kursy” albo wpisz kursy Superbet.</Notice>
      )}

      {/* typy dnia */}
      <section id="typy" className="mb-8 scroll-mt-4">
        <h2 className="mb-3 text-lg font-black">Typy dnia</h2>
        {typy.length ? (
          <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {typy.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                <TeamLogo src={logo(l.teamAbbr)} abbr={l.teamAbbr} size={26} />
                <div className="min-w-0 flex-1">
                  <Link href={`/analiza/${encodeURIComponent(l.id)}`} className="block truncate font-bold hover:text-accent">{l.subjectName}</Link>
                  <div className="truncate text-sm text-ink-2">{l.selection}</div>
                  <div className="truncate text-[11px] text-ink-3">{l.teamAbbr} vs {l.oppAbbr} · {tipTime(l.tipoff)}</div>
                </div>
                <div className="text-right">
                  <div className="num text-lg font-black">{l.price.toFixed(2)}</div>
                  <div className="text-[10px] text-ink-3">{l.playable ? l.book : `${l.book}*`}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : <Notice tone="neutral">Dziś brak typów spełniających kryteria.</Notice>}
      </section>

      <h2 id="kupony" className="mb-3 scroll-mt-4 text-lg font-black">Kupony dnia</h2>
      {coupons.length === 0 ? (
        <Notice tone="neutral">Dziś model nie znalazł wystarczająco wielu solidnych zakładów z różnych meczów, żeby złożyć kupon. To też jest odpowiedź — lepiej nie grać na siłę.</Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {coupons.map((c) => <CouponCard key={c.target.key} c={c} logo={logo} />)}
        </div>
      )}

      <section id="wyniki" className="mt-10 scroll-mt-4">
        <h2 className="mb-3 text-lg font-black">Wyniki</h2>
        <DailyResultsView />
      </section>

      {hist && (
        <details className="mt-8 rounded-2xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-base font-black">Jak takie kupony wypadały w teście na starszych meczach?</summary>
          <p className="mt-1 text-xs text-ink-3">
            Test na {hist.days} dniach z części testowej backtestu (dni, na których model nie był dopasowywany), po kursach otwarcia DraftKings, tymi samymi regułami.
            Stawka 1 jednostka na kupon. Nogi: {hist.legs.won}/{hist.legs.n} trafionych ({hist.legs.n ? pc(hist.legs.won / hist.legs.n, 1) : "—"}).
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr><th className="py-1.5">Kupon</th><th>Kupony</th><th>Weszło</th><th>Śr. kurs</th><th>Obiecana szansa</th><th>Faktycznie</th><th>Wynik</th></tr>
              </thead>
              <tbody className="num">
                {hist.byTarget.map((t) => (
                  <tr key={t.key} className="border-t border-line">
                    <td className="py-2 font-semibold">{t.title}</td>
                    <td>{t.coupons}</td>
                    <td>{t.won}</td>
                    <td>{t.avgOdds ? t.avgOdds.toFixed(2) : "—"}</td>
                    <td>{t.coupons ? pc(t.avgProb, 1) : "—"}</td>
                    <td>{t.coupons ? pc(t.won / t.coupons, 1) : "—"}</td>
                    <td className={t.profit >= 0 ? "font-bold text-pos" : "font-bold text-neg"}>{t.coupons ? `${t.profit >= 0 ? "+" : ""}${t.profit.toFixed(1)} j. (${t.roi >= 0 ? "+" : ""}${pc(t.roi, 0)})` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-3">Mała próba — kilka trafień w jedną lub drugą stronę wyraźnie zmienia wynik. Traktuj to jako orientację, nie dowód.</p>
        </details>
      )}
    </>
  );
}

function CouponCard({ c, logo }: { c: Coupon; logo: (abbr: string) => string | undefined }) {
  return (
    <article className={`overflow-hidden rounded-2xl border-2 bg-surface ${TONE[c.target.key] ?? "border-line"}`}>
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div>
          <span className={`whitespace-nowrap rounded-md px-2 py-1 text-sm font-black ${BADGE[c.target.key] ?? ""}`}>{ICON[c.target.key] ?? ""} {c.target.title}</span>
          <div className="mt-1.5 text-xs text-ink-3">{c.target.blurb}</div>
        </div>
        <div className="text-right">
          <div className="num text-3xl font-black">{c.odds.toFixed(2)}</div>
          <div className="text-[11px] text-ink-3">kurs łączny{c.allPlayable ? "" : " · część orientacyjnie"}</div>
        </div>
      </div>
      <ol className="divide-y divide-line border-y border-line">
        {c.legs.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
            <TeamLogo src={logo(l.oppAbbr)} abbr={l.oppAbbr} size={22} />
            <div className="min-w-0 flex-1">
              <Link href={`/analiza/${encodeURIComponent(l.id)}`} className="block truncate text-sm font-bold hover:text-accent">{l.subjectName}</Link>
              <div className="truncate text-xs text-ink-2">{l.selection}</div>
              <div className="truncate text-[11px] text-ink-3">{l.teamAbbr} vs {l.oppAbbr} · {tipTime(l.tipoff)} · <span className={SHORT[l.assessment.category].cls}>{SHORT[l.assessment.category].label}</span></div>
            </div>
            <div className="text-right">
              <div className="num font-black">{l.price.toFixed(2)}</div>
              <div className="text-[10px] text-ink-3">{l.playable ? l.book : `${l.book}*`}</div>
            </div>
          </li>
        ))}
      </ol>
      {!c.allPlayable && <p className="px-4 py-3 text-[11px] text-warn">* kurs DraftKings tylko orientacyjnie — sprawdź kurs w Superbet przed zagraniem.</p>}
    </article>
  );
}
