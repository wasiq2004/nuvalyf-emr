import Link from "next/link";
import { ArrowLeft, Undo2 } from "lucide-react";
import { PageHeader, PageShell } from "@/components/app/page";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { todayInTimeZone } from "@/lib/time";
import { OldBillReturn } from "./OldBillReturn";

export const metadata = { title: "Return on an old bill" };

export default async function OldBillReturnPage() {
  const ctx = await requireClinic({ permission: "pharmacy:return", module: "pharmacy" });
  return (
    <PageShell width="default">
      <Link href="/pharmacy" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Pharmacy
      </Link>
      <PageHeader icon={Undo2} title="Return on an old bill" description="For something sold before you moved to NuvaLyf, on a bill from the old software. For a NuvaLyf bill, open the sale instead." />
      <OldBillReturn today={todayInTimeZone(ctx.timezone)} canSetCredit={can(ctx, "accounts:manage")} />
    </PageShell>
  );
}
