// Attached lab documents, each opening in a new tab (an audited view).
import { FileImage, FileText } from "lucide-react";
import { formatFileSize } from "@/features/clinical/lab-document-rules";
import { formatDateTime } from "@/lib/format";

type Document = { id: string; fileName: string; contentType: string; sizeBytes: number; uploadedAt: Date; uploadedByName: string | null; testName?: string };

export function LabDocumentIcon({ type }: { type: string }) {
  const Icon = type === "application/pdf" ? FileText : FileImage;
  return <Icon className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />;
}

export function LabDocumentLinks({ documents, timezone }: { documents: Document[]; timezone: string }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {documents.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <LabDocumentIcon type={d.contentType} />
          <div className="min-w-0">
            <a href={`/lab/documents/${d.id}`} target="_blank" rel="noopener" className="block truncate text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
              {d.fileName}
            </a>
            <p className="text-xs text-zinc-500">{[d.testName, formatDateTime(d.uploadedAt, timezone), d.uploadedByName, formatFileSize(d.sizeBytes)].filter(Boolean).join(" · ")}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
