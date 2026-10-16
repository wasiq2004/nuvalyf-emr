import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";

export default function Forbidden() {
  return (
    <div className="accent-page flex min-h-full flex-col items-center justify-center gap-4 p-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
        <ShieldAlert className="h-7 w-7 text-red-600" aria-hidden />
      </div>
      <p className="text-sm font-semibold uppercase tracking-widest text-red-600">403</p>
      <h1 className="text-3xl font-semibold text-zinc-900 dark:text-white">Not available for your role</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Your account does not have access to this page, or it is not part of your clinic&apos;s plan. The attempt has
        been recorded.
      </p>
      <Link href="/" className={buttonClass("primary", "md")}>
        Back to my home page
      </Link>
    </div>
  );
}
