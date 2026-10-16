// Shared pieces for the analytics screens. A suppressed count is shown as
// "<threshold", never as a number.
import { TabNav } from "@/components/app/tabs";
import { cn } from "@/lib/utils";

export function Count({ value, threshold, className }: { value: number | null; threshold: number; className?: string }) {
  if (value === null) {
    return (
      <span className={cn("text-zinc-400", className)} title={`Fewer than ${threshold}: hidden to protect privacy`}>
        &lt;{threshold}
      </span>
    );
  }
  return <span className={cn("tabular-nums", className)}>{value.toLocaleString()}</span>;
}

export function SuppressionNote({ suppressed, threshold }: { suppressed: number; threshold: number }) {
  if (suppressed === 0) return null;
  return (
    <p className="text-xs text-zinc-500">
      {suppressed} {suppressed === 1 ? "count is" : "counts are"} below {threshold} and hidden. Totals are not shown next to hidden counts.
    </p>
  );
}

export function AnalyticsTabs({ active }: { active: "overview" | "cohorts" | "quality" }) {
  return (
    <TabNav
      label="Analytics"
      active={active}
      tabs={[
        { key: "overview", label: "Overview", href: "/analytics" },
        { key: "cohorts", label: "Cohorts", href: "/analytics/cohorts" },
        { key: "quality", label: "Data quality", href: "/analytics/quality" },
      ]}
    />
  );
}
