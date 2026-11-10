"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page periodically so odds, injuries and projections stay current. */
export function AutoRefresh({ seconds = 300 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
