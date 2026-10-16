"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plug, Plus } from "lucide-react";
import { ActionForm, CheckboxCard, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { saveTemplateAction, saveWhatsAppConfigAction, verifyWhatsAppAction } from "@/features/messaging/messaging.actions";

type ConfigValues = {
  phoneNumberId: string;
  businessAccountId: string;
  displayPhone: string;
  hasToken: boolean;
  enabled: boolean;
  remindersEnabled: boolean;
  reminderHoursBefore: number;
  reminderTemplate: string;
  templateLanguage: string;
};

export function WhatsAppConfigForm({ values, canStoreSecrets }: { values: ConfigValues; canStoreSecrets: boolean }) {
  return (
    <ActionForm action={saveWhatsAppConfigAction} successMessage="Messaging settings saved">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone number ID" name="phoneNumberId" hint="From Meta: WhatsApp > API setup.">
          <TextInput name="phoneNumberId" defaultValue={values.phoneNumberId} className="font-mono" />
        </Field>
        <Field label="WhatsApp business account ID" name="businessAccountId">
          <TextInput name="businessAccountId" defaultValue={values.businessAccountId} className="font-mono" />
        </Field>
        <Field label="Display number" name="displayPhone" hint="Shown to staff only.">
          <TextInput name="displayPhone" defaultValue={values.displayPhone} />
        </Field>
        <Field
          label="Access token"
          name="accessToken"
          hint={values.hasToken ? "A token is stored (encrypted). Leave blank to keep it." : canStoreSecrets ? "Stored encrypted; never shown again." : "The server has no encryption key, so a token cannot be stored."}
        >
          <TextInput name="accessToken" type="password" autoComplete="off" placeholder={values.hasToken ? "••••••••••••" : ""} disabled={!canStoreSecrets} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CheckboxCard name="enabled" value="on" label="Messaging on" description="Nothing is sent while this is off." defaultChecked={values.enabled} />
        <CheckboxCard name="remindersEnabled" value="on" label="Appointment reminders" description="Sent automatically to patients who agreed." defaultChecked={values.remindersEnabled} />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Remind this many hours before" name="reminderHoursBefore">
          <TextInput name="reminderHoursBefore" type="number" min={1} max={72} defaultValue={values.reminderHoursBefore} />
        </Field>
        <Field label="Reminder template" name="reminderTemplate" hint="Approved utility template; {{1}} name, {{2}} time, {{3}} doctor, {{4}} clinic.">
          <TextInput name="reminderTemplate" defaultValue={values.reminderTemplate} className="font-mono" />
        </Field>
        <Field label="Template language" name="templateLanguage">
          <TextInput name="templateLanguage" defaultValue={values.templateLanguage} className="font-mono" />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function VerifyConnectionButton() {
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    const result = await verifyWhatsAppAction({});
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    if (result.data.ok) toast.success(result.data.detail);
    else toast.error(`Meta refused the connection: ${result.data.detail}`);
  }
  return (
    <button type="button" onClick={run} disabled={pending} className={buttonClass("secondary", "sm")}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Check connection
    </button>
  );
}

export function TemplateDialog({ values }: { values?: { id: string; name: string; language: string; category: string; preview: string; isActive: boolean } }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "secondary"}
      size="sm"
      trigger={editing ? <Pencil className="h-4 w-4" aria-label={`Edit ${values!.name}`} /> : <><Plus className="h-4 w-4" /> Add template</>}
      title={editing ? `Edit ${values!.name}` : "Add an approved template"}
      description="Templates are created and approved in Meta Business Manager. Record them here exactly as approved."
    >
      {(close) => (
        <ActionForm action={saveTemplateAction} successMessage="Template saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Template name" name="name" required className="sm:col-span-2">
              <TextInput name="name" defaultValue={values?.name} className="font-mono" placeholder="monsoon_health_camp" />
            </Field>
            <Field label="Language" name="language" required>
              <TextInput name="language" defaultValue={values?.language ?? "en"} className="font-mono" />
            </Field>
          </div>
          <Field label="Category" name="category" required>
            <SelectInput
              name="category"
              defaultValue={values?.category ?? "marketing"}
              options={[
                { value: "marketing", label: "Marketing (broadcasts)" },
                { value: "utility", label: "Utility (reminders, updates)" },
              ]}
            />
          </Field>
          <Field label="What the patient reads" name="preview" required hint="{{1}} is replaced with the patient's first name.">
            <TextArea name="preview" rows={4} defaultValue={values?.preview} />
          </Field>
          <CheckboxCard name="isActive" value="on" label="Available for broadcasts" defaultChecked={values?.isActive ?? true} />
          <div className="flex justify-end">
            <SubmitButton>{editing ? "Save" : "Add template"}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
