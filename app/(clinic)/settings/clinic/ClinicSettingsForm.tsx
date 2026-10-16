"use client";

import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { updateClinicSettingsAction } from "@/features/settings/settings.actions";

type Values = {
  displayName: string;
  addressLine: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  timezone: string;
  letterheadText: string;
  footerText: string;
  slotMinutes: number;
  currency: string;
  analyticsMinCell: number;
};

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

export default function ClinicSettingsForm({ values, timezones, showAnalytics }: { values: Values; timezones: string[]; showAnalytics: boolean }) {
  return (
    <ActionForm action={updateClinicSettingsAction} successMessage="Settings saved" className="space-y-8">
      <Section title="Identity" description="How the clinic appears to patients and on printed documents.">
        <Field label="Clinic name" name="displayName" required>
          <TextInput name="displayName" defaultValue={values.displayName} required />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Phone" name="phone">
            <TextInput name="phone" type="tel" defaultValue={values.phone} />
          </Field>
          <Field label="Email" name="email">
            <TextInput name="email" type="email" defaultValue={values.email} />
          </Field>
        </div>
        <Field label="Address" name="addressLine">
          <TextArea name="addressLine" rows={2} defaultValue={values.addressLine} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="City" name="city">
            <TextInput name="city" defaultValue={values.city} />
          </Field>
          <Field label="Website" name="website">
            <TextInput name="website" defaultValue={values.website} placeholder="https://" />
          </Field>
        </div>
      </Section>

      <Section title="Letterhead" description="Printed under the clinic name on prescriptions and invoices.">
        <Field label="Letterhead lines" name="letterheadText" hint="e.g. registration details, timings, a short tagline.">
          <TextArea name="letterheadText" rows={3} defaultValue={values.letterheadText} />
        </Field>
        <Field label="Footer" name="footerText" hint="e.g. 'Valid for 7 days. Emergency: 98xxx xxxxx'.">
          <TextArea name="footerText" rows={2} defaultValue={values.footerText} />
        </Field>
      </Section>

      <Section title="Operations" description="Calendar and front-desk behaviour.">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Timezone" name="timezone" required className="sm:col-span-2">
            <SelectInput name="timezone" defaultValue={values.timezone} options={timezones.map((tz) => ({ value: tz, label: tz }))} />
          </Field>
          <Field label="Currency" name="currency" required>
            <TextInput name="currency" defaultValue={values.currency} maxLength={3} />
          </Field>
        </div>
        <Field label="Calendar slot length" name="slotMinutes" hint="Appointments start on this grid; a service's duration decides how many slots it takes.">
          <SelectInput
            name="slotMinutes"
            defaultValue={String(values.slotMinutes)}
            options={[5, 10, 15, 20, 30].map((m) => ({ value: String(m), label: `${m} minutes` }))}
          />
        </Field>
      </Section>

      {showAnalytics && (
        <Section title="Analytics" description="De-identified analytics hide small numbers so individuals cannot be picked out.">
          <Field label="Hide counts below" name="analyticsMinCell" hint="Any count from 1 up to this number minus one is shown as hidden. At least 3; 5 is common.">
            <TextInput name="analyticsMinCell" type="number" min={3} max={50} defaultValue={values.analyticsMinCell} />
          </Field>
        </Section>
      )}

      <div className="flex justify-end">
        <SubmitButton>Save settings</SubmitButton>
      </div>
    </ActionForm>
  );
}
