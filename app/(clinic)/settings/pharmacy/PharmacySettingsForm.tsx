"use client";

import { ActionForm, CheckboxCard, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { savePharmacySettingsAction } from "@/features/pharmacy/settings.actions";
import { SALE_GST_RATES } from "@/features/pharmacy/gst-rules";
import type { PharmacySettings } from "@/features/pharmacy/settings.service";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 border-b border-zinc-100 pb-8 last:border-0 last:pb-0 lg:grid-cols-3 dark:border-zinc-800">
      <div>
        <h3 className="font-semibold text-zinc-900 dark:text-white">{title}</h3>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      <div className="space-y-5 lg:col-span-2">{children}</div>
    </div>
  );
}

export default function PharmacySettingsForm({ values, medicinesWithoutHsn }: { values: PharmacySettings; medicinesWithoutHsn: number }) {
  return (
    <ActionForm
      action={savePharmacySettingsAction}
      successMessage="Pharmacy settings saved"
      className="space-y-8"
    >
      <Section title="GST registration" description="Printed on every tax invoice. Sales within your state carry CGST + SGST; a registered buyer in another state is charged IGST.">
        <Field label="GST scheme" name="gstScheme" required hint="Composition dealers and unregistered pharmacies issue a bill of supply without GST.">
          <SelectInput
            name="gstScheme"
            defaultValue={values.gstScheme}
            options={[
              { value: "regular", label: "Regular (tax invoice)" },
              { value: "composition", label: "Composition (bill of supply)" },
              { value: "unregistered", label: "Not registered (bill of supply)" },
            ]}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          <Field label="GSTIN" name="gstin" hint="15 characters, e.g. 33AABCU9603R1ZM">
            <TextInput name="gstin" defaultValue={values.gstin ?? ""} className="uppercase placeholder:normal-case" maxLength={15} />
          </Field>
          <Field label="State code" name="stateCode" hint="From the GSTIN if empty">
            <TextInput name="stateCode" defaultValue={values.stateCode ?? ""} maxLength={2} inputMode="numeric" />
          </Field>
        </div>
      </Section>

      <Section title="Drug licences" description="Retail drug licence numbers (Form 20B and 21B), printed on every pharmacy invoice.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Licence 20B" name="drugLicence20b">
            <TextInput name="drugLicence20b" defaultValue={values.drugLicence20b ?? ""} />
          </Field>
          <Field label="Licence 21B" name="drugLicence21b">
            <TextInput name="drugLicence21b" defaultValue={values.drugLicence21b ?? ""} />
          </Field>
        </div>
      </Section>

      <Section title="At the counter" description="How bills are totalled.">
        <CheckboxCard name="roundOff" value="true" label="Round bills to the nearest rupee" description="Rs 210.76 is collected as Rs 211.00; the 24 paise is shown as round-off." defaultChecked={values.roundOff} />
        <Field label="Largest discount without a manager (%)" name="maxDiscountPercent" hint="Staff who can cancel sales may give more.">
          <TextInput name="maxDiscountPercent" type="number" min={0} max={100} step="0.5" defaultValue={values.maxDiscountPercent} />
        </Field>
      </Section>

      <Section title="Defaults for medicines" description="Used for any medicine without its own HSN or GST rate. Most medicines are HSN 3004 at 5 % since September 2025.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="HSN" name="defaultHsn" required>
            <TextInput name="defaultHsn" defaultValue={values.defaultHsn} inputMode="numeric" maxLength={8} />
          </Field>
          <Field label="GST %" name="defaultGstRate" required>
            <SelectInput name="defaultGstRate" defaultValue={String(values.defaultGstRate)} options={SALE_GST_RATES.map((r) => ({ value: String(r), label: `${r} %` }))} />
          </Field>
        </div>
        {medicinesWithoutHsn > 0 && (
          <CheckboxCard
            name="applyDefaultsToMedicines"
            value="true"
            label={`Fill in HSN and GST for ${medicinesWithoutHsn.toLocaleString("en-IN")} medicines that have none`}
            description="Only empty values are filled; anything already set stays as it is."
          />
        )}
      </Section>

      <Section title="Reordering" description="Suggested orders cover the supplier's delivery time plus these days of sales.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Supplier lead time (days)" name="reorderLeadDays">
            <TextInput name="reorderLeadDays" type="number" min={0} max={120} defaultValue={values.reorderLeadDays} />
          </Field>
          <Field label="Days of stock to order" name="reorderCoverDays">
            <TextInput name="reorderCoverDays" type="number" min={1} max={180} defaultValue={values.reorderCoverDays} />
          </Field>
        </div>
      </Section>

      <div className="flex justify-end">
        <SubmitButton>Save pharmacy settings</SubmitButton>
      </div>
    </ActionForm>
  );
}
