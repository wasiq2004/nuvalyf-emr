"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the current server page on an interval (live boards like the queue). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
