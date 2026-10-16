"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Something went wrong</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        An unexpected error occurred. Please try again. If the problem continues, contact your
        administrator{error.digest ? ` and mention reference ${error.digest}` : ""}.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
