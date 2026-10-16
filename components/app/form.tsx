"use client";

// Form kit: every form in the app is an <ActionForm> calling a server action
// built with clinicAction()/platformAction(). Field-level errors from the
// server's zod validation appear under the matching field.
import { createContext, useContext, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./buttons";
import { inputClass } from "./styles";

export { inputClass };

type FormState = { pending: boolean; fieldErrors: Record<string, string> };
const FormContext = createContext<FormState>({ pending: false, fieldErrors: {} });

export function useFormState() {
  return useContext(FormContext);
}

export function ActionForm<R>({
  action,
  children,
  successMessage,
  onSuccess,
  resetOnSuccess = false,
  refresh = true,
  className,
}: {
  action: (input: FormData) => Promise<ActionResult<R>>;
  children: React.ReactNode;
  successMessage?: string;
  onSuccess?: (data: R) => void;
  resetOnSuccess?: boolean;
  refresh?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    setFieldErrors({});

    let result: ActionResult<R>;
    try {
      result = await action(data);
    } catch {
      result = { ok: false, error: "Could not reach the server. Check your connection and try again." };
    }
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    if (successMessage) toast.success(successMessage);
    if (resetOnSuccess) form.reset();
    onSuccess?.(result.data);
    if (refresh) startTransition(() => router.refresh());
  }

  return (
    <FormContext.Provider value={{ pending, fieldErrors }}>
      <form onSubmit={handleSubmit} className={cn("space-y-5", className)} noValidate>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
        <fieldset disabled={pending} className="m-0 min-w-0 space-y-5 border-0 p-0">
          {children}
        </fieldset>
      </form>
    </FormContext.Provider>
  );
}

const FieldIdContext = createContext<string | undefined>(undefined);

export function Field({
  label,
  name,
  hint,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  name: string;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const { fieldErrors } = useFormState();
  const id = useId();
  const error = fieldErrors[name];
  return (
    <FieldIdContext.Provider value={id}>
      <div className={cn("space-y-1.5", className)}>
        <label htmlFor={id} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
        {children}
        {error ? (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
        ) : (
          hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        )}
      </div>
    </FieldIdContext.Provider>
  );
}


function useFieldProps(name: string) {
  const id = useContext(FieldIdContext);
  const { fieldErrors } = useFormState();
  const invalid = Boolean(fieldErrors[name]);
  return { id, invalid };
}

export function TextInput({
  name,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  const { id, invalid } = useFieldProps(name);
  return (
    <input
      id={props.id ?? id}
      name={name}
      aria-invalid={invalid || undefined}
      className={cn(inputClass, "h-11", invalid && "border-red-400 dark:border-red-700", className)}
      {...props}
    />
  );
}

export function TextArea({
  name,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string }) {
  const { id, invalid } = useFieldProps(name);
  return (
    <textarea
      id={props.id ?? id}
      name={name}
      aria-invalid={invalid || undefined}
      className={cn(inputClass, "min-h-24 py-3", invalid && "border-red-400 dark:border-red-700", className)}
      {...props}
    />
  );
}

export function SelectInput({
  name,
  options,
  placeholder,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  name: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const { id, invalid } = useFieldProps(name);
  return (
    <select
      id={props.id ?? id}
      name={name}
      aria-invalid={invalid || undefined}
      className={cn(inputClass, "h-11 pr-8", invalid && "border-red-400 dark:border-red-700", className)}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function CheckboxCard({
  name,
  value,
  label,
  description,
  defaultChecked,
  disabled,
  onCheckedChange,
}: {
  name: string;
  value: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-(--accent-soft-border) has-[:checked]:border-(--accent-soft-border) has-[:checked]:bg-(--accent-soft) dark:border-zinc-800",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={onCheckedChange ? (e) => onCheckedChange(e.target.checked) : undefined}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-(--accent-solid)"
      />
      <span>
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { pending } = useFormState();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size, className)}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {pending ? (pendingLabel ?? "Saving...") : children}
    </button>
  );
}
