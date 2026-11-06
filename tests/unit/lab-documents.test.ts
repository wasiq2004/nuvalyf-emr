import { describe, expect, it } from "vitest";
import { cleanFileName, documentsToPrint, formatFileSize, inlineDisposition, jpegOrientation, sniffDocumentType } from "@/features/clinical/lab-document-rules";
import { addedLineFlag, isCriticalFlag, overallFlag, parseReference, resultSummary } from "@/features/clinical/lab-rules";

const bytes = (...b: number[]) => new Uint8Array(b);

/** A JPEG header with an EXIF block holding one orientation tag. */
function jpegWithOrientation(value: number, little = true) {
  const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) => (little ? [n, 0, 0, 0] : [0, 0, 0, n]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, 0, 0, 0, 0];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = exif.length + 2;
  return bytes(0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...exif, 0xff, 0xda, 0, 2);
}

describe("what a file really is", () => {
  it("goes by the first bytes", () => {
    expect(sniffDocumentType(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(sniffDocumentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffDocumentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });

  it("refuses everything else, whatever it is called", () => {
    for (const text of ["<html><script>", "<svg onload=alert(1)>", "MZ", "PK", "%PDF", ""]) expect(sniffDocumentType(new TextEncoder().encode(text))).toBeNull();
  });
});

describe("file names", () => {
  it("drops folders and control characters and puts the right extension on", () => {
    expect(cleanFileName("C:\\scans\\../CBC report.PDF", "application/pdf")).toBe("CBC report.pdf");
    expect(cleanFileName("/etc/passwd", "image/png")).toBe("passwd.png");
    expect(cleanFileName('a"b\u0000\r\n.pdf', "application/pdf")).toBe("ab.pdf");
    expect(cleanFileName("photo.jpeg", "image/jpeg")).toBe("photo.jpeg");
    expect(cleanFileName("report.exe", "application/pdf")).toBe("report.exe.pdf");
    expect(cleanFileName("", "image/jpeg")).toBe("document.jpg");
  });

  it("stays within the column and keeps the extension", () => {
    const long = cleanFileName(`${"x".repeat(400)}.pdf`, "application/pdf");
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("cannot break out of the download header", () => {
    expect(inlineDisposition('रिपोर्ट "1".pdf')).toMatch(/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''[%A-Za-z0-9._~!*()-]+$/);
    expect(inlineDisposition("a\\b.pdf")).toContain('filename="a_b.pdf"');
  });

  it("shows sizes people can read", () => {
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("printing documents", () => {
  it("takes documents in order up to the limit and carries on past one that is too big", () => {
    const docs = [{ sizeBytes: 30 }, { sizeBytes: 20 }, { sizeBytes: 5 }];
    expect(documentsToPrint(docs, 40)).toEqual([{ sizeBytes: 30 }, { sizeBytes: 5 }]);
  });

  it("reads the turn a phone recorded on a photo", () => {
    for (const value of [1, 3, 6, 8]) {
      expect(jpegOrientation(jpegWithOrientation(value))).toBe(value);
      expect(jpegOrientation(jpegWithOrientation(value, false))).toBe(value);
    }
  });

  it("treats a photo with no usable record of it as upright", () => {
    expect(jpegOrientation(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(99))).toBe(1);
    expect(jpegOrientation(bytes(0xff, 0xd8))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(6).slice(0, 14))).toBe(1);
  });
});

describe("parameters the technician adds", () => {
  it("understands the ways a range is written", () => {
    expect(parseReference("13 - 17")).toEqual({ low: 13, high: 17 });
    expect(parseReference("0.5-2.5")).toEqual({ low: 0.5, high: 2.5 });
    expect(parseReference("13 to 17")).toEqual({ low: 13, high: 17 });
    expect(parseReference("< 5")).toEqual({ low: null, high: 5 });
    expect(parseReference("<=5")).toEqual({ low: null, high: 5 });
    expect(parseReference("Up to 5")).toEqual({ low: null, high: 5 });
    expect(parseReference("> 40")).toEqual({ low: 40, high: null });
  });

  it("leaves alone a range it cannot read", () => {
    for (const text of ["Negative", "0-5 /hpf", "17 - 13", "", null, undefined]) expect(parseReference(text)).toBeNull();
  });

  it("never lets a number outside the typed range stand as normal", () => {
    expect(addedLineFlag("20", "1 - 10", "normal")).toBe("high");
    expect(addedLineFlag("0.2", "1 - 10", undefined)).toBe("low");
    expect(addedLineFlag("6", "< 5", "normal")).toBe("high");
  });

  it("otherwise keeps the technician's choice", () => {
    expect(addedLineFlag("5", "1 - 10", undefined)).toBe("normal");
    expect(addedLineFlag("5", "1 - 10", "abnormal")).toBe("abnormal");
    expect(addedLineFlag("Seen", "Not seen", "abnormal")).toBe("abnormal");
    expect(addedLineFlag("Clear", null, undefined)).toBe("normal");
    expect(addedLineFlag("20", "1 - 10", "critical")).toBe("critical");
  });

  it("a critical added parameter makes the whole test critical", () => {
    expect(isCriticalFlag("critical")).toBe(true);
    expect(overallFlag(["normal", "critical"])).toBe("critical");
    expect(resultSummary([{ name: "Malaria parasite", value: "Seen", unit: null, flag: "critical" }, { name: "Hb", value: "13", unit: "g/dL", flag: "normal" }])).toBe("Malaria parasite Seen (**)");
  });
});
