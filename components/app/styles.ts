// Class strings shared by server and client components. Kept out of the
// "use client" form kit: a server component importing a constant from a
// client module receives a client reference, not the string.
export const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 shadow-xs transition-colors placeholder:text-zinc-400 " +
  "focus-visible:border-(--accent-solid) focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-(--accent-soft) " +
  "disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100";
