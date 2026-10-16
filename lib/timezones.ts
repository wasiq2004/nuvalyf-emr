// Timezone choices for dropdowns.
//
// Intl.supportedValuesOf("timeZone") returns ICU's canonical names, which on
// some runtimes still use legacy spellings (e.g. "Asia/Calcutta" instead of
// "Asia/Kolkata"). A select whose current value is missing from its options
// silently falls back to the first option, which would quietly change a
// clinic's timezone on save. So the list always includes the current value
// and the common modern names.
const ALWAYS_INCLUDE = ["Asia/Kolkata", "UTC"];

export function timezoneOptions(current?: string | null): string[] {
  const zones = new Set<string>(Intl.supportedValuesOf("timeZone"));
  for (const zone of ALWAYS_INCLUDE) zones.add(zone);
  if (current) zones.add(current);
  return [...zones].sort((a, b) => a.localeCompare(b));
}
