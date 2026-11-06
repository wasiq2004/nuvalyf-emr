"use client";

// Admit, move and discharge a patient; charges, payments and bill changes.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Ban, HandCoins, LogOut, Pencil, Percent, Plus } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/features/billing/billing-rules";
import {
  addChargeAction,
  adjustBedStayAction,
  admitPatientAction,
  dischargePatientAction,
  recordPaymentAction,
  setDiscountAction,
  transferBedAction,
  voidChargeAction,
} from "@/features/inpatient/inpatient.actions";

type Option = { value: string; label: string };
type Now = { date: string; time: string };

const METHODS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

function WhenFields({ now, label }: { now: Now; label: string }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label={`${label} date`} name="date" required>
        <TextInput name="date" type="date" defaultValue={now.date} max={now.date} />
      </Field>
      <Field label={`${label} time`} name="time" required hint="Bed charges run from this time">
        <TextInput name="time" type="time" defaultValue={now.time} />
      </Field>
    </div>
  );
}

export function AdmitForm({ patientId, doctors, beds, now }: { patientId: string; doctors: Option[]; beds: Option[]; now: Now }) {
  const router = useRouter();
  return (
    <ActionForm action={admitPatientAction} successMessage="Patient admitted" refresh={false} onSuccess={(row: { id: string }) => router.push(`/inpatient/${row.id}`)}>
      <input type="hidden" name="patientId" value={patientId} />
      <Field label="Reason for admission" name="reason" required>
        <TextInput name="reason" placeholder="e.g. Fever with dehydration" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Consultant" name="doctorId" required>
          <SelectInput name="doctorId" placeholder="Choose a doctor" options={doctors} />
        </Field>
        <Field label="Bed" name="bedId" required>
          <SelectInput name="bedId" placeholder="Choose a free bed" options={beds} />
        </Field>
      </div>
      <WhenFields now={now} label="Admission" />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Attendant's name" name="attendantName">
          <TextInput name="attendantName" />
        </Field>
        <Field label="Attendant's phone" name="attendantPhone">
          <TextInput name="attendantPhone" type="tel" />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton>Admit patient</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function TransferDialog({ admissionId, beds, now }: { admissionId: string; beds: Option[]; now: Now }) {
  return (
    <FormDialog
      variant="secondary"
      trigger={
        <>
          <ArrowRightLeft className="h-4 w-4" /> Change bed
        </>
      }
      title="Change bed"
      description="The old bed is charged up to this time; the new bed's rate applies from then."
    >
      {(close) => (
        <ActionForm action={transferBedAction} successMessage="Bed changed" onSuccess={close}>
          <input type="hidden" name="admissionId" value={admissionId} />
          <Field label="New bed" name="bedId" required>
            <SelectInput name="bedId" placeholder="Choose a free bed" options={beds} />
          </Field>
          <WhenFields now={now} label="Move" />
          <div className="flex justify-end">
            <SubmitButton>Change bed</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DischargeDialog({ admissionId, now, balance }: { admissionId: string; now: Now; balance: string | null }) {
  return (
    <FormDialog
      variant="danger-outline"
      trigger={
        <>
          <LogOut className="h-4 w-4" /> Discharge
        </>
      }
      title="Discharge patient"
      description={balance ? `₹${balance} is still due. The patient can be discharged; the balance stays on the bill and shows on the summary.` : "The bed is freed and bed charges stop at this time."}
    >
      {(close) => (
        <ActionForm action={dischargePatientAction} successMessage="Patient discharged" onSuccess={close}>
          <input type="hidden" name="admissionId" value={admissionId} />
          <WhenFields now={now} label="Discharge" />
          <div className="flex justify-end">
            <SubmitButton variant="danger">Discharge patient</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function ChargeDialog({ admissionId }: { admissionId: string }) {
  return (
    <FormDialog
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Plus className="h-4 w-4" /> Add charge
        </>
      }
      title="Add a charge"
    >
      {(close) => (
        <ActionForm action={addChargeAction} successMessage="Charge added" onSuccess={close}>
          <input type="hidden" name="admissionId" value={admissionId} />
          <Field label="Type" name="kind" required>
            <SelectInput
              name="kind"
              defaultValue="doctor"
              options={[
                { value: "doctor", label: "Doctor visit" },
                { value: "nursing", label: "Nursing" },
                { value: "procedure", label: "Procedure" },
                { value: "lab", label: "Lab" },
                { value: "pharmacy", label: "Pharmacy" },
                { value: "other", label: "Other" },
              ]}
            />
          </Field>
          <Field label="Description" name="description" required>
            <TextInput name="description" placeholder="e.g. Consultant round" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Quantity" name="quantity" required>
              <TextInput name="quantity" type="number" min={1} defaultValue={1} />
            </Field>
            <Field label="Amount each (₹)" name="unitAmount" required>
              <TextInput name="unitAmount" inputMode="decimal" />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Add charge</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function PaymentDialog({ admissionId, balance, discharged }: { admissionId: string; balance: string; discharged: boolean }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <FormDialog
      trigger={
        <>
          <HandCoins className="h-4 w-4" /> Take payment
        </>
      }
      title="Take a payment"
      description="Any amount: an advance at admission, part payments during the stay, the rest at discharge."
    >
      {(close) => (
        <ActionForm
          action={recordPaymentAction}
          successMessage="Payment recorded"
          onSuccess={() => {
            setKey(crypto.randomUUID());
            close();
          }}
        >
          <input type="hidden" name="admissionId" value={admissionId} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Type" name="kind" required>
              <SelectInput
                name="kind"
                defaultValue={discharged ? "payment" : "advance"}
                options={[
                  { value: "advance", label: "Advance" },
                  { value: "payment", label: "Part or final payment" },
                  { value: "refund", label: "Refund to patient" },
                ]}
              />
            </Field>
            <Field label="Amount (₹)" name="amount" required hint={Number(balance) > 0 ? `₹${balance} is due` : undefined}>
              <TextInput name="amount" inputMode="decimal" />
            </Field>
            <Field label="Method" name="method" required>
              <SelectInput name="method" defaultValue="cash" options={METHODS} />
            </Field>
            <Field label="Reference" name="reference">
              <TextInput name="reference" placeholder="UPI / card ref" />
            </Field>
          </div>
          <Field label="Note" name="note">
            <TextInput name="note" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Record</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DiscountDialog({ admissionId, current }: { admissionId: string; current: string }) {
  return (
    <FormDialog
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Percent className="h-4 w-4" /> Discount
        </>
      }
      title="Discount on the bill"
      description="Recorded with your name and the reason."
    >
      {(close) => (
        <ActionForm action={setDiscountAction} successMessage="Discount saved" onSuccess={close}>
          <input type="hidden" name="admissionId" value={admissionId} />
          <Field label="Discount (₹)" name="discount" required>
            <TextInput name="discount" inputMode="decimal" defaultValue={current} />
          </Field>
          <Field label="Reason" name="reason" required>
            <TextInput name="reason" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function AdjustBedDialog({ stayId, label, hours, rate }: { stayId: string; label: string; hours: number; rate: string }) {
  return (
    <FormDialog variant="ghost" size="sm" trigger={<Pencil className="h-4 w-4" aria-label={`Change charge for ${label}`} />} title={`Change charge for ${label}`} description="Leave a field empty to keep the worked-out figure. Recorded with your name and the reason.">
      {(close) => (
        <ActionForm action={adjustBedStayAction} successMessage="Bed charge changed" onSuccess={close}>
          <input type="hidden" name="stayId" value={stayId} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Hours charged" name="hours">
              <TextInput name="hours" type="number" min={0} placeholder={String(hours)} />
            </Field>
            <Field label="Rate per day (₹)" name="rate">
              <TextInput name="rate" inputMode="decimal" placeholder={rate} />
            </Field>
          </div>
          <Field label="Reason" name="reason" required>
            <TextInput name="reason" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function VoidChargeDialog({ chargeId, label }: { chargeId: string; label: string }) {
  return (
    <FormDialog variant="ghost" size="sm" trigger={<Ban className="h-4 w-4" aria-label={`Strike out ${label}`} />} title={`Strike out ${label}?`} description="It stays on record, crossed out, with the reason.">
      {(close) => (
        <ActionForm action={voidChargeAction} successMessage="Charge struck out" onSuccess={close}>
          <input type="hidden" name="chargeId" value={chargeId} />
          <Field label="Reason" name="reason" required>
            <TextInput name="reason" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton variant="danger">Strike out</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
