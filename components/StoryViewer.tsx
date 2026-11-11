"use client";
import { toPng } from "html-to-image";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { StoryData, StoryGame } from "@/lib/story";

/* Paleta grafiki (stała — grafika do udostępniania nie zmienia się z motywem strony) */
const C = { bg: "#f2eee6", ink: "#16171b", orange: "#e8572a", green: "#23874f", beige: "#ddd4c4", gray: "#8b8782", navy: "#26206e", red: "#d7263d", card: "#ffffff", mute: "#6d6a66" };
const W = 360, H = 640;
const img = (u: string | null | undefined) => (u ? `/api/img?u=${encodeURIComponent(u)}` : undefined);
const n1 = (x: number) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toString().replace(".", ",") : "—");
const lineS = (x: number) => String(x).replace(".", ",");
const DAYS = ["ND", "PN", "WT", "ŚR", "CZW", "PT", "SOB"];
const MONTHS = ["STY", "LUT", "MAR", "KWI", "MAJ", "CZE", "LIP", "SIE", "WRZ", "PAŹ", "LIS", "GRU"];
const whenPl = (iso: string) => {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Warsaw" })).getDay();
  return `${DAYS[wd]} ${get("day")} ${MONTHS[Number(get("month")) - 1]} · ${get("hour")}:${get("minute")}`;
};
const shortDay = (iso: string) => {
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

const mono: CSSProperties = { fontFamily: "var(--font-story-mono), ui-monospace, monospace", letterSpacing: "0.14em", textTransform: "uppercase" };
const head: CSSProperties = { fontFamily: "var(--font-story-head), Impact, 'Arial Narrow', sans-serif", textTransform: "uppercase", fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.01em" };

function Logo({ src, size }: { src: string | null | undefined; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={img(src)} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} crossOrigin="anonymous" /> : <span style={{ width: size, height: size, display: "inline-block" }} />;
}
function Face({ src, size, badge }: { src: string | null | undefined; size: number; badge?: string }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{ width: size, height: size, borderRadius: "50%", border: `2px solid ${C.ink}`, background: "#e4e7ec", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={img(src)} alt="" crossOrigin="anonymous" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 15%", transform: "scale(1.35) translateY(8%)" }} />}
      </div>
      {badge && <span style={{ ...mono, position: "absolute", right: 0, bottom: 2, background: C.ink, color: "#fff", fontSize: 9, padding: "2px 6px", borderRadius: 9, letterSpacing: "0.05em" }}>{badge}</span>}
    </div>
  );
}
const Card = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: C.card, borderRadius: 10, padding: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", ...style }}>{children}</div>
);
const Pill = ({ children, bg = C.ink, color = "#fff", style }: { children: ReactNode; bg?: string; color?: string; style?: CSSProperties }) => (
  <span style={{ ...mono, display: "inline-block", background: bg, color, fontSize: 9.5, padding: "4px 9px", borderRadius: 12, fontWeight: 700, ...style }}>{children}</span>
);

function Frame({ d, i, total, kicker, a, b, children }: { d: StoryData; i: number; total: number; kicker: string; a: string; b: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: W, height: H, background: C.bg, color: C.ink, position: "relative", overflow: "hidden", padding: "18px 20px", boxSizing: "border-box", display: "flex", flexDirection: "column",
        backgroundImage: "linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px)", backgroundSize: "16px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...head, background: C.orange, color: "#fff", fontSize: 13, padding: "4px 7px", borderRadius: 3, letterSpacing: "0.03em" }}>NBA EDGE</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, ...mono, fontSize: 8.5, letterSpacing: "0.1em" }}>
          <Logo src={d.team?.logo} size={14} /> <span>{d.bet.gameLabel.includes("@") ? "@" : "VS"}</span> <Logo src={d.opp?.logo} size={14} />
          <span style={{ marginLeft: 4 }}>{whenPl(d.tipoff)}</span>
        </span>
      </div>
      <div style={{ height: 1.5, background: C.ink, margin: "10px 0 12px" }} />
      <div style={{ ...mono, fontSize: 9, fontWeight: 700 }}>
        <span style={{ color: C.orange }}>{String(i + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span> · {kicker}
      </div>
      <div style={{ ...head, fontSize: 38, marginTop: 4 }}>
        {a} <span style={{ color: C.orange }}>{b}</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, marginTop: 14, minHeight: 0 }}>{children}</div>
      <div style={{ ...mono, fontSize: 7, color: C.mute, textAlign: "center", letterSpacing: "0.1em" }}>NBA EDGE · DANE ESPN + MODEL · 18+ · HAZARD MOŻE UZALEŻNIAĆ</div>
    </div>
  );
}

function Bars({ games, line, side, height = 190, showLogos = true }: { games: { value: number; logo?: string | null; hit: boolean }[]; line: number | null; side: "over" | "under"; height?: number; showLogos?: boolean }) {
  const max = Math.max(1, line ?? 0, ...games.map((g) => g.value)) * 1.15;
  const bw = Math.min(30, (W - 50) / Math.max(1, games.length) - 5);
  return (
    <div>
      <div style={{ position: "relative", height, display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderBottom: `2px solid ${C.ink}`, padding: "0 2px" }}>
        {line !== null && <div style={{ position: "absolute", left: -6, right: -6, bottom: (line / max) * height, borderTop: `2px dashed ${C.orange}`, zIndex: 2 }} />}
        {games.map((g, k) => (
          <div key={k} style={{ width: bw, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <span style={{ ...head, fontSize: 15, color: g.hit ? C.orange : C.mute, marginBottom: 2 }}>{n1(g.value)}</span>
            <div style={{ width: "100%", height: Math.max(3, (g.value / max) * height - 2), background: g.hit ? C.orange : "#9a958f", borderRadius: "4px 4px 0 0", opacity: g.hit ? 1 : 0.8 }} />
          </div>
        ))}
      </div>
      {showLogos && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 2px 0" }}>
          {games.map((g, k) => <div key={k} style={{ width: bw, display: "flex", justifyContent: "center" }}><Logo src={g.logo} size={Math.min(20, bw)} /></div>)}
        </div>
      )}
      <div style={{ display: "none" }}>{side}</div>
    </div>
  );
}

function Donut({ value, of = 48, size = 52 }: { value: number; of?: number; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, f = Math.min(1, value / of);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.beige} strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.ink} strokeWidth={6} strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" style={{ ...head, fontSize: 18 }} fill={C.ink}>{value}</text>
    </svg>
  );
}

