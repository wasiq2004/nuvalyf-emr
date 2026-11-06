// Pure rules for documents attached to a lab test (unit tested). What a file
// is comes from its first bytes, never from its name or the browser's word.
// docs/LAB_REPORTS.md.

export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_ORDER = 10;
/** A printed report carries at most this much; the rest stay in the record. */
export const MAX_PRINTED_BYTES = 40 * 1024 * 1024;
/** For the file picker. The server decides from the content. */
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

const EXTENSIONS: Record<DocumentType, string[]> = { "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] };

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b);

export function sniffDocumentType(bytes: Uint8Array): DocumentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

/** A name safe to store and show: no folders or control characters, and the right extension. */
export function cleanFileName(name: string, type: DocumentType): string {
  const base = (name.split(/[/\\]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim();
  const extensions = EXTENSIONS[type];
  const lower = base.toLowerCase();
  const found = extensions.find((e) => lower.endsWith(e));
  const stem = found ? base.slice(0, -found.length) : base;
  return `${(stem || "document").slice(0, 190).trim()}${found ?? extensions[0]}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Opens in the browser, and saves under its own name, whatever script it is in. */
export function inlineDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`;
}

/** Which documents fit on a printed report, in order, within the size limit. */
export function documentsToPrint<T extends { sizeBytes: number }>(documents: T[], limit = MAX_PRINTED_BYTES): T[] {
  let total = 0;
  return documents.filter((d) => {
    if (total + d.sizeBytes > limit) return false;
    total += d.sizeBytes;
    return true;
  });
}

/**
 * The EXIF orientation of a JPEG, 1 when there is none. Phones store a portrait
 * photo sideways and record the turn here; a PDF does not apply it for us.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return 1;
    const marker = bytes[at + 1];
    if (marker === 0xda) return 1; // image data starts: no EXIF before it
    const length = view.getUint16(at + 2);
    if (length < 2) return 1;
    if (marker === 0xe1 && at + 10 <= bytes.length && startsWith(bytes.subarray(at + 4), [0x45, 0x78, 0x69, 0x66, 0, 0])) {
      return exifOrientation(view, at + 10, Math.min(at + 2 + length, bytes.length));
    }
    at += 2 + length;
  }
  return 1;
}

function exifOrientation(view: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = view.getUint16(tiff) === 0x4949;
  const entries = tiff + view.getUint32(tiff + 4, little);
  if (entries < tiff || entries + 2 > end) return 1;
  const count = view.getUint16(entries, little);
  for (let i = 0; i < count; i++) {
    const entry = entries + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
