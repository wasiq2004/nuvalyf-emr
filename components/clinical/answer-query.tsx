"use client";

import { ActionForm, SubmitButton, TextInput } from "@/components/app/form";
import { answerQueryAction } from "@/features/pharmacy/pharmacy.actions";

/** The prescriber's reply to a pharmacy question. */
export function AnswerQueryForm({ id }: { id: string }) {
  return (
    <ActionForm action={answerQueryAction} successMessage="Answer sent to the pharmacy" className="space-y-0">
      <input type="hidden" name="id" value={id} />
      <div className="flex gap-2">
        <TextInput name="response" aria-label="Your answer" placeholder="Your answer" className="h-10" />
        <SubmitButton variant="secondary" size="sm">
          Reply
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
