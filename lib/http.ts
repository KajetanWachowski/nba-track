import { getDb } from "./db";

export class DataUnavailableError extends Error {
  constructor(public source: string, message: string, public status?: number) {
    super(`${source}: ${message}`);
  }
}

export interface Fetched<T> {
  data: T;
  fetchedAt: number; // epoch ms
  fromCache: boolean;
  stale: boolean; // true when the network failed and an older cached copy was served
}

interface FetchOpts {
  /** seconds; Infinity = never refetch once cached (immutable resources such as finished games). */
  ttl: number;
  source: string;
  /** cache key override (e.g. to strip an API key from the URL) */
  key?: string;
  timeoutMs?: number;
  retries?: number;
  force?: boolean;
  headers?: Record<string, string>;
}

const inflight = new Map<string, Promise<Fetched<unknown>>>();

/**
 * JSON GET with SQLite-backed cache, retries with backoff, and stale-on-error fallback.
 * Never fabricates data: if both network and cache fail, it throws DataUnavailableError.
 */
export async function fetchJson<T>(url: string, opts: FetchOpts): Promise<Fetched<T>> {
  const key = opts.key ?? url;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<Fetched<T>>;
  const p = doFetch<T>(url, key, opts).finally(() => inflight.delete(key));
  inflight.set(key, p as Promise<Fetched<unknown>>);
  return p;
}

async function doFetch<T>(url: string, key: string, opts: FetchOpts): Promise<Fetched<T>> {
  const db = getDb();
  const row = db.prepare("SELECT body, fetched_at FROM http_cache WHERE key = ?").get(key) as
    | { body: string; fetched_at: number }
    | undefined;
  const now = Date.now();
  if (row && !opts.force && (opts.ttl === Infinity || now - row.fetched_at < opts.ttl * 1000)) {
    return { data: JSON.parse(row.body) as T, fetchedAt: row.fetched_at, fromCache: true, stale: false };
  }

  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", ...(opts.headers ?? {}) } });
      clearTimeout(timer);
      if (res.status === 404) throw new DataUnavailableError(opts.source, "not found (404)", 404);
      if (res.status === 401 || res.status === 403)
        throw new DataUnavailableError(opts.source, `unauthorized (${res.status})`, res.status);
      if (!res.ok) {
        // surface the provider's own explanation (e.g. {"error":{"message":…,"details":…}})
        const body = await res.text().catch(() => "");
        let detail = "";
        try {
          const j = JSON.parse(body);
          const e = j.error ?? j;
          detail = [typeof e === "string" ? e : e.message, e.details ?? j.details ?? j.code].filter((x) => typeof x === "string").join(" — ");
        } catch {
          detail = body.slice(0, 160);
        }
        const msg = `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
        // other 4xx (bad request, plan limits) cannot succeed on retry; 429 and 5xx can
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new DataUnavailableError(opts.source, msg, res.status);
        throw new Error(msg);
      }
      const text = await res.text();
      const data = JSON.parse(text) as T;
      db.prepare(
        "INSERT INTO http_cache(key, body, status, fetched_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, status=excluded.status, fetched_at=excluded.fetched_at",
      ).run(key, text, res.status, now);
      return { data, fetchedAt: now, fromCache: false, stale: false };
    } catch (e) {
      lastErr = e;
      if (e instanceof DataUnavailableError) break; // not retryable
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  if (row) {
    return { data: JSON.parse(row.body) as T, fetchedAt: row.fetched_at, fromCache: true, stale: true };
  }
  if (lastErr instanceof DataUnavailableError) throw lastErr;
  throw new DataUnavailableError(opts.source, lastErr instanceof Error ? lastErr.message : String(lastErr));
}

/** Run async tasks with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
