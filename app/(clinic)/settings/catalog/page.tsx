import { forbidden } from "next/navigation";
import { BookOpenCheck, FlaskConical, HeartPulse, Pill, Search, ShieldAlert, Sparkles, Stethoscope, Zap } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { TabNav, type TabItem } from "@/components/app/tabs";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/styles";
import { can, hasModule, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { missingStarterCounts, type CatalogSection } from "@/lib/catalog/seed";
import { cn } from "@/lib/utils";
import {
  listAllergyClasses,
  listDiagnosisCodes,
  listDrugs,
  listGenericNames,
  listInteractions,
  listLabTests,
  listPresetsForEdit,
  listVitalRanges,
} from "@/features/catalog/catalog.service";
import { PRESET_KIND_LABELS } from "@/features/catalog/catalog-options";
import { VITAL_FIELDS } from "@/features/clinical/vital-rules";
import { getClinicSettings } from "@/features/settings/settings.service";
import { ItemTypeBadge } from "@/components/pharmacy/item-picker";
import { packWord } from "@/features/pharmacy/selling-rules";
import {
  AllergyClassDialog,
  DiagnosisCodeDialog,
  DrugActiveToggle,
  DrugDialog,
  EntryActiveToggle,
  FavouriteToggle,
  ImportStarterButton,
  InteractionDialog,
  LabTestDialog,
  PresetDialog,
  VitalRangeDialog,
} from "./CatalogForms";

export const metadata = { title: "Medicines & catalogues" };

const TAB_KEYS = ["medicines", "interactions", "allergies", "presets", "diagnoses", "vitals", "lab"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const SECTION_FOR_TAB: Record<TabKey, CatalogSection[]> = {
  medicines: ["drugs"],
  interactions: ["interactions"],
  allergies: ["allergyClasses"],
  presets: ["presets"],
  diagnoses: ["diagnoses"],
  vitals: ["vitalRanges"],
  lab: ["labTests"],
};

const SEVERITY_TONE = { minor: "neutral", moderate: "warning", major: "danger", contraindicated: "danger" } as const;
const VITAL_LABEL = Object.fromEntries(VITAL_FIELDS.map((f) => [f.key, `${f.label} (${f.unit})`]));

function Inactive({ active }: { active: boolean }) {
  return active ? null : <StatusBadge>Inactive</StatusBadge>;
}

function SearchBox({ tab, q, placeholder }: { tab: string; q: string; placeholder: string }) {
  return (
    <form role="search" className="flex gap-2">
      <input type="hidden" name="tab" value={tab} />
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input type="search" name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} className={cn(inputClass, "h-10 pl-10")} />
      </div>
      <button type="submit" className={buttonClass("secondary", "md")}>
        Search
      </button>
    </form>
  );
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await requireClinic();
  const canMedicines = can(ctx, "medicine:manage");
  const canCatalog = can(ctx, "catalog:manage");
  if (!canMedicines && !canCatalog) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["medicine:manage", "catalog:manage"], path: "/settings/catalog" });
    forbidden();
  }

  const { tab: rawTab, q: rawQ = "" } = await searchParams;
  const q = rawQ.trim().slice(0, 100);
  const available: TabKey[] = TAB_KEYS.filter((key) => {
    if (key === "medicines") return canMedicines;
    if (key === "lab") return canCatalog && hasModule(ctx, "lab");
    return canCatalog;
  });
  const tab: TabKey = (available as string[]).includes(rawTab ?? "") ? (rawTab as TabKey) : available[0];
  const scope = { clinicId: ctx.clinicId, userId: ctx.userId };

  const data = await withClinic(scope, async (tx) => {
    const missing = canCatalog ? await missingStarterCounts(tx, ctx.clinicId) : null;
    const classes = tab === "medicines" || tab === "allergies" ? await listAllergyClasses(tx) : [];
    switch (tab) {
      case "medicines":
        return { kind: "medicines" as const, missing, classes, drugs: await listDrugs(tx, q), currency: (await getClinicSettings(tx, ctx.clinicId)).currency };
      case "interactions":
        return { kind: "interactions" as const, missing, classes, interactions: await listInteractions(tx), generics: await listGenericNames(tx) };
      case "allergies":
        return { kind: "allergies" as const, missing, classes };
      case "presets":
        return { kind: "presets" as const, missing, classes, presets: await listPresetsForEdit(tx) };
      case "diagnoses":
        return { kind: "diagnoses" as const, missing, classes, codes: await listDiagnosisCodes(tx, q) };
      case "vitals":
        return { kind: "vitals" as const, missing, classes, ranges: await listVitalRanges(tx) };
      case "lab":
        return { kind: "lab" as const, missing, classes, tests: await listLabTests(tx), currency: (await getClinicSettings(tx, ctx.clinicId)).currency };
    }
  });

  const missingTotal = data.missing ? Object.values(data.missing).reduce((a, b) => a + b, 0) : 0;
  const activeClasses = data.classes.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }));

  const LABELS: Record<TabKey, string> = {
    medicines: "Medicines & supplies",
    interactions: "Interactions",
    allergies: "Allergy classes",
    presets: "Prescribing presets",
    diagnoses: "Diagnosis codes",
    vitals: "Vital ranges",
    lab: "Lab tests",
  };
  const tabs: TabItem[] = available.map((key) => {
    const missing = data.missing ? SECTION_FOR_TAB[key].reduce((n, s) => n + data.missing![s], 0) : 0;
    return {
      key,
      label: LABELS[key],
      href: `/settings/catalog?tab=${key}`,
      badge: missing > 0 ? <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{missing}</span> : undefined,
    };
  });

  return (
    <PageShell>
      <PageHeader
        icon={Pill}
        title="Medicines & catalogues"
        description="Your clinic's own copy of the starter lists. Add, edit or deactivate anything: entries are never deleted, so past records stay intact."
      />

      {canCatalog && missingTotal > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              <span className="font-semibold">New starter entries are available.</span> Importing adds only what you don&apos;t have; your own changes stay as they are.
            </span>
          </p>
          <ImportStarterButton count={missingTotal} />
        </div>
      )}

      <TabNav label="Catalogue sections" tabs={tabs} active={tab} />

      {data.kind === "medicines" && (
        <Panel
          flush
          title="Medicines & supplies"
          description="Everything the clinic stocks. Medicines can be prescribed (defaults pre-fill the prescription; allergy classes drive the allergy check); consumables and instruments are stocked and sold."
          actions={<DrugDialog classes={activeClasses} />}
        >
          <div className="px-6 pb-4 pt-2 lg:px-8">
            <SearchBox tab="medicines" q={q} placeholder="Search name, other name, generic, maker or category" />
          </div>
          <DataTable
            rows={data.drugs}
            rowKey={(d) => d.id}
            empty={<EmptyState icon={Pill} title={q ? "Nothing matches" : "No items yet"} />}
            columns={[
              {
                key: "name",
                header: "Item",
                cell: (d) => (
                  <div className={cn(!d.isActive && "opacity-60")}>
                    <p className="flex flex-wrap items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                      {d.name} <ItemTypeBadge type={d.itemType} /> <Inactive active={d.isActive} />
                    </p>
                    <p className="text-xs text-zinc-500">
                      {[d.itemType === "medicine" ? d.genericName : null, d.itemType === "medicine" ? d.form : null, d.strength, d.manufacturer].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {d.aliases.length > 0 && <p className="text-xs text-zinc-500">Also: {d.aliases.map((a) => a.alias).join(", ")}</p>}
                  </div>
                ),
              },
              { key: "category", header: "Category", hideOnMobile: true, cell: (d) => d.category ?? "—" },
              {
                key: "defaults",
                header: "Default",
                hideOnMobile: true,
                cell: (d) => [d.defaultDose, d.defaultFrequency, d.defaultDurationDays ? `${d.defaultDurationDays} d` : null].filter(Boolean).join(" · ") || "—",
              },
              {
                key: "classes",
                header: "Allergy classes",
                hideOnMobile: true,
                cell: (d) => (d.classes.length ? d.classes.map((c) => c.name).join(", ") : "—"),
              },
              {
                key: "price",
                header: "Price",
                hideOnMobile: true,
                cell: (d) => (
                  <span className="tabular-nums">
                    {d.price ? formatMoney(d.price, data.currency) : "—"}
                    {d.packSize > 1 && d.packPrice && (
                      <span className="block text-xs text-zinc-500">
                        {formatMoney(d.packPrice, data.currency)} / {packWord(d.form)} of {d.packSize}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (d) => (
                  <div className="flex justify-end gap-1">
                    <DrugDialog
                      classes={activeClasses}
                      values={{
                        id: d.id,
                        itemType: d.itemType,
                        name: d.name,
                        genericName: d.genericName,
                        form: d.form,
                        strength: d.strength ?? "",
                        category: d.category ?? "",
                        manufacturer: d.manufacturer ?? "",
                        packSize: String(d.packSize),
                        defaultDose: d.defaultDose ?? "",
                        defaultFrequency: d.defaultFrequency ?? "",
                        defaultDurationDays: d.defaultDurationDays ? String(d.defaultDurationDays) : "",
                        defaultInstructions: d.defaultInstructions ?? "",
                        price: d.price ?? "",
                        packPrice: d.packPrice ?? "",
                        allergyClassIds: d.classes.map((c) => c.id),
                        aliases: d.aliases.map((a) => ({ id: a.id, alias: a.alias })),
                      }}
                    />
                    <DrugActiveToggle id={d.id} name={d.name} isActive={d.isActive} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {data.kind === "interactions" && (
        <Panel
          flush
          title="Interaction rules"
          description="Checked live as each medicine is added to a prescription."
          actions={<InteractionDialog generics={data.generics} />}
        >
          <DataTable
            rows={data.interactions}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={Zap} title="No interaction rules" />}
            columns={[
              {
                key: "pair",
                header: "Medicines",
                cell: (r) => (
                  <p className={cn("flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100", !r.isActive && "opacity-60")}>
                    {r.genericA} + {r.genericB} <Inactive active={r.isActive} />
                  </p>
                ),
              },
              {
                key: "severity",
                header: "Severity",
                cell: (r) => <StatusBadge tone={SEVERITY_TONE[r.severity as keyof typeof SEVERITY_TONE] ?? "neutral"}>{r.severity}</StatusBadge>,
              },
              { key: "what", header: "What happens", hideOnMobile: true, cell: (r) => <span className="text-sm">{r.description}</span> },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (r) => (
                  <div className="flex justify-end gap-1">
                    <InteractionDialog generics={data.generics} values={{ id: r.id, genericA: r.genericA, genericB: r.genericB, severity: r.severity, description: r.description }} />
                    <EntryActiveToggle kind="interaction" id={r.id} name={`${r.genericA} + ${r.genericB}`} isActive={r.isActive} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {data.kind === "allergies" && (
        <Panel flush title="Allergy classes" description="Map medicines to classes on the Medicines tab; an allergy to a class warns for every medicine in it." actions={<AllergyClassDialog />}>
          <DataTable
            rows={data.classes}
            rowKey={(c) => c.id}
            empty={<EmptyState icon={ShieldAlert} title="No allergy classes" />}
            columns={[
              {
                key: "name",
                header: "Class",
                cell: (c) => (
                  <p className={cn("flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100", !c.isActive && "opacity-60")}>
                    {c.name} <Inactive active={c.isActive} />
                  </p>
                ),
              },
              { key: "description", header: "Covers", hideOnMobile: true, cell: (c) => c.description ?? "—" },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (c) => (
                  <div className="flex justify-end gap-1">
                    <AllergyClassDialog values={{ id: c.id, name: c.name, description: c.description ?? "" }} />
                    <EntryActiveToggle kind="allergyClass" id={c.id} name={c.name} isActive={c.isActive} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {data.kind === "presets" && (
        <Panel flush title="Prescribing presets" description="One-tap frequency, duration and instruction shortcuts." actions={<PresetDialog />}>
          <DataTable
            rows={data.presets}
            rowKey={(p) => p.id}
            empty={<EmptyState icon={BookOpenCheck} title="No presets" />}
            columns={[
              { key: "kind", header: "Kind", cell: (p) => PRESET_KIND_LABELS[p.kind as keyof typeof PRESET_KIND_LABELS] ?? p.kind },
              {
                key: "label",
                header: "Label",
                cell: (p) => (
                  <p className={cn("flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100", !p.isActive && "opacity-60")}>
                    {p.label} <Inactive active={p.isActive} />
                  </p>
                ),
              },
              { key: "value", header: "Value", cell: (p) => <span className="font-mono text-xs">{p.value}</span> },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (p) => (
                  <div className="flex justify-end gap-1">
                    <PresetDialog values={{ id: p.id, kind: p.kind, label: p.label, value: p.value, sortOrder: p.sortOrder }} />
                    <EntryActiveToggle kind="preset" id={p.id} name={p.label} isActive={p.isActive} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {data.kind === "diagnoses" && (
        <Panel flush title="Diagnosis codes" description="ICD-10 starter codes plus your own. Starred codes are shown to doctors first." actions={<DiagnosisCodeDialog />}>
          <div className="px-6 pb-4 pt-2 lg:px-8">
            <SearchBox tab="diagnoses" q={q} placeholder="Search code or description" />
          </div>
          <DataTable
            rows={data.codes}
            rowKey={(c) => c.id}
            empty={<EmptyState icon={Stethoscope} title={q ? "No codes match" : "No codes yet"} />}
            columns={[
              { key: "fav", header: "", cell: (c) => <FavouriteToggle id={c.id} code={c.code} isFavourite={c.isFavourite} /> },
              { key: "code", header: "Code", cell: (c) => <span className="font-mono text-sm font-semibold text-(--accent-text)">{c.code}</span> },
              {
                key: "label",
                header: "Description",
                cell: (c) => (
                  <p className={cn("flex items-center gap-2", !c.isActive && "opacity-60")}>
                    {c.label} <Inactive active={c.isActive} />
                    {!c.starterKey && <StatusBadge tone="info">Custom</StatusBadge>}
                  </p>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (c) => (
                  <div className="flex justify-end gap-1">
                    <DiagnosisCodeDialog values={{ id: c.id, code: c.code, label: c.label, isFavourite: c.isFavourite }} />
                    <EntryActiveToggle kind="diagnosis" id={c.id} name={c.code} isActive={c.isActive} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {data.kind === "vitals" && (
        <Panel
          flush
          title="Vital sign reference ranges"
          description="Age-banded. Readings are flagged on the server against the narrowest band that fits the patient's age."
          actions={<VitalRangeDialog />}
        >
          <DataTable
            rows={data.ranges}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={HeartPulse} title="No ranges" />}
            columns={[
              {
                key: "vital",
                header: "Vital sign",
                cell: (r) => (
                  <p className={cn("flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100", !r.isActive && "opacity-60")}>
                    {VITAL_LABEL[r.vital] ?? r.vital} <Inactive active={r.isActive} />
                  </p>
                ),
              },
              { key: "ages", header: "Ages", cell: (r) => (r.ageMinYears === 0 && r.ageMaxYears >= 120 ? "All ages" : `${r.ageMinYears}–${r.ageMaxYears} y`) },
              { key: "normal", header: "Normal", cell: (r) => `${r.low ?? "…"} – ${r.high ?? "…"}` },
              { key: "critical", header: "Critical", hideOnMobile: true, cell: (r) => `≤ ${r.criticalLow ?? "—"} · ≥ ${r.criticalHigh ?? "—"}` },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (r) => (
                  <div className="flex justify-end gap-1">
                    <VitalRangeDialog
                      values={{
                        id: r.id,
                        vital: r.vital,
                        ageMinYears: r.ageMinYears,
                        ageMaxYears: r.ageMaxYears,
                        low: r.low ?? "",
                        high: r.high ?? "",
                        criticalLow: r.criticalLow ?? "",
                        criticalHigh: r.criticalHigh ?? "",
                      }}
                    />
                    <EntryActiveToggle kind="vitalRange" id={r.id} name={`${VITAL_LABEL[r.vital] ?? r.vital}, ${r.ageMinYears}–${r.ageMaxYears} y`} isActive={r.isActive} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {data.kind === "lab" && (
        <Panel flush title="Lab tests" description="What doctors can order." actions={<LabTestDialog />}>
          <DataTable
            rows={data.tests}
            rowKey={(t) => t.id}
            empty={<EmptyState icon={FlaskConical} title="No lab tests" />}
            columns={[
              {
                key: "name",
                header: "Test",
                cell: (t) => (
                  <p className={cn("flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100", !t.isActive && "opacity-60")}>
                    {t.name} <Inactive active={t.isActive} />
                  </p>
                ),
              },
              { key: "sample", header: "Sample", hideOnMobile: true, cell: (t) => t.sampleType ?? "—" },
              { key: "range", header: "Reference", hideOnMobile: true, cell: (t) => [t.referenceRange, t.unit].filter(Boolean).join(" ") || "—" },
              { key: "price", header: "Price", hideOnMobile: true, cell: (t) => (t.price ? formatMoney(t.price, data.currency) : "—") },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (t) => (
                  <div className="flex justify-end gap-1">
                    <LabTestDialog
                      values={{ id: t.id, name: t.name, sampleType: t.sampleType ?? "", unit: t.unit ?? "", referenceRange: t.referenceRange ?? "", price: t.price ?? "" }}
                    />
                    <EntryActiveToggle kind="labTest" id={t.id} name={t.name} isActive={t.isActive} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

    </PageShell>
  );
}
