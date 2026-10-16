// The NuvaLyf wordmark and stethoscope mark. The wordmark swaps to its
// white-lettered version in dark mode. Images are served as hashed static
// files (no image optimiser needed, allowed by the CSP's img-src 'self').
import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import logo from "@/public/brand/nuvalyf-logo.png";
import logoOnDark from "@/public/brand/nuvalyf-logo-on-dark.png";
import mark from "@/public/brand/nuvalyf-mark.png";

/** Full wordmark. Size it with a height class, e.g. "h-10". */
export function BrandLogo({ className, priority }: { className?: string; priority?: boolean }) {
  const size = cn("w-auto", className);
  return (
    <>
      <Image src={logo} alt={BRAND.name} unoptimized priority={priority} className={cn(size, "dark:hidden")} />
      <Image src={logoOnDark} alt={BRAND.name} unoptimized priority={priority} className={cn(size, "hidden dark:block")} />
    </>
  );
}

/** The stethoscope mark on a neutral tile, for the sidebar. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-100",
        className,
      )}
    >
      <Image src={mark} alt={BRAND.name} unoptimized className="h-7 w-7" />
    </div>
  );
}