function Dots({ made, att }: { made: number; att: number }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 96 }}>
      {Array.from({ length: Math.min(att, 30) }, (_, k) => (
        <span key={k} style={{ width: 9, height: 9, borderRadius: "50%", background: k < made ? C.orange : "transparent", border: `1.5px solid ${k < made ? C.orange : "#b9b3aa"}` }} />
      ))}
    </div>
  );
}

/* ---------------- slajdy ---------------- */
type Slide = { key: string; kicker: string; a: string; b: string; body: ReactNode };

function slides(d: StoryData): Slide[] {
  const b = d.bet;
  const L = b.line!;
  const sideW = d.side === "over" ? "POWYŻEJ" : "PONIŻEJ";
  const out: Slide[] = [];
  const last7 = d.games.slice(-7);
  const h7 = last7.filter((g) => g.hit).length;

  // 01 seria / forma
  const st = d.streak;
  out.push({
    key: "seria", kicker: st && st.n >= 3 ? "SERIA" : "FORMA",
    a: st && st.n >= 3 ? `${d.team?.abbr ?? b.teamAbbr}:` : `${d.player.last}:`,
    b: st && st.n >= 3 ? `${st.n} ${st.kind === "W" ? "WYGRANYCH" : "PORAŻEK"}` : `${h7}/${last7.length} ${sideW}`,
    body: (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ textAlign: "center" }}>
            <Face src={d.player.headshot} size={92} badge={d.team?.abbr} />
            <div style={{ ...mono, fontSize: 9, fontWeight: 700, marginTop: 6 }}>{d.player.last}</div>
          </div>
          <Logo src={d.team?.logo} size={64} />
          {st && st.n >= 3 ? (
            <div style={{ textAlign: "right" }}>
              <div style={{ ...head, fontSize: 84, color: st.kind === "W" ? C.ink : C.red }}>{st.n}</div>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>{st.kind === "W" ? "WYGRANE" : "PORAŻKI"} Z RZĘDU</div>
            </div>
          ) : (
            <div style={{ textAlign: "right" }}>
              <div style={{ ...head, fontSize: 72 }}>{n1(d.season.avg)}</div>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>ŚREDNIO {d.nounShort} W SEZONIE</div>
            </div>
          )}
        </div>
        {d.teamForm.length > 0 && (
          <div style={{ display: "flex", gap: 4 }}>
            {d.teamForm.map((t, k) => (
              <div key={k} style={{ flex: 1, background: "#fff", borderRadius: 6, padding: "4px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <span style={{ ...head, fontSize: 12, color: t.result === "W" ? C.green : C.red }}>{t.result === "W" ? "W" : "P"}</span>
                <Logo src={t.oppLogo} size={22} />
              </div>
            ))}
          </div>
        )}
        <Card>
          <div style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>{d.player.last} · {sideW} {lineS(L)} {d.nounShort} · OSTATNIE {last7.length}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, margin: "6px 0 8px" }}>
            <span style={{ ...head, fontSize: 64, color: C.orange }}>{h7}<span style={{ color: C.beige }}>/{last7.length}</span></span>
            <span style={{ ...head, fontSize: 20, marginBottom: 6 }}>MECZÓW<br />{sideW} {lineS(L)}</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {last7.map((g, k) => (
              <div key={k} style={{ flex: 1, background: g.hit ? C.green : "#ece6db", color: g.hit ? "#fff" : C.mute, borderRadius: 4, padding: "7px 0", textAlign: "center", ...head, fontSize: 18 }}>{n1(g.value)}</div>
            ))}
          </div>
        </Card>
      </>
    ),
  });

  // 02 rywal
  if (d.opp) {
    const ls = d.oppRecord.lastStreak;
    const max = Math.max(1, ...d.oppAllowed.pts) * 1.12;
    out.push({
      key: "rywal", kicker: "RYWAL", a: "TERAZ", b: (d.opp.short_name || d.opp.abbr).toUpperCase(),
      body: (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Logo src={d.opp.logo} size={96} />
            <div style={{ textAlign: "right" }}>
              <div style={{ ...mono, fontSize: 9, color: C.mute }}>{d.opp.abbr} · BILANS SEZONU</div>
              <div style={{ ...head, fontSize: 76 }}><span style={{ color: C.navy }}>{d.oppRecord.w}</span>–<span style={{ color: C.orange }}>{d.oppRecord.l}</span></div>
              {ls && ls.n >= 2 && <Pill bg={C.navy}>{ls.kind === "W" ? "WYGRALI" : "PRZEGRALI"} OSTATNIE {ls.n}</Pill>}
            </div>
          </div>
          {d.oppAllowed.pts.length > 0 && (
            <Card>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>PUNKTY TRACONE NA MECZ</div>
              <div style={{ ...head, fontSize: 56, color: C.orange, margin: "4px 0" }}>{n1(d.oppAllowed.avg)}</div>
              <div style={{ ...mono, fontSize: 8, color: C.mute, marginBottom: 6 }}>OSTATNIE {d.oppAllowed.pts.length} MECZÓW · KRESKA = ŚREDNIA LIGI {n1(d.oppAllowed.leagueAvg)}</div>
              <div style={{ position: "relative", height: 110, display: "flex", alignItems: "flex-end", gap: 6, borderBottom: `2px solid ${C.ink}` }}>
                {Number.isFinite(d.oppAllowed.leagueAvg) && <div style={{ position: "absolute", left: 0, right: 0, bottom: (d.oppAllowed.leagueAvg / max) * 110, borderTop: `2px dashed ${C.orange}` }} />}
                {d.oppAllowed.pts.map((p, k) => (
                  <div key={k} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ ...head, fontSize: 12 }}>{p}</span>
                    <div style={{ width: "100%", height: (p / max) * 110 - 14, background: p > d.oppAllowed.leagueAvg ? C.orange : C.beige, borderRadius: "3px 3px 0 0" }} />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ),
    });
  }

  // 03 skok
  if (d.prior && Number.isFinite(d.season.avg)) {
    const up = d.season.avg >= d.prior.avg;
    const mx = Math.max(d.season.avg, d.prior.avg) * 1.12 || 1;
    out.push({
      key: "skok", kicker: "SEZON DO SEZONU", a: up ? "JAK DUŻY" : "CO SIĘ", b: up ? "SKOK?" : "ZMIENIŁO?",
      body: (
        <>
          <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Face src={d.player.headshot} size={70} />
            <div>
              <div style={{ ...head, fontSize: 24 }}>{d.player.name}</div>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700, marginTop: 3 }}>{d.team?.name ?? b.teamAbbr}</div>
              <div style={{ ...mono, fontSize: 8, color: C.mute, marginTop: 4 }}>{d.noun} na mecz</div>
            </div>
          </Card>
          {[
            { lbl: "TEN SEZON", v: d.season.avg, n: d.season.n, min: d.season.min, col: C.orange, bar: C.orange },
            { lbl: "POPRZEDNI SEZON", v: d.prior.avg, n: d.prior.n, min: d.prior.min, col: "#5f5b56", bar: "#b8b0a3" },
          ].map((x) => (
            <Card key={x.lbl}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>{x.lbl} · {x.n} MECZÓW</span>
                <Pill>{n1(x.min)} MIN / M</Pill>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, margin: "4px 0 8px" }}>
                <span style={{ ...head, fontSize: 64, color: x.col }}>{n1(x.v)}</span>
                <span style={{ ...mono, fontSize: 8.5, marginBottom: 8 }}>{d.nounShort}<br />NA MECZ</span>
              </div>
              <div style={{ height: 14, background: "#efe9df", borderRadius: 4 }}><div style={{ height: 14, width: `${(x.v / mx) * 100}%`, background: x.bar, borderRadius: 4 }} /></div>
            </Card>
          ))}
        </>
      ),
    });
  }

  // 04 linia — ostatnie 10
  const last10 = d.games.slice(-10);
  const h10 = last10.filter((g) => g.hit).length;
  out.push({
    key: "linia", kicker: "LINIA", a: "OSTATNIE", b: `${last10.length} MECZÓW`,
    body: (
      <>
        <div><Pill style={{ fontSize: 12, padding: "6px 12px" }}>{h10} Z {last10.length} {sideW} {lineS(L)}</Pill></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>{d.player.last} · {d.noun}</span>
          <Pill bg={C.orange}>LINIA {lineS(L)}</Pill>
        </div>
        <div style={{ marginTop: 18 }}><Bars games={last10.map((g) => ({ value: g.value, logo: g.oppLogo, hit: g.hit }))} line={L} side={d.side} height={250} /></div>
      </>
    ),
  });

  // 05 kontekst — ostatnie 2 mecze + kontuzje
  const last2 = d.games.slice(-2);
  out.push({
    key: "kontekst", kicker: "KONTEKST", a: "OSTATNIE", b: "DWA MECZE",
    body: (
      <>
        <div style={{ display: "flex", gap: 10 }}>
          {last2.map((g: StoryGame, k) => (
            <Card key={k} style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...mono, fontSize: 8, fontWeight: 700 }}>{shortDay(g.date)} · {g.home ? "VS" : "@"} {g.opp}</span>
                <Logo src={g.oppLogo} size={18} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, margin: "4px 0" }}>
                <span style={{ ...head, fontSize: 52, color: g.hit ? C.orange : C.ink }}>{n1(g.value)}</span>
                <span style={{ ...mono, fontSize: 7.5, marginBottom: 6 }}>{d.nounShort}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Donut value={g.min} />
                <span style={{ ...mono, fontSize: 7.5, color: C.mute }}>MINUT<br /><b style={{ ...head, fontSize: 14, color: C.ink, letterSpacing: 0 }}>z 48</b></span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ ...head, fontSize: 16 }}>{g.fgm}/{g.fga} <span style={{ ...mono, fontSize: 7 }}>FG</span></span>
                {g.won !== null && <Pill bg={g.won ? C.green : C.red} style={{ fontSize: 8, padding: "3px 6px" }}>{g.won ? "W" : "P"} {g.score}</Pill>}
              </div>
            </Card>
          ))}
        </div>
        <div style={{ background: C.ink, color: "#fff", borderRadius: 10, padding: 14 }}>
          {d.oppOut.length ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ ...mono, fontSize: 8.5, fontWeight: 700, color: C.orange }}>{d.opp?.abbr} · RAPORT KONTUZJI</span>
                <Logo src={d.opp?.logo} size={20} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <Face src={d.oppOut[0].headshot} size={62} />
                <div>
                  <div style={{ ...head, fontSize: 26 }}>{d.oppOut[0].name}</div>
                  <div style={{ ...mono, fontSize: 8, color: "#bdb7ae", marginTop: 4 }}>{d.oppOut[0].status} · {n1(d.oppOut[0].min)} MIN / MECZ</div>
                </div>
              </div>
              {d.oppOut.length > 1 && <div style={{ ...mono, fontSize: 8, color: "#bdb7ae", borderTop: "1px solid #3a3b40", marginTop: 10, paddingTop: 8 }}>TAKŻE: <b style={{ color: "#fff" }}>{d.oppOut.slice(1).map((o) => o.name).join(", ")}</b></div>}
            </>
          ) : d.teamOut.length ? (
            <>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700, color: C.orange }}>{d.team?.abbr} · NIE ZAGRAJĄ</div>
              <div style={{ ...head, fontSize: 20, marginTop: 8 }}>{d.teamOut.slice(0, 3).join(" · ")}</div>
              <div style={{ ...mono, fontSize: 8, color: "#bdb7ae", marginTop: 6 }}>WIĘCEJ MINUT I PIŁEK DLA {d.player.last}</div>
            </>
          ) : (
            <>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700, color: C.orange }}>RAPORT KONTUZJI</div>
              <div style={{ ...head, fontSize: 22, marginTop: 8 }}>BEZ WAŻNYCH NIEOBECNOŚCI</div>
            </>
          )}
        </div>
      </>
    ),
  });

  // 06 mecz — handicap i obrona
  const m = b.assessment.stats?.matchup;
  if (d.line) {
    const sh = d.line.spreadHome;
    const fav = sh === null ? null : sh < 0 ? d.line.homeAbbr : d.line.awayAbbr;
    const homeLogo = d.team?.abbr === d.line.homeAbbr ? d.team?.logo : d.opp?.logo;
    const awayLogo = d.team?.abbr === d.line.homeAbbr ? d.opp?.logo : d.team?.logo;
    const pf = m ? m.statFactor : 1;
    out.push({
      key: "mecz", kicker: "MECZ", a: "TERAZ", b: "MATCHUP",
      body: (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Logo src={awayLogo} size={70} />
            <div style={{ textAlign: "center" }}>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>HANDICAP{fav ? ` · ${fav} FAWORYTEM` : ""}</div>
              <div style={{ ...head, fontSize: 64 }}>{sh === null ? "—" : `-${lineS(Math.abs(sh))}`}</div>
              {d.line.total !== null && <Pill>SUMA {lineS(d.line.total)}</Pill>}
            </div>
            <Logo src={homeLogo} size={70} />
          </div>
          {m && (
            <Card>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700 }}>OBRONA {m.opp}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...head, fontSize: 56, color: (m.oppDrtgRank ?? 15) >= 20 ? C.orange : C.ink }}>{m.oppDrtgRank ?? "—"}.</div>
                  <div style={{ ...mono, fontSize: 7.5, color: C.mute }}>OBRONA W LIDZE<br />(1 = NAJLEPSZA)</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ ...head, fontSize: 56, color: pf > 1.02 ? C.orange : pf < 0.98 ? C.navy : C.ink }}>{pf >= 1 ? "+" : "−"}{Math.round(Math.abs(pf - 1) * 100)}%</div>
                  <div style={{ ...mono, fontSize: 7.5, color: C.mute }}>{d.nounShort} DLA TEJ POZYCJI<br />VS ŚREDNIA LIGI</div>
                </div>
              </div>
              {b.assessment.stats?.likelyDefender && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid #eee", marginTop: 10, paddingTop: 8 }}>
                  <span style={{ ...mono, fontSize: 7.5, color: C.mute }}>NAJPEWNIEJ KRYJE:</span>
                  <span style={{ ...head, fontSize: 16 }}>{b.assessment.stats.likelyDefender.name}</span>
                  <span style={{ ...mono, fontSize: 7.5, color: C.mute }}>{n1(b.assessment.stats.likelyDefender.stl)} PRZ · {n1(b.assessment.stats.likelyDefender.blk)} BL</span>
                </div>
              )}
            </Card>
          )}
        </>
      ),
    });
  }

  // 07 historia z rywalem
  const vs = d.vsOpp.slice(-3);
  const prevVs = (b.assessment.stats?.vsOpp ?? []).slice(-3);
  if (vs.length || prevVs.length) {
    const list = vs.length ? vs.map((g) => ({ value: g.value, hit: g.hit, fgm: g.fgm, fga: g.fga, min: g.min, when: shortDay(g.date) })) : prevVs.map((v) => ({ value: v.value, hit: v.hit, fgm: 0, fga: 0, min: 0, when: v.season === "ten" ? shortDay(v.date) : "POPRZ. SEZON" }));
    const hr = list.filter((x) => x.hit).length / list.length;
    out.push({
      key: "historia", kicker: "HISTORIA", a: `${d.player.last} VS`, b: d.opp?.abbr ?? b.oppAbbr,
      body: (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 22 }}>
            <Face src={d.player.headshot} size={84} />
            <span style={{ ...head, fontSize: 34, color: C.gray }}>VS</span>
            <Logo src={d.opp?.logo} size={84} />
          </div>
          <div style={{ textAlign: "center" }}>
            <Pill bg={hr >= 0.6 ? C.green : hr <= 0.34 ? C.navy : C.ink} style={{ fontSize: 11, padding: "6px 14px" }}>{hr >= 0.6 ? "▲ PASUJE MU TEN RYWAL" : hr <= 0.34 ? "⚠ TRUDNY RYWAL" : "BEZ WYRAŹNEJ REGUŁY"}</Pill>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {list.map((x, k) => (
              <Card key={k} style={{ flex: 1, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ ...mono, fontSize: 7.5, fontWeight: 700 }}>{x.when}</span><Logo src={d.opp?.logo} size={14} /></div>
                <div style={{ ...head, fontSize: 46, color: x.hit ? C.ink : C.red, margin: "4px 0" }}>{n1(x.value)}</div>
                <div style={{ ...mono, fontSize: 7.5, marginBottom: 6 }}>{d.nounShort}</div>
                {x.fga > 0 && <Dots made={x.fgm} att={x.fga} />}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                  {x.fga > 0 ? <span style={{ ...head, fontSize: 15 }}>{x.fgm}/{x.fga} <span style={{ ...mono, fontSize: 6.5 }}>FG</span></span> : <span />}
                  {x.min > 0 && <span style={{ ...mono, fontSize: 7 }}>{x.min} MIN</span>}
                </div>
              </Card>
            ))}
          </div>
        </>
      ),
    });
  }

  // 08 model
  const a = b.assessment;
  const proj = a.stats?.explain?.projection ?? b.projection?.mean ?? null;
  const risk = [...a.risks].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "krytyczne" ? -1 : y.severity === "krytyczne" ? 1 : x.severity === "istotne" ? -1 : 1))[0];
  out.push({
    key: "model", kicker: "MODEL", a: "CO MÓWI", b: "MODEL",
    body: (
      <>
        <div style={{ display: "flex", gap: 10 }}>
          <Card style={{ flex: 1 }}>
            <div style={{ ...mono, fontSize: 8, fontWeight: 700 }}>PROJEKCJA</div>
            <div style={{ ...head, fontSize: 56, color: proj !== null && (proj > L) === (d.side === "over") ? C.orange : C.ink }}>{proj !== null ? n1(proj) : "—"}</div>
            <div style={{ ...mono, fontSize: 7.5, color: C.mute }}>LINIA {lineS(L)}</div>
          </Card>
          <Card style={{ flex: 1 }}>
            <div style={{ ...mono, fontSize: 8, fontWeight: 700 }}>SZANSA</div>
            <div style={{ ...head, fontSize: 56, color: b.modelProb >= 0.58 ? C.green : b.modelProb >= 0.5 ? C.orange : C.red }}>{Math.round(b.modelProb * 100)}%</div>
            <div style={{ ...mono, fontSize: 7.5, color: C.mute }}>KURS ZAKŁADA {Math.round(b.impliedProb * 100)}%</div>
          </Card>
        </div>
        <Card>
          <div style={{ ...mono, fontSize: 8.5, fontWeight: 700, marginBottom: 6 }}>ZA</div>
          {a.pros.slice(0, 3).map((p) => <div key={p} style={{ fontSize: 11.5, lineHeight: 1.35, marginBottom: 5, display: "flex", gap: 6 }}><b style={{ color: C.green }}>✓</b><span>{p}</span></div>)}
          {!a.pros.length && <div style={{ fontSize: 11.5, color: C.mute }}>Brak mocnych argumentów poza samą szansą.</div>}
          {risk && (
            <>
              <div style={{ ...mono, fontSize: 8.5, fontWeight: 700, margin: "8px 0 6px", color: C.red }}>GŁÓWNE RYZYKO</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.35, display: "flex", gap: 6 }}><b style={{ color: C.red }}>✗</b><span>{risk.text}</span></div>
            </>
          )}
        </Card>
      </>
    ),
  });

  // 09 typ
  out.push({
    key: "typ", kicker: "TYP", a: "NASZ", b: "TYP",
    body: (
      <>
        <div style={{ ...mono, fontSize: 9, fontWeight: 700 }}>{d.games.length ? `${h10}/${last10.length} OSTATNICH ${sideW} LINII · SZANSA ${Math.round(b.modelProb * 100)}%` : ""}</div>
        <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}><Face src={d.player.headshot} size={170} badge={d.team?.abbr} /></div>
        <div style={{ background: C.orange, color: "#fff", borderRadius: 10, padding: "16px 16px 14px" }}>
          <div style={{ ...mono, fontSize: 9, fontWeight: 700 }}>NASZ TYP</div>
          <div style={{ ...head, fontSize: 40, marginTop: 6 }}>{d.player.last} <span style={{ color: C.ink }}>{sideW} {lineS(L)}</span></div>
          <div style={{ ...mono, fontSize: 8, marginTop: 8 }}>{d.player.name} · {d.noun} · KURS {b.price.toFixed(2)} ({b.book})</div>
        </div>
        <div style={{ ...mono, fontSize: 7.5, color: C.mute, textAlign: "center" }}>
          {b.playable ? "" : "KURS ORIENTACYJNY (USA) — SPRAWDŹ KURS W POLSKIM BUKMACHERZE · "}NIC NIE JEST PEWNE
        </div>
      </>
    ),
  });
  return out;
}

