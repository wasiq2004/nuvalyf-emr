// Shared frame for sign-in and password screens (clinic and console).
import { ShieldCheck } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { BrandLogo } from "./brand";
import type { Accent } from "./app-shell";

export function AuthLayout({
  accent,
  badge,
  heading,
  subheading,
  footnote,
  title,
  description,
  children,
}: {
  accent: Accent;
  badge: string;
  heading: React.ReactNode;
  subheading: string;
  footnote?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-accent={accent} className="accent-page relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="absolute inset-0 bg-[radial-gradient(#0b7a7814_1px,transparent_1px)] [background-size:40px_40px]" aria-hidden />

      <div className="relative grid w-full max-w-6xl items-center gap-8 lg:grid-cols-12">
        <div className="hidden flex-col justify-between p-10 lg:col-span-7 lg:flex lg:min-h-[600px]">
          <div>
            <div>
              <BrandLogo className="h-14" priority />
              <p className="mt-2 pl-1 text-sm text-zinc-500 dark:text-zinc-400">{BRAND.tagline}</p>
            </div>

            <div className="mt-20 max-w-lg">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/70 px-4 py-1.5 backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/70">
                <ShieldCheck className="h-4 w-4 text-(--accent-text)" aria-hidden />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{badge}</span>
              </div>
              <h2 className="text-5xl font-semibold leading-tight tracking-tighter text-zinc-900 dark:text-white">{heading}</h2>
              <p className="mt-6 max-w-md text-lg text-zinc-600 dark:text-zinc-400">{subheading}</p>
            </div>
          </div>
          {footnote && <div className="text-sm text-zinc-500 dark:text-zinc-400">{footnote}</div>}
        </div>

        <div className="flex justify-center lg:col-span-5">
          <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/95 p-8 shadow-2xl backdrop-blur-2xl sm:p-10 dark:border-zinc-800 dark:bg-zinc-900/95">
            <div className="mb-8 space-y-2 text-center">
              <div className="mb-6 flex justify-center lg:hidden">
                <BrandLogo className="h-10" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">{title}</h1>
              {description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Notice({ tone = "warning", children }: { tone?: "warning" | "info"; children: React.ReactNode }) {
  const styles =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      : "border-(--accent-soft-border) bg-(--accent-soft) text-(--accent-text)";
  return <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}
