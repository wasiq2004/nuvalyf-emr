"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import {
  createDepartmentAction,
  deleteDepartmentAction,
} from "@/features/departments/department.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const inputClass =
  "h-14 rounded-2xl border-zinc-200 dark:border-zinc-800 focus-visible:border-blue-600 focus-visible:ring-blue-600/30 text-base";

export function CreateDepartmentForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setError(null);

    const result = await createDepartmentAction(null, new FormData(form));
    setPending(false);

    if (!result?.success) {
      setError(result?.error ?? "Failed to create department");
      return;
    }
    toast.success("Department created");
    form.reset();
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name" className="text-zinc-700 dark:text-zinc-300 font-medium">
          Department Name
        </Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Cardiology, Neurology, Pediatrics"
          required
          minLength={2}
          maxLength={255}
          disabled={pending}
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description" className="text-zinc-700 dark:text-zinc-300 font-medium">
          Description <span className="text-xs text-zinc-500 font-normal">(optional)</span>
        </Label>
        <Input
          id="description"
          name="description"
          placeholder="Brief description of the department"
          maxLength={1000}
          disabled={pending}
          className={inputClass}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="w-full h-14 rounded-2xl text-base font-semibold bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 transition-all shadow-lg shadow-blue-500/25 active:scale-[0.985]"
      >
        <Plus className="mr-2 h-5 w-5" />
        {pending ? "Adding..." : "Add Department"}
      </Button>
    </form>
  );
}

export function DeleteDepartmentButton({
  id,
  name,
  doctorCount,
}: {
  id: string;
  name: string;
  doctorCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function handleDelete() {
    setPending(true);
    const result = await deleteDepartmentAction(id);
    setPending(false);

    if (!result?.success) {
      toast.error(result?.error ?? "Failed to delete department");
      return;
    }
    toast.success(`${name} deleted`);
    startTransition(() => router.refresh());
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={`Delete ${name}`}
          className="h-11 w-11 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-xl transition-colors"
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {doctorCount > 0
              ? `${doctorCount} doctor${doctorCount === 1 ? " is" : "s are"} assigned to this department and will be left without one.`
              : "No doctors are assigned to this department."}{" "}
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
