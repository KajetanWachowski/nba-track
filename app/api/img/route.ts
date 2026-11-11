/**
 * Pośrednik obrazków (zdjęcia zawodników, loga) — żeby grafiki „Historii typu” dało się zapisać jako PNG
 * (przeglądarka nie pozwala eksportować obrazków z innej domeny). Tylko serwery ESPN.
 */
const ALLOWED = new Set(["a.espncdn.com"]);

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  let target: URL;
  try {
    target = new URL(u ?? "");
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED.has(target.hostname)) return new Response("host not allowed", { status: 403 });
  const r = await fetch(target, { cache: "force-cache" }).catch(() => null);
  if (!r || !r.ok) return new Response("not found", { status: 404 });
  const type = r.headers.get("content-type") ?? "image/png";
  if (!type.startsWith("image/")) return new Response("not an image", { status: 415 });
  return new Response(await r.arrayBuffer(), { headers: { "content-type": type, "cache-control": "public, max-age=604800" } });
}
