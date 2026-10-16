import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-(--accent-solid)">404</p>
      <h1 className="text-3xl font-semibold text-zinc-900 dark:text-white">Page not found</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        The page you are looking for does not exist or has moved.
      </p>
      <Button asChild>
        <Link href="/">Go to my dashboard</Link>
      </Button>
    </div>
  );
}
