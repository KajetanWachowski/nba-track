"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** POSTs to an API route and refreshes the page; shows the JSON summary or error. */
export function ActionButton({ endpoint, label, body, note }: { endpoint: string; label: string; body?: Record<string, unknown>; note?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          setMsg("");
          try {
            const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? r.statusText);
            setMsg(j.message ?? "Done");
            setState("done");
            router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
            setState("error");
          }
        }}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
      >
        {state === "busy" ? "Working…" : label}
      </button>
      {note && state === "idle" && <span className="text-xs text-ink-3">{note}</span>}
      {msg && <span className={`text-xs ${state === "error" ? "text-neg" : "text-ink-2"}`}>{msg}</span>}
    </div>
  );
}
