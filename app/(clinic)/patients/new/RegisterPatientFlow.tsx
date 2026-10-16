"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Search, UserCheck } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput, inputClass } from "@/components/app/form";
import { Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { buttonClass } from "@/components/app/buttons";
import { registerPatientAction, searchDuplicatesAction } from "@/features/patients/patients.actions";
import { cn } from "@/lib/utils";

type Identity = { firstName: string; lastName: string; mobile: string; dateOfBirth: string; statedAgeYears: string };

type Candidate = {
  id: string;
  mrn: string;
  name: string;
  age: number | null;
  mobile: string | null;
  likely: boolean;
  reasons: string[];
};

const EMPTY: Identity = { firstName: "", lastName: "", mobile: "", dateOfBirth: "", statedAgeYears: "" };

const key = (v: Identity) => JSON.stringify([v.firstName.trim().toLowerCase(), v.lastName.trim().toLowerCase(), v.mobile, v.dateOfBirth, v.statedAgeYears]);

export default function RegisterPatientFlow() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [search, setSearch] = useState<{ key: string; token: string; candidates: Candidate[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Editing any identifying field after the search invalidates it.
  const searchIsCurrent = search !== null && search.key === key(identity);
  const likely = useMemo(() => (search?.candidates ?? []).filter((c) => c.likely), [search]);

  const set = (field: keyof Identity) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setIdentity((v) => ({ ...v, [field]: e.target.value }));

  async function runSearch() {
    setSearching(true);
    setSearchError(null);
    // Send exactly what registration will send: a date of birth replaces the age.
    const result = await searchDuplicatesAction({
      ...identity,
      statedAgeYears: identity.dateOfBirth ? "" : identity.statedAgeYears,
    });
    setSearching(false);
    if (!result.ok) {
      setSearchError(result.error);
      return;
    }
    setSearch({ key: key(identity), token: result.data.token, candidates: result.data.candidates });
  }

  return (
    <div className="space-y-6">
      <Panel title="1. Who is it?" description="Name plus a mobile, date of birth or age.">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                First name <span className="text-red-500">*</span>
              </span>
              <input value={identity.firstName} onChange={set("firstName")} className={cn(inputClass, "h-11")} autoFocus />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Last name</span>
              <input value={identity.lastName} onChange={set("lastName")} className={cn(inputClass, "h-11")} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Mobile</span>
              <input value={identity.mobile} onChange={set("mobile")} type="tel" className={cn(inputClass, "h-11")} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Date of birth</span>
              <input value={identity.dateOfBirth} onChange={set("dateOfBirth")} type="date" className={cn(inputClass, "h-11")} />
            </label>
            <label className="space-y-1.5">
              <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">or age (years)</span>
              <input
                value={identity.statedAgeYears}
                onChange={set("statedAgeYears")}
                type="number"
                min={0}
                max={130}
                disabled={Boolean(identity.dateOfBirth)}
                className={cn(inputClass, "h-11")}
              />
            </label>
          </div>
          {searchError && <p className="text-sm text-red-600 dark:text-red-400">{searchError}</p>}
          <button
            type="button"
            onClick={runSearch}
            disabled={searching || !identity.firstName.trim()}
            className={buttonClass(searchIsCurrent ? "secondary" : "primary", "md")}
          >
            <Search className="h-4 w-4" /> {searching ? "Searching..." : searchIsCurrent ? "Search again" : "Search for existing patients"}
          </button>
        </div>
      </Panel>

      {search && (
        <Panel
          title="2. Existing records"
          description={
            search.candidates.length === 0
              ? "No existing patient matches these details."
              : "Open an existing record instead of creating a duplicate."
          }
        >
          {search.candidates.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> No matches. Safe to register.
            </p>
          ) : (
            <ul className="space-y-2">
              {search.candidates.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4",
                    c.likely ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" : "border-zinc-200 dark:border-zinc-800",
                  )}
                >
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {c.name} <span className="font-mono text-xs font-normal text-zinc-500">{c.mrn}</span>
                    </p>
                    <p className="text-sm text-zinc-500">
                      {c.age !== null ? `${c.age} y` : "Age unknown"} · {c.mobile ?? "No mobile"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.likely && <StatusBadge tone="warning">Likely the same person</StatusBadge>}
                      {c.reasons.map((r) => (
                        <StatusBadge key={r} tone="neutral">
                          {r}
                        </StatusBadge>
                      ))}
                    </div>
                  </div>
                  <Link href={`/patients/${c.id}`} className={buttonClass("secondary", "sm")}>
                    <UserCheck className="h-4 w-4" /> Use this record
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title="3. Register" description={searchIsCurrent ? undefined : "Run the search above on the current details first."}>
        <ActionForm
          action={registerPatientAction}
          successMessage="Patient registered"
          refresh={false}
          onSuccess={(data) => router.push(`/patients/${data.id}`)}
        >
          <fieldset disabled={!searchIsCurrent} className="m-0 min-w-0 space-y-5 border-0 p-0 disabled:opacity-60">
            {/* Identity comes from step 1 so it matches the search exactly. */}
            <input type="hidden" name="firstName" value={identity.firstName} />
            <input type="hidden" name="lastName" value={identity.lastName} />
            <input type="hidden" name="mobile" value={identity.mobile} />
            <input type="hidden" name="dateOfBirth" value={identity.dateOfBirth} />
            <input type="hidden" name="statedAgeYears" value={identity.dateOfBirth ? "" : identity.statedAgeYears} />
            <input type="hidden" name="duplicateToken" value={searchIsCurrent ? search!.token : ""} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sex" name="sex" required>
                <SelectInput
                  name="sex"
                  placeholder="Choose"
                  options={[
                    { value: "female", label: "Female" },
                    { value: "male", label: "Male" },
                    { value: "other", label: "Other" },
                    { value: "unknown", label: "Not stated" },
                  ]}
                />
              </Field>
              <Field label="Alternate phone" name="altPhone">
                <TextInput name="altPhone" type="tel" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" name="email">
                <TextInput name="email" type="email" />
              </Field>
              <Field label="City" name="city">
                <TextInput name="city" />
              </Field>
            </div>
            <Field label="Address" name="addressLine">
              <TextArea name="addressLine" rows={2} />
            </Field>

            {searchIsCurrent && likely.length > 0 && (
              <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="flex items-start gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  {likely.length === 1 ? "One record looks like" : `${likely.length} records look like`} the same person.
                </p>
                <Field
                  label="Why is a new record needed?"
                  name="overrideReason"
                  required
                  hint="Recorded with your name so the next person can see what was decided."
                >
                  <TextArea name="overrideReason" rows={2} placeholder="e.g. Different person: twin brother, confirmed with family" />
                </Field>
              </div>
            )}

            <SubmitButton className="w-full" pendingLabel="Registering...">
              Register patient
            </SubmitButton>
          </fieldset>
        </ActionForm>
      </Panel>
    </div>
  );
}
