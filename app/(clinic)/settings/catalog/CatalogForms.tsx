"use client";

import { useState } from "react";
import { Download, Pencil, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, CheckboxCard, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { ConfirmAction, FormDialog } from "@/components/app/dialogs";
import { ActionButton } from "@/components/app/action-button";
import {
  addItemAliasAction,
  importStarterAction,
  removeItemAliasAction,
  saveAllergyClassAction,
  saveDiagnosisCodeAction,
  saveDrugAction,
  saveInteractionAction,
  saveLabTestAction,
  savePresetAction,
  saveVitalRangeAction,
  setCatalogEntryActiveAction,
  setDiagnosisFavouriteAction,
  setDrugActiveAction,
} from "@/features/catalog/catalog.actions";
import { DRUG_FORMS, PRESET_KIND_LABELS, PRESET_KINDS, SEVERITIES, capitalize } from "@/features/catalog/catalog-options";
import { ITEM_TYPE_LABELS, ITEM_TYPES, isItemType, type ItemType } from "@/features/catalog/item-rules";
import { VITAL_FIELDS } from "@/features/clinical/vital-rules";

function DialogTrigger({ editing, label }: { editing: boolean; label: string }) {
  return editing ? (
    <Pencil className="h-4 w-4" aria-label={`Edit ${label}`} />
  ) : (
    <>
      <Plus className="h-4 w-4" /> {label}
    </>
  );
}

function Footer({ editing }: { editing: boolean }) {
  return (
    <div className="flex justify-end">
      <SubmitButton>{editing ? "Save changes" : "Add"}</SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------

export type DrugValues = {
  id: string;
  itemType: string;
  name: string;
  genericName: string;
  form: string;
  strength: string;
  category: string;
  manufacturer: string;
  packSize: string;
  defaultDose: string;
  defaultFrequency: string;
  defaultDurationDays: string;
  defaultInstructions: string;
  price: string;
  packPrice: string;
  allergyClassIds: string[];
  aliases: { id: string; alias: string }[];
};

export function DrugDialog({ values, classes }: { values?: DrugValues; classes: { id: string; name: string }[] }) {
  const editing = Boolean(values);
  const [type, setType] = useState<ItemType>(values && isItemType(values.itemType) ? values.itemType : "medicine");
  const medicine = type === "medicine";
  return (
    <FormDialog
      wide
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={<DialogTrigger editing={editing} label={editing ? values!.name : "Add item"} />}
      title={editing ? `Edit ${values!.name}` : "Add an item"}
      description="Medicines can be prescribed; consumables and instruments are only stocked and sold. Changes apply from now on: signed prescriptions keep what was printed."
    >
      {(close) => (
        <>
          <ActionForm action={saveDrugAction} successMessage={editing ? "Item updated" : "Item added"} onSuccess={close}>
            <input type="hidden" name="id" value={values?.id ?? ""} />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Type" name="itemType" required>
                <SelectInput name="itemType" value={type} onChange={(e) => setType(e.target.value as ItemType)} options={ITEM_TYPES.map((t) => ({ value: t, label: ITEM_TYPE_LABELS[t] }))} />
              </Field>
              <Field label={medicine ? "Name (as prescribed)" : "Name"} name="name" required>
                <TextInput name="name" defaultValue={values?.name} placeholder={medicine ? "e.g. Paracetamol 650" : "e.g. Clinic needle 24G"} />
              </Field>
              {medicine && (
                <>
                  <Field label="Generic name" name="genericName" required hint="Combinations: join with +, e.g. Amoxicillin + Clavulanic acid.">
                    <TextInput name="genericName" defaultValue={values?.genericName} />
                  </Field>
                  <Field label="Form" name="form" required>
                    <SelectInput name="form" defaultValue={values?.form ?? "tablet"} options={DRUG_FORMS.map((f) => ({ value: f, label: capitalize(f) }))} />
                  </Field>
                </>
              )}
              <Field label="Strength / size" name="strength">
                <TextInput name="strength" defaultValue={values?.strength} placeholder={medicine ? "e.g. 500 mg" : "e.g. 24G"} />
              </Field>
              <Field label="Manufacturer" name="manufacturer">
                <TextInput name="manufacturer" defaultValue={values?.manufacturer} />
              </Field>
              <Field label="Category" name="category">
                <TextInput name="category" defaultValue={values?.category} placeholder={medicine ? "e.g. Antibiotic" : "e.g. Dressing"} />
              </Field>
              <Field label="Units per pack" name="packSize" required hint="As suppliers sell it: a strip of 10 = 10.">
                <TextInput name="packSize" type="number" min={1} defaultValue={values?.packSize ?? "1"} />
              </Field>
              <Field label="Price per unit" name="price" hint="When sold loose (one tablet, one needle).">
                <TextInput name="price" inputMode="decimal" defaultValue={values?.price} />
              </Field>
              <Field label="Price per pack" name="packPrice" hint="A whole strip or pack, e.g. its MRP. Empty: units × price per unit.">
                <TextInput name="packPrice" inputMode="decimal" defaultValue={values?.packPrice} />
              </Field>
            </div>
            {medicine && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Defaults when prescribing</p>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Dose" name="defaultDose">
                    <TextInput name="defaultDose" defaultValue={values?.defaultDose} placeholder="1 tablet" />
                  </Field>
                  <Field label="Frequency" name="defaultFrequency">
                    <TextInput name="defaultFrequency" defaultValue={values?.defaultFrequency} placeholder="BD" />
                  </Field>
                  <Field label="Duration (days)" name="defaultDurationDays">
                    <TextInput name="defaultDurationDays" type="number" min={1} max={365} defaultValue={values?.defaultDurationDays} />
                  </Field>
                </div>
                <Field label="Instructions" name="defaultInstructions">
                  <TextInput name="defaultInstructions" defaultValue={values?.defaultInstructions} placeholder="After food" />
                </Field>
                {classes.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Allergy classes</p>
                    <p className="text-xs text-zinc-500">A patient allergic to a class is warned about every medicine in it.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {classes.map((c) => (
                        <CheckboxCard key={c.id} name="allergyClassIds" value={c.id} label={c.name} defaultChecked={values?.allergyClassIds.includes(c.id)} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <Footer editing={editing} />
          </ActionForm>
          {values && <OtherNames drugId={values.id} name={values.name} aliases={values.aliases} />}
        </>
      )}
    </FormDialog>
  );
}

/** Other names the item is known by (suppliers' spellings, other brands). */
function OtherNames({ drugId, name, aliases }: { drugId: string; name: string; aliases: { id: string; alias: string }[] }) {
  return (
    <div className="mt-6 space-y-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Other names</p>
        <p className="text-xs text-zinc-500">Supplier bills, imports and searches also find {name} by these names.</p>
      </div>
      {aliases.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {aliases.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 py-0.5 pl-3 pr-1 text-sm dark:border-zinc-700">
              {a.alias}
              <ActionButton action={removeItemAliasAction} input={{ id: a.id }} variant="ghost" className="h-6 px-1.5" aria-label={`Remove other name ${a.alias}`} successMessage="Name removed">
                <X className="h-3.5 w-3.5" />
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={addItemAliasAction} successMessage="Name added" resetOnSuccess>
        <input type="hidden" name="drugId" value={drugId} />
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextInput name="alias" aria-label={`Another name for ${name}`} placeholder="e.g. how a supplier writes it" />
          </div>
          <SubmitButton variant="secondary">Add name</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

export function DrugActiveToggle({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  return isActive ? (
    <ConfirmAction
      action={setDrugActiveAction}
      input={{ id, isActive: false }}
      variant="ghost"
      trigger="Deactivate"
      title={`Deactivate ${name}?`}
      description="It disappears from prescribing, bills and sales searches. Past records are not affected, and you can reactivate it any time."
      confirmLabel="Deactivate"
      successMessage="Item deactivated"
    />
  ) : (
    <ActionButton action={setDrugActiveAction} input={{ id, isActive: true }} variant="ghost" successMessage="Item reactivated">
      Reactivate
    </ActionButton>
  );
}

// ---------------------------------------------------------------------------
// Everything else (Clinic Admin)
// ---------------------------------------------------------------------------

export function EntryActiveToggle({ kind, id, name, isActive }: { kind: string; id: string; name: string; isActive: boolean }) {
  return isActive ? (
    <ConfirmAction
      action={setCatalogEntryActiveAction}
      input={{ kind, id, isActive: false }}
      variant="ghost"
      trigger="Deactivate"
      title={`Deactivate “${name}”?`}
      description="It stops being used for new work. Nothing already recorded changes. You can reactivate it any time."
      confirmLabel="Deactivate"
      successMessage="Deactivated"
    />
  ) : (
    <ActionButton action={setCatalogEntryActiveAction} input={{ kind, id, isActive: true }} variant="ghost" successMessage="Reactivated">
      Reactivate
    </ActionButton>
  );
}

export function AllergyClassDialog({ values }: { values?: { id: string; name: string; description: string } }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={<DialogTrigger editing={editing} label={editing ? values!.name : "Add class"} />}
      title={editing ? `Edit ${values!.name}` : "Add an allergy class"}
    >
      {(close) => (
        <ActionForm action={saveAllergyClassAction} successMessage="Saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={values?.name} placeholder="e.g. Penicillins" />
          </Field>
          <Field label="Description" name="description">
            <TextInput name="description" defaultValue={values?.description} placeholder="Medicines in this class" />
          </Field>
          <Footer editing={editing} />
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function InteractionDialog({
  values,
  generics,
}: {
  values?: { id: string; genericA: string; genericB: string; severity: string; description: string };
  generics: string[];
}) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={<DialogTrigger editing={editing} label={editing ? `${values!.genericA} + ${values!.genericB}` : "Add rule"} />}
      title={editing ? "Edit interaction rule" : "Add an interaction rule"}
      description="Rules use generic names, so every brand containing the molecule is covered."
    >
      {(close) => (
        <ActionForm action={saveInteractionAction} successMessage="Rule saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <datalist id="generic-names">
            {generics.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Medicine (generic)" name="genericA" required>
              <TextInput name="genericA" list="generic-names" defaultValue={values?.genericA} />
            </Field>
            <Field label="Interacts with (generic)" name="genericB" required>
              <TextInput name="genericB" list="generic-names" defaultValue={values?.genericB} />
            </Field>
          </div>
          <Field label="Severity" name="severity" required hint="Major and contraindicated need a written reason to prescribe together.">
            <SelectInput name="severity" defaultValue={values?.severity ?? "moderate"} options={SEVERITIES.map((s) => ({ value: s, label: capitalize(s) }))} />
          </Field>
          <Field label="What happens" name="description" required>
            <TextArea name="description" rows={3} defaultValue={values?.description} />
          </Field>
          <Footer editing={editing} />
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function PresetDialog({ values }: { values?: { id: string; kind: string; label: string; value: string; sortOrder: number } }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={<DialogTrigger editing={editing} label={editing ? values!.label : "Add preset"} />}
      title={editing ? "Edit preset" : "Add a prescribing preset"}
      description="Shown as one-tap shortcuts while prescribing."
    >
      {(close) => (
        <ActionForm action={savePresetAction} successMessage="Preset saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <Field label="Kind" name="kind" required>
            <SelectInput name="kind" defaultValue={values?.kind ?? "frequency"} options={PRESET_KINDS.map((k) => ({ value: k, label: PRESET_KIND_LABELS[k] }))} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Label" name="label" required hint="What the doctor sees.">
              <TextInput name="label" defaultValue={values?.label} placeholder="Twice daily (BD) 1-0-1" />
            </Field>
            <Field label="Value" name="value" required hint="What goes on the prescription (days for durations).">
              <TextInput name="value" defaultValue={values?.value} placeholder="BD" />
            </Field>
          </div>
          <Field label="Order" name="sortOrder">
            <TextInput name="sortOrder" type="number" min={0} max={999} defaultValue={values?.sortOrder ?? 0} />
          </Field>
          <Footer editing={editing} />
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DiagnosisCodeDialog({ values }: { values?: { id: string; code: string; label: string; isFavourite: boolean } }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={<DialogTrigger editing={editing} label={editing ? values!.code : "Add code"} />}
      title={editing ? `Edit ${values!.code}` : "Add a diagnosis code"}
      description="An ICD-10 code, or the clinic's own code for something ICD-10 does not cover."
    >
      {(close) => (
        <ActionForm action={saveDiagnosisCodeAction} successMessage="Code saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
            <Field label="Code" name="code" required>
              <TextInput name="code" defaultValue={values?.code} className="font-mono" />
            </Field>
            <Field label="Description" name="label" required>
              <TextInput name="label" defaultValue={values?.label} />
            </Field>
          </div>
          <CheckboxCard name="isFavourite" value="on" label="Clinic favourite" description="Shown first, before the doctor types anything." defaultChecked={values?.isFavourite} />
          <Footer editing={editing} />
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function FavouriteToggle({ id, code, isFavourite }: { id: string; code: string; isFavourite: boolean }) {
  return (
    <ActionButton
      action={setDiagnosisFavouriteAction}
      input={{ id, isFavourite: !isFavourite }}
      variant="ghost"
      className="px-2"
      aria-label={isFavourite ? `Remove ${code} from favourites` : `Make ${code} a favourite`}
    >
      <Star className={isFavourite ? "h-4 w-4 fill-amber-400 text-amber-400" : "h-4 w-4 text-zinc-400"} />
    </ActionButton>
  );
}

type RangeValues = {
  id: string;
  vital: string;
  ageMinYears: number;
  ageMaxYears: number;
  low: string;
  high: string;
  criticalLow: string;
  criticalHigh: string;
};

export function VitalRangeDialog({ values }: { values?: RangeValues }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      wide
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={<DialogTrigger editing={editing} label={editing ? "range" : "Add range"} />}
      title={editing ? "Edit reference range" : "Add a reference range"}
      description="Vitals outside low/high are flagged; at or beyond the critical limits they are flagged as critical. The narrowest age band that fits the patient is used."
    >
      {(close) => (
        <ActionForm action={saveVitalRangeAction} successMessage="Range saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Vital sign" name="vital" required>
              <SelectInput name="vital" defaultValue={values?.vital ?? "pulse"} options={VITAL_FIELDS.map((f) => ({ value: f.key, label: `${f.label} (${f.unit})` }))} />
            </Field>
            <Field label="From age (years)" name="ageMinYears">
              <TextInput name="ageMinYears" type="number" min={0} max={150} defaultValue={values?.ageMinYears ?? 0} />
            </Field>
            <Field label="To age (years)" name="ageMaxYears">
              <TextInput name="ageMaxYears" type="number" min={0} max={150} defaultValue={values?.ageMaxYears ?? 150} />
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-4">
            <Field label="Critical low" name="criticalLow">
              <TextInput name="criticalLow" inputMode="decimal" defaultValue={values?.criticalLow} />
            </Field>
            <Field label="Low" name="low">
              <TextInput name="low" inputMode="decimal" defaultValue={values?.low} />
            </Field>
            <Field label="High" name="high">
              <TextInput name="high" inputMode="decimal" defaultValue={values?.high} />
            </Field>
            <Field label="Critical high" name="criticalHigh">
              <TextInput name="criticalHigh" inputMode="decimal" defaultValue={values?.criticalHigh} />
            </Field>
          </div>
          <Footer editing={editing} />
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function LabTestDialog({ values }: { values?: { id: string; name: string; sampleType: string; unit: string; referenceRange: string; price: string } }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={<DialogTrigger editing={editing} label={editing ? values!.name : "Add test"} />}
      title={editing ? `Edit ${values!.name}` : "Add a lab test"}
    >
      {(close) => (
        <ActionForm action={saveLabTestAction} successMessage="Test saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={values?.name} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Sample" name="sampleType">
              <TextInput name="sampleType" defaultValue={values?.sampleType} placeholder="e.g. Serum" />
            </Field>
            <Field label="Unit" name="unit">
              <TextInput name="unit" defaultValue={values?.unit} placeholder="e.g. mg/dL" />
            </Field>
            <Field label="Reference range" name="referenceRange">
              <TextInput name="referenceRange" defaultValue={values?.referenceRange} placeholder="e.g. 70–99" />
            </Field>
            <Field label="Price" name="price">
              <TextInput name="price" inputMode="decimal" defaultValue={values?.price} />
            </Field>
          </div>
          <Footer editing={editing} />
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function ImportStarterButton({ count }: { count: number }) {
  return (
    <ConfirmAction
      action={importStarterAction}
      input={{}}
      variant="primary"
      trigger={
        <>
          <Download className="h-4 w-4" /> Import {count} new {count === 1 ? "entry" : "entries"}
        </>
      }
      title="Import new starter entries?"
      description="Only entries the clinic does not have yet are added. Nothing you have edited or deactivated is changed."
      confirmLabel="Import"
      onSuccess={(added: Record<string, number>) => {
        const total = Object.values(added).reduce((a, b) => a + b, 0);
        toast.success(`${total} ${total === 1 ? "entry" : "entries"} imported`);
      }}
    />
  );
}
