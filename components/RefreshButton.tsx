"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Odświeża dane strony (np. wyniki na żywo) bez przeładowania. */
export function RefreshButton({ label = "Odśwież wyniki" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => router.refresh())} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-black disabled:opacity-50">
      {pending ? "Odświeżam…" : `↻ ${label}`}
    </button>
  );
}
