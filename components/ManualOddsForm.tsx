"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const MARKETS: { key: string; label: string; kind: "player" | "yes" | "ml" | "spread" | "total" }[] = [
  { key: "pts", label: "Punkty", kind: "player" },
  { key: "reb", label: "Zbiórki", kind: "player" },
  { key: "ast", label: "Asysty", kind: "player" },
  { key: "pra", label: "Pkt+Zb+As (PRA)", kind: "player" },
  { key: "pr", label: "Pkt+Zb", kind: "player" },
  { key: "pa", label: "Pkt+As", kind: "player" },
  { key: "ra", label: "Zb+As", kind: "player" },
  { key: "fg3m", label: "Trójki", kind: "player" },
  { key: "stl", label: "Przechwyty", kind: "player" },
  { key: "blk", label: "Bloki", kind: "player" },
  { key: "tov", label: "Straty", kind: "player" },
  { key: "stocks", label: "Przechwyty+Bloki", kind: "player" },
  { key: "dd", label: "Double-double", kind: "yes" },
  { key: "td", label: "Triple-double", kind: "yes" },
  { key: "ml", label: "Zwycięzca meczu", kind: "ml" },
  { key: "spread", label: "Handicap", kind: "spread" },
  { key: "total", label: "Suma punktów", kind: "total" },
];

export interface FormGame {
  id: string;
  label: string;
  home: string;
  away: string;
  players: { id: string; name: string; team: string }[];
  /** DraftKings lines by `${market}|${athleteId}` — prefills the line */
  dkLines: Record<string, number>;
}

export function ManualOddsForm({ games, books, initialGame }: { games: FormGame[]; books: { key: string; title: string }[]; initialGame?: string }) {
  const router = useRouter();
  const [gameId, setGameId] = useState(initialGame ?? games[0]?.id ?? "");
  const [market, setMarket] = useState("pts");
  const [player, setPlayer] = useState("");
  const [line, setLine] = useState("");
  const [prices, setPrices] = useState<Record<string, { over: string; under: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const g = games.find((x) => x.id === gameId);
  const m = MARKETS.find((x) => x.key === market)!;
  const sides = m.kind === "ml" ? [`${g?.home} (gosp.)`, `${g?.away} (gość)`] : m.kind === "spread" ? [`${g?.home} (gosp.)`, `${g?.away} (gość)`] : m.kind === "yes" ? ["Tak", "Nie"] : ["Powyżej", "Poniżej"];
  const players = useMemo(() => [...(g?.players ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [g]);

  const pickPlayer = (id: string) => {
    setPlayer(id);
    const dk = g?.dkLines[`${market}|${id}`];
    if (dk !== undefined && !line) setLine(String(dk));
  };
  const pickMarket = (k: string) => {
    setMarket(k);
    const dk = g?.dkLines[`${k}|${["ml", "spread", "total"].includes(k) ? "game" : player}`];
    setLine(dk !== undefined ? String(dk) : "");
  };

  const input = "w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm";
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const r = await fetch("/api/manual-odds", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              gameId, market, subjectId: player, line,
              prices: books.map((b) => ({ book: b.key, over: prices[b.key]?.over || null, under: prices[b.key]?.under || null })),
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          setMsg({ ok: true, text: j.message });
          setPrices({});
          router.refresh();
        } catch (err) {
          setMsg({ ok: false, text: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1"><span className="label">Mecz</span>
          <select className={input} value={gameId} onChange={(e) => { setGameId(e.target.value); setPlayer(""); setLine(""); }}>
            {games.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="label">Rynek</span>
          <select className={input} value={market} onChange={(e) => pickMarket(e.target.value)}>
            {MARKETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        {(m.kind === "player" || m.kind === "yes") && (
          <label className="flex flex-col gap-1"><span className="label">Zawodnik</span>
            <select className={input} value={player} onChange={(e) => pickPlayer(e.target.value)} required>
              <option value="">— wybierz —</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.team})</option>)}
            </select>
          </label>
        )}
        {m.kind !== "ml" && m.kind !== "yes" && (
          <label className="flex flex-col gap-1"><span className="label">{m.kind === "spread" ? `Linia dla ${g?.home} (np. -8.5)` : "Linia (np. 11.5)"}</span>
            <input className={input} inputMode="decimal" value={line} onChange={(e) => setLine(e.target.value)} required placeholder="11.5" />
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead><tr className="label text-left"><th className="py-1">Bukmacher</th><th>{sides[0]}</th><th>{sides[1]}</th></tr></thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.key} className="border-t border-line">
                <td className="py-2 pr-3 font-semibold">{b.title}</td>
                {(["over", "under"] as const).map((side) => (
                  <td key={side} className="pr-2">
                    <input
                      className={`${input} num`}
                      inputMode="decimal"
                      placeholder="np. 1.85"
                      value={prices[b.key]?.[side] ?? ""}
                      onChange={(e) => setPrices({ ...prices, [b.key]: { over: prices[b.key]?.over ?? "", under: prices[b.key]?.under ?? "", [side]: e.target.value } })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? "Zapisuję…" : "Zapisz kursy"}</button>
        <span className="text-xs text-ink-3">Kursy dziesiętne. Wpisanie obu stron pozwala policzyć prawdopodobieństwo bez marży dla tego bukmachera.</span>
        {msg && <span className={`text-sm ${msg.ok ? "text-pos" : "text-neg"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function DeleteManualButton({ q }: { q: string }) {
  const router = useRouter();
  return (
    <button type="button" className="text-xs text-ink-3 hover:text-neg" onClick={async () => { await fetch(`/api/manual-odds?${q}`, { method: "DELETE" }); router.refresh(); }}>
      usuń
    </button>
  );
}
