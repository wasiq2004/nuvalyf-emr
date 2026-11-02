// Code 128 (set B) encoder for shelf and batch labels (unit tested).
// docs/PHARMACY_DESIGN.md 4.8. Set B covers printable ASCII, which is what
// clinic-assigned codes and most manufacturer codes use. Each symbol is six
// alternating bar/space widths summing to 11 modules; the stop is 13.

/** Widths for symbol values 0-106 (103-105 are the start codes, 106 is stop). */
export const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const START_B = 104;
const STOP = 106;

export function isEncodable(text: string): boolean {
  return text.length > 0 && text.length <= 64 && [...text].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
}

/** Symbol values for `text`: start B, data, checksum, stop. */
export function encodeValues(text: string): number[] {
  if (!isEncodable(text)) throw new Error("Code 128 B takes 1-64 printable ASCII characters");
  const data = [...text].map((c) => c.charCodeAt(0) - 32);
  const checksum = (START_B + data.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [START_B, ...data, checksum, STOP];
}

/** Bars as [x, width] in modules, including the 10-module quiet zones. */
export function bars(text: string): { bars: [number, number][]; width: number } {
  const out: [number, number][] = [];
  let x = 10;
  for (const value of encodeValues(text)) {
    const widths = PATTERNS[value];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]);
      if (i % 2 === 0) out.push([x, w]);
      x += w;
    }
  }
  return { bars: out, width: x + 10 };
}
