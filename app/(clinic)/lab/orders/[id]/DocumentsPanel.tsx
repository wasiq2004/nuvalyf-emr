"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Panel } from "@/components/app/page";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { LabDocumentIcon } from "@/components/clinical/lab-document-links";
import { removeLabDocumentAction, uploadLabDocumentAction } from "@/features/clinical/lab.actions";
import { DOCUMENT_ACCEPT, MAX_DOCUMENT_BYTES, formatFileSize } from "@/features/clinical/lab-document-rules";
import type { LabDocumentRow } from "@/features/clinical/lab-documents.service";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Upload happens as soon as files are chosen, one at a time, so one bad file stops nothing else. */
function Uploader({ orderId }: { orderId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function upload(files: File[]) {
    let sent = 0;
    for (const [index, file] of files.entries()) {
      setProgress(files.length > 1 ? `Uploading ${index + 1} of ${files.length}` : "Uploading");
      if (file.size > MAX_DOCUMENT_BYTES) {
        toast.error(`${file.name} is larger than 10 MB.`);
        continue;
      }
      const form = new FormData();
      form.set("orderId", orderId);
      form.set("file", file);
      try {
        const result = await uploadLabDocumentAction(form);
        if (result.ok) sent += 1;
        else toast.error(`${file.name}: ${result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error}`);
      } catch {
        toast.error(`${file.name} could not be uploaded. Check the connection and try again.`);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    if (sent) {
      toast.success(sent === 1 ? "Document attached" : `${sent} documents attached`);
      router.refresh();
    }
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!progress && e.dataTransfer.files.length) void upload([...e.dataTransfer.files]);
      }}
      className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center transition-colors hover:border-zinc-400 dark:border-zinc-700", over && "border-zinc-500 bg-zinc-50 dark:bg-zinc-900")}
    >
      {progress ? <Loader2 className="h-5 w-5 animate-spin text-zinc-500" /> : <Upload className="h-5 w-5 text-zinc-500" />}
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{progress ?? "Choose files, or drop them here"}</span>
      <span className="text-xs text-zinc-500">PDF, JPG or PNG, up to 10 MB each</span>
      <input
        ref={input}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        aria-label="Upload a supporting document"
        disabled={progress !== null}
        onChange={(e) => {
          if (e.target.files?.length) void upload([...e.target.files]);
        }}
        className="sr-only"
      />
    </label>
  );
}

export function DocumentsPanel({ orderId, canUpload, resulted, documents, timezone }: { orderId: string; canUpload: boolean; resulted: boolean; documents: LabDocumentRow[]; timezone: string }) {
  const description = resulted ? "A document added now goes back to the doctor as unread. It also prints with the report and shows in the patient's record." : "Machine printouts, scanned reports or photos. They print with the report and show in the patient's record.";
  return (
    <Panel title="Supporting documents" description={description}>
      <div className="space-y-4">
        {documents.length > 0 && (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <LabDocumentIcon type={d.contentType} />
                  {d.removedAt ? (
                    <div className="min-w-0">
                      <p className="truncate text-sm text-zinc-400 line-through">{d.fileName}</p>
                      <p className="text-xs text-zinc-500">
                        Removed {formatDateTime(d.removedAt, timezone)}
                        {d.removedByName ? ` by ${d.removedByName}` : ""}: {d.removedReason}
                      </p>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <a href={`/lab/documents/${d.id}`} target="_blank" rel="noopener" className="block truncate text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {d.fileName}
                      </a>
                      <p className="text-xs text-zinc-500">{[formatDateTime(d.uploadedAt, timezone), d.uploadedByName, formatFileSize(d.sizeBytes)].filter(Boolean).join(" · ")}</p>
                    </div>
                  )}
                </div>
                {!d.removedAt && (
                  <FormDialog variant="ghost" size="sm" trigger="Remove" title="Remove this document?" description={`${d.fileName} will no longer show on the patient's record or print with the report. A record of it stays.`}>
                    {(close) => (
                      <ActionForm action={removeLabDocumentAction} successMessage="Document removed" onSuccess={close}>
                        <input type="hidden" name="id" value={d.id} />
                        <Field label="Reason" name="reason" required>
                          <TextInput name="reason" placeholder="e.g. Wrong patient's report" autoFocus />
                        </Field>
                        <div className="flex justify-end">
                          <SubmitButton>Remove document</SubmitButton>
                        </div>
                      </ActionForm>
                    )}
                  </FormDialog>
                )}
              </li>
            ))}
          </ul>
        )}
        {canUpload ? <Uploader orderId={orderId} /> : documents.length === 0 && <p className="text-sm text-zinc-500">No documents.</p>}
      </div>
    </Panel>
  );
}
