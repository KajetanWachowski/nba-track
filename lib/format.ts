/** Formatting helpers shared by server and client components. */
export const pct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`;
export const signedPct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
export const pp = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)} pp`;
export const dec = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(2));
export const num = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d);
export function american(d: number | null | undefined) {
  if (!d || d <= 1) return "—";
  const a = d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
  return a > 0 ? `+${a}` : String(a);
}
const PL = "pl-PL";
const WAW = "Europe/Warsaw";
/** Godzina rozpoczęcia meczu w czasie polskim, np. „śr 02:00”. */
export function tipTime(iso: string) {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat(PL, { timeZone: WAW, weekday: "short" }).format(d);
  const hm = new Intl.DateTimeFormat(PL, { timeZone: WAW, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${wd} ${hm}`;
}
export function shortDate(iso: string) {
  return new Intl.DateTimeFormat(PL, { timeZone: WAW, day: "numeric", month: "short" }).format(new Date(iso));
}
/** Data i godzina, np. „11 lis, 14:05”. */
export function dateTime(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(PL, { timeZone: WAW, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
/** Dzień meczowy NBA (kalendarz USA) opisany po polsku, np. „wt., 10 lis”. */
export function dayLabel(day: string) {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), 12));
  return new Intl.DateTimeFormat(PL, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
}
export function ago(ms: number | null | undefined) {
  if (!ms) return "nigdy";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "przed chwilą";
  if (s < 3600) return `${Math.round(s / 60)} min temu`;
  if (s < 86400) return `${Math.round(s / 3600)} godz. temu`;
  return `${Math.round(s / 86400)} dni temu`;
}
