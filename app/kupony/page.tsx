import Link from "next/link";
import { Term } from "@/components/Term";
import { Notice, PageHeader, SourceBar, TeamLogo } from "@/components/ui";
import { couponHistory } from "@/lib/coupon-history";
import { buildDailyCoupons, couponCandidates, type Coupon } from "@/lib/coupons";
import { dayLabel, tipTime } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";
import { getTeams } from "@/lib/store";

export const dynamic = "force-dynamic";

const pc = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const SHORT: Record<string, { label: string; cls: string }> = {
  najlepsze: { label: "najlepszy", cls: "text-pos" }, dobre: { label: "dobry", cls: "text-pos" }, obserwuj: { label: "obserwuj", cls: "text-warn" }, odrzucone: { label: "odrzucony", cls: "text-neg" },
};
const TONE = { bezpieczny: "border-pos", sredni: "border-warn", odwazny: "border-neg" } as Record<string, string>;
const BADGE = { bezpieczny: "bg-pos-soft text-pos", sredni: "bg-warn-soft text-warn", odwazny: "bg-neg-soft text-neg" } as Record<string, string>;

export default async function CouponsPage({ searchParams }: { searchParams: Promise<{ zrodlo?: string }> }) {
  const sp = await searchParams;
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Nie udało się wczytać meczów: {error}</Notice>;
  const plCands = couponCandidates(a.bets, { onlyPlayable: true });
  const wantPl = sp.zrodlo !== "wszystkie" && plCands.length >= 2;
  const coupons = buildDailyCoupons(a.bets, wantPl);
  const hist = couponHistory();
  const teams = [...getTeams().values()];
  const logo = (abbr: string) => teams.find((t) => t.abbr === abbr)?.logo;

  return (
    <>
      <PageHeader eyebrow={`Kupony · ${dayLabel(a.day)}`} title="Kupony" accent="dnia" />
      <SourceBar sources={a.sources} />
      <div className="mb-5 max-w-3xl space-y-2 text-sm text-ink-2">
        <p>
          Trzy kupony złożone automatycznie z dzisiejszych propozycji: około <b>2,5–4</b>, <b>6–8</b> i <b>~10</b>. Dla każdego przedziału model wybiera
          zestaw o <b>najwyższej łącznej szansie</b>, tylko z różnych meczów (zakłady z jednego meczu są ze sobą powiązane). Nogi pochodzą z kategorii
          „Najlepsze”, „Dobre” i „Warte obserwacji” — bez ryzyk krytycznych, z szansą ≥ 55%, kursem ≥ 1.40 i EV nie gorszym niż −3%.
        </p>
        <p className="text-ink-3">
          Uczciwie: każda noga to osobne ryzyko, a marża bukmachera mnoży się z każdą nogą. Kupon za ~10 przy szansie 10–15% przegrywa zdecydowaną większość dni.
        </p>
      </div>

      <p className="mb-4 text-sm text-ink-3">Kupony, których mecze już się zaczęły, i ich wyniki na żywo: <Link href="/wyniki-typow" className="text-accent">Wyniki typów →</Link></p>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/kupony" className={`rounded-lg border border-line px-3 py-1.5 font-semibold ${wantPl ? "bg-surface-2 text-ink" : "text-ink-3"}`}>Tylko polscy bukmacherzy</Link>
        <Link href="/kupony?zrodlo=wszystkie" className={`rounded-lg border border-line px-3 py-1.5 font-semibold ${!wantPl ? "bg-surface-2 text-ink" : "text-ink-3"}`}>Także kursy orientacyjne (USA)</Link>
      </div>
      {sp.zrodlo !== "wszystkie" && !wantPl && (
        <Notice>Za mało zakładów z kursem polskiego bukmachera — pokazuję kupony po kursach orientacyjnych DraftKings. Pobierz kursy na stronie „Polskie kursy” albo wpisz kursy Superbet.</Notice>
      )}

      {coupons.length === 0 ? (
        <Notice tone="neutral">Dziś model nie znalazł wystarczająco wielu solidnych zakładów z różnych meczów, żeby złożyć kupon. To też jest odpowiedź — lepiej nie grać na siłę.</Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {coupons.map((c) => <CouponCard key={c.target.key} c={c} logo={logo} />)}
        </div>
      )}

      {hist && (
        <section className="mt-8 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-base font-black">Jak takie kupony wypadały w przeszłości?</h2>
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
          <p className="mt-2 text-xs text-ink-3">Mała próba — przy kursach 6–10 kilka trafień w jedną lub drugą stronę całkowicie zmienia wynik. Traktuj to jako orientację, nie dowód.</p>
        </section>
      )}
    </>
  );
}

function CouponCard({ c, logo }: { c: Coupon; logo: (abbr: string) => string | undefined }) {
  const oneIn = c.prob > 0 ? Math.round(1 / c.prob) : null;
  return (
    <article className={`overflow-hidden rounded-2xl border-2 bg-surface ${TONE[c.target.key] ?? "border-line"}`}>
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <div>
          <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold ${BADGE[c.target.key] ?? ""}`}>{c.target.title}</span>
          <div className="mt-1 text-xs text-ink-3">{c.legs.length} {c.legs.length >= 5 ? "nóg" : "nogi"} · cel {c.target.min}–{c.target.max}</div>
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
              <div className={`num text-[11px] ${l.modelProb >= 0.6 ? "text-pos" : "text-warn"}`}>{pc(l.modelProb)}</div>
              <div className="text-[10px] text-ink-3">{l.playable ? l.book : `${l.book}*`}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-3 gap-2 p-4 text-center">
        <div className="rounded-xl bg-surface-2 p-2">
          <div className="text-[11px] text-ink-3"><Term k="prob">Szansa</Term></div>
          <div className={`num text-lg font-black ${c.prob >= 0.3 ? "text-pos" : c.prob >= 0.15 ? "text-warn" : "text-neg"}`}>{pc(c.prob, 1)}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-2">
          <div className="text-[11px] text-ink-3">Wchodzi średnio</div>
          <div className="num text-lg font-black">{oneIn ? `1 na ${oneIn}` : "—"}</div>
        </div>
        <div className="rounded-xl bg-surface-2 p-2">
          <div className="text-[11px] text-ink-3"><Term k="ev">EV</Term></div>
          <div className={`num text-lg font-black ${c.ev >= 0 ? "text-pos" : "text-neg"}`}>{c.ev >= 0 ? "+" : ""}{pc(c.ev, 1)}</div>
        </div>
      </div>
      {!c.allPlayable && <p className="px-4 pb-3 text-[11px] text-warn">* kurs DraftKings tylko orientacyjnie — sprawdź kurs w Superbet przed zagraniem.</p>}
    </article>
  );
}
