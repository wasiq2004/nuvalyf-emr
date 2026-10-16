// Shared pieces of the compliance pages (server components).
import { StatusBadge, type BadgeTone } from "@/components/app/status-badge";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/styles";
import { humanizeAction } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditCategory, AuditFilters } from "@/features/audit/audit-rules";

const CATEGORY_TONE: Record<AuditCategory, BadgeTone> = {
  access: "accent",
  clinical: "info",
  billing: "neutral",
  pharmacy: "neutral",
  "front desk": "neutral",
  "sign-in": "neutral",
  administration: "neutral",
  security: "danger",
};

export function ActionCell({ action, category }: { action: string; category: AuditCategory }) {
  return (
    <div>
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{humanizeAction(action)}</p>
      <StatusBadge tone={CATEGORY_TONE[category]} className="mt-1">
        {category}
      </StatusBadge>
    </div>
  );
}

export function OutcomeBadge({ outcome, severity }: { outcome: string; severity: string }) {
  if (outcome === "denied") return <StatusBadge tone="danger">Denied</StatusBadge>;
  if (outcome === "error") return <StatusBadge tone="warning">Error</StatusBadge>;
  if (severity === "critical") return <StatusBadge tone="danger">Critical</StatusBadge>;
  if (severity === "warning") return <StatusBadge tone="warning">Warning</StatusBadge>;
  return <StatusBadge tone="success">OK</StatusBadge>;
}

export function DetailsCell({ details }: { details: Record<string, unknown> | null }) {
  if (!details || Object.keys(details).length === 0) return <span className="text-zinc-400">—</span>;
  if ("withheld" in details) return <span className="text-xs italic text-zinc-500">Clinical details withheld</span>;
  const { withheldFields, ...shown } = details as Record<string, unknown> & { withheldFields?: number };
  const note = withheldFields ? <span className="block text-xs italic text-zinc-500">{String(withheldFields)} free-text {withheldFields === 1 ? "field" : "fields"} withheld</span> : null;
  if (Object.keys(shown).length === 0) return note ?? <span className="text-zinc-400">—</span>;
  details = shown;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-(--accent-text)">Details</summary>
      <dl className="mt-2 space-y-1">
        {Object.entries(details).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <dt className="font-medium text-zinc-500">{key}</dt>
            <dd className="break-all text-zinc-800 dark:text-zinc-200">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
      {note}
    </details>
  );
}

const labelClass = "block text-xs font-semibold uppercase tracking-wider text-zinc-500";

/** GET form: filters live in the URL, so a search can be bookmarked and shared. */
export function AuditFilterForm({
  filters,
  staff,
  actions,
  resetHref,
}: {
  filters: AuditFilters;
  staff: { id: string; name: string }[];
  actions: string[];
  resetHref: string;
}) {
  return (
    <form role="search" aria-label="Filter the audit trail" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className={labelClass}>
        From
        <input type="date" name="from" defaultValue={filters.from} className={cn(inputClass, "mt-1.5 h-10 normal-case tracking-normal")} />
      </label>
      <label className={labelClass}>
        To
        <input type="date" name="to" defaultValue={filters.to} className={cn(inputClass, "mt-1.5 h-10 normal-case tracking-normal")} />
      </label>
      <label className={labelClass}>
        Person
        <select name="actor" defaultValue={filters.actorId ?? ""} className={cn(inputClass, "mt-1.5 h-10 normal-case tracking-normal")}>
          <option value="">Everyone</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Patient record no.
        <input name="mrn" defaultValue={filters.patientMrn ?? ""} placeholder="e.g. P-000123" className={cn(inputClass, "mt-1.5 h-10 font-mono normal-case tracking-normal")} />
      </label>
      <label className={labelClass}>
        Event
        <select name="action" defaultValue={filters.action ?? ""} className={cn(inputClass, "mt-1.5 h-10 normal-case tracking-normal")}>
          <option value="">Any event</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {humanizeAction(a)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Outcome
        <select name="outcome" defaultValue={filters.outcome ?? ""} className={cn(inputClass, "mt-1.5 h-10 normal-case tracking-normal")}>
          <option value="">Any</option>
          <option value="success">Succeeded</option>
          <option value="denied">Denied</option>
          <option value="error">Error</option>
        </select>
      </label>
      <label className={labelClass}>
        Severity
        <select name="severity" defaultValue={filters.severity ?? ""} className={cn(inputClass, "mt-1.5 h-10 normal-case tracking-normal")}>
          <option value="">Any</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button type="submit" className={buttonClass("primary", "md", "flex-1")}>
          Apply
        </button>
        <a href={resetHref} className={buttonClass("secondary", "md")}>
          Reset
        </a>
      </div>
    </form>
  );
}