export function StoryViewer({ d }: { d: StoryData }) {
  const list = slides(d);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const go = useCallback((k: number) => setI((x) => Math.max(0, Math.min(list.length - 1, x + k))), [list.length]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [go]);
  const save = async (idx: number[]) => {
    setBusy(true);
    try {
      for (const k of idx) {
        const el = refs.current[k];
        if (!el) continue;
        const url = await toPng(el, { pixelRatio: 3, cacheBust: false });
        const a = document.createElement("a");
        a.href = url;
        a.download = `nba-edge-${d.player.last.toLowerCase().replace(/\s+/g, "-")}-${String(k + 1).padStart(2, "0")}-${list[k].key}.png`;
        a.click();
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setBusy(false);
    }
  };
  // skala podglądu: zmieść slajd na ekranie telefonu
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const f = () => setScale(Math.min(1.25, (window.innerWidth - 32) / W, (window.innerHeight - 200) / H));
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3">
      <div style={{ width: W * scale, height: H * scale }} className="relative overflow-hidden rounded-2xl shadow-xl">
        {/* paski postępu */}
        <div className="absolute inset-x-2 top-1.5 z-10 flex gap-1" aria-hidden>
          {list.map((_, k) => <span key={k} className="h-1 flex-1 rounded-full" style={{ background: k <= i ? C.orange : "rgba(0,0,0,0.15)" }} />)}
        </div>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: W, height: H }}>
          <div style={{ display: "flex", width: W * list.length, transform: `translateX(${-i * W}px)`, transition: "transform 250ms ease" }}>
            {list.map((s, k) => (
              <div key={s.key} ref={(el) => { refs.current[k] = el; }} style={{ width: W, height: H, flexShrink: 0 }}>
                <Frame d={d} i={k} total={list.length} kicker={s.kicker} a={s.a} b={s.b}>{s.body}</Frame>
              </div>
            ))}
          </div>
        </div>
        <button type="button" aria-label="Poprzedni slajd" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/3" />
        <button type="button" aria-label="Następny slajd" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-1/3" />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <button type="button" onClick={() => go(-1)} disabled={i === 0} className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40">←</button>
        <span className="num text-ink-3">{i + 1} / {list.length}</span>
        <button type="button" onClick={() => go(1)} disabled={i === list.length - 1} className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40">→</button>
        <button type="button" disabled={busy} onClick={() => save([i])} className="rounded-lg bg-accent px-3 py-1.5 font-bold text-black disabled:opacity-50">{busy ? "Zapisuję…" : "Pobierz slajd (PNG)"}</button>
        <button type="button" disabled={busy} onClick={() => save(list.map((_, k) => k))} className="rounded-lg border border-line px-3 py-1.5 font-semibold disabled:opacity-50">Pobierz wszystkie</button>
      </div>
    </div>
  );
}
