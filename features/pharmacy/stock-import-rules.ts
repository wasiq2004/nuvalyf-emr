// Pure rules for importing items and opening stock from a spreadsheet (unit
// tested). One row per batch; an item without stock is a row without a
// quantity. Rows naming the same item add batches to it. The service matches
// names against the clinic's list and commits everything or nothing.
import { parseCsv } from "@/features/import/import-rules";
import { normalizeExpiry } from "./purchase-rules";
import { DRUG_FORMS } from "@/features/catalog/catalog-options";
import { ITEM_TYPES, normalizeItemName, type ItemType } from "@/features/catalog/item-rules";
import { SCHEDULES } from "./schedule-rules";
import { isValidDateString } from "@/lib/time";

export { parseCsv, normalizeExpiry };

export const MAX_STOCK_IMPORT_ROWS = 3000;

/** What the quantity column counts. Asked of the person: a file cannot say. */
export const QUANTITY_BASES = ["units", "packs"] as const;
export type QuantityBasis = (typeof QUANTITY_BASES)[number];

export type DateOrder = "dmy" | "mdy" | "ambiguous" | "mixed";
const FULL_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/**
 * Who wrote the file: 31/12/2027 settles day-first, 12/31/2027 month-first.
 * Excel in a US locale writes 12/1/2027 for 1 December; read day-first that is
 * 12 January, a wrong expiry with nothing to show for it. A file with nothing
 * to settle it stays "ambiguous", and only its dates that could go either way
 * are refused.
 */
export function dateOrderOf(values: string[]): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  let unsure = false;
  for (const value of values) {
    const match = FULL_DATE.exec(value.trim());
    if (!match) continue;
    const [a, b] = [Number(match[1]), Number(match[2])];
    if (a > 12) dayFirst = true;
    else if (b > 12) monthFirst = true;
    else if (a !== b) unsure = true;
  }
  if (dayFirst && monthFirst) return "mixed";
  if (dayFirst) return "dmy";
  if (monthFirst) return "mdy";
  return unsure ? "ambiguous" : "dmy";
}

export function parseExpiry(value: string, order: DateOrder): string {
  const match = FULL_DATE.exec(value.trim());
  if (match && order === "mdy") return normalizeExpiry(`${match[2]}/${match[1]}/${match[3]}`);
  return normalizeExpiry(value);
}

const couldBeEither = (value: string) => {
  const match = FULL_DATE.exec(value.trim());
  return Boolean(match) && Number(match![1]) <= 12 && Number(match![2]) <= 12 && match![1] !== match![2];
};

/** "4", or strips and loose as old software writes them: "2:5" or "2+5". */
export function parsePackQuantity(value: string): { packs: number; loose: number } | null {
  const match = /^(\d{1,7})(?:\s*[:+]\s*(\d{1,5}))?$/.exec(value.trim());
  return match ? { packs: Number(match[1]), loose: Number(match[2] ?? 0) } : null;
}

const COLUMNS: Record<string, string[]> = {
  name: ["name", "item", "item name", "medicine", "product", "product name"],
  itemType: ["type", "item type"],
  genericName: ["generic name", "generic", "composition", "salt"],
  form: ["form", "dosage form"],
  strength: ["strength"],
  manufacturer: ["manufacturer", "company", "mfr", "brand company"],
  category: ["category", "group"],
  packSize: ["units per pack", "pack size", "pack"],
  price: ["selling price", "price", "price per unit", "mrp per unit"],
  packPrice: ["pack price", "price per pack", "strip price", "mrp per pack", "mrp"],
  packCost: ["pack cost", "cost per pack", "rate per pack", "purchase rate per pack", "ptr"],
  reorderLevel: ["reorder level", "reorder", "min stock", "minimum stock"],
  otherNames: ["other names", "aliases", "also known as"],
  hsn: ["hsn", "hsn code", "hsn sac"],
  gstRate: ["gst", "gst %", "gst rate", "tax %", "tax rate"],
  schedule: ["schedule", "drug schedule"],
  rack: ["rack", "location", "shelf"],
  barcode: ["barcode", "bar code", "ean"],
  batchNo: ["batch no", "batch", "batch number"],
  expiryDate: ["expiry date", "expiry", "exp", "exp date"],
  quantity: ["quantity", "qty", "stock", "units", "opening stock"],
  unitCost: ["unit cost", "cost", "cost per unit", "purchase rate"],
};

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

export function mapStockHeaders(header: string[]): { map: Record<string, number>; missing: string[] } {
  const map: Record<string, number> = {};
  header.forEach((raw, index) => {
    const h = normHeader(raw);
    const key = Object.entries(COLUMNS).find(([k, aliases]) => normHeader(k.replace(/([A-Z])/g, " $1")) === h || aliases.includes(h))?.[0];
    if (key && map[key] === undefined) map[key] = index;
  });
  return { map, missing: map.name === undefined ? ["name"] : [] };
}

export type StockImportRow = {
  line: number;
  name: string;
  normalized: string;
  itemType: ItemType;
  genericName: string | null;
  form: string;
  strength: string | null;
  manufacturer: string | null;
  category: string | null;
  packSize: number;
  packSizeGiven: boolean;
  price: string | null;
  packPrice: string | null;
  hsn: string | null;
  gstRate: number | null;
  schedule: string;
  rack: string | null;
  barcode: string | null;
  reorderLevel: number;
  otherNames: string[];
  batch: {
    batchNo: string;
    expiryDate: string;
    /** As written: units, or packs and loose units when the file counts packs. */
    quantity: number;
    packs: number;
    loose: number;
    unitCost: string | null;
    packCost: string | null;
    expired: boolean;
  } | null;
};
export type StockImportProblem = { line: number; field: string; message: string };

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const TYPE_ALIASES: Record<string, ItemType> = { "": "medicine", drug: "medicine", medicine: "medicine", consumable: "consumable", supply: "consumable", instrument: "instrument", equipment: "instrument" };

export function validateStockRows(rows: string[][], today: string, basis: QuantityBasis = "units"): { valid: StockImportRow[]; problems: StockImportProblem[] } {
  const problems: StockImportProblem[] = [];
  if (rows.length < 2) return { valid: [], problems: [{ line: 1, field: "file", message: "The file has no item rows." }] };
  const { map, missing } = mapStockHeaders(rows[0]);
  if (missing.length) return { valid: [], problems: [{ line: 1, field: "header", message: "Missing column: name" }] };
  if (rows.length - 1 > MAX_STOCK_IMPORT_ROWS) {
    return { valid: [], problems: [{ line: 1, field: "file", message: `At most ${MAX_STOCK_IMPORT_ROWS} rows per file; this one has ${rows.length - 1}. Split it.` }] };
  }

  const cell = (row: string[], key: string) => (map[key] === undefined ? "" : (row[map[key]] ?? "").trim());
  const order = dateOrderOf(rows.slice(1).map((row) => cell(row, "expiryDate")));
  if (order === "mixed") {
    return { valid: [], problems: [{ line: 1, field: "expiryDate", message: "Some dates in this file are day-first and others month-first, so none of them can be trusted. Use MM/YYYY or yyyy-mm-dd throughout." }] };
  }
  const valid: StockImportRow[] = [];
  const batches = new Map<string, number>();

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const before = problems.length;
    const problem = (field: string, message: string) => problems.push({ line, field, message });

    const name = cell(row, "name").replace(/\s+/g, " ");
    const normalized = normalizeItemName(name);
    if (!normalized) problem("name", "Name is empty");
    if (name.length > 200) problem("name", "Name is longer than 200 characters");

    const itemType = TYPE_ALIASES[cell(row, "itemType").toLowerCase()];
    if (!itemType) problem("itemType", `"${cell(row, "itemType")}" is not ${ITEM_TYPES.join(", ")}`);

    const formRaw = cell(row, "form").toLowerCase();
    const form = formRaw || (itemType === "medicine" ? "tablet" : "other");
    if (!(DRUG_FORMS as readonly string[]).includes(form)) problem("form", `"${cell(row, "form")}" is not one of: ${DRUG_FORMS.join(", ")}`);

    const packRaw = cell(row, "packSize");
    const packSize = packRaw ? Number(packRaw) : 1;
    const packSizeGiven = packRaw !== "";
    if (!Number.isInteger(packSize) || packSize < 1 || packSize > 10000) problem("packSize", "Units per pack must be a whole number from 1");

    const price = cell(row, "price");
    if (price && !MONEY.test(price)) problem("price", `"${price}" is not an amount like 12 or 12.50`);
    const packPrice = cell(row, "packPrice");
    if (packPrice && !MONEY.test(packPrice)) problem("packPrice", `"${packPrice}" is not an amount like 45 or 45.50`);
    const reorderRaw = cell(row, "reorderLevel");
    const reorderLevel = reorderRaw ? Number(reorderRaw) : 0;
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) problem("reorderLevel", "Reorder level must be a whole number");

    const hsn = cell(row, "hsn").replace(/\s+/g, "");
    if (hsn && !/^\d{4,8}$/.test(hsn)) problem("hsn", `"${hsn}" is not an HSN code (4 to 8 digits)`);
    const gstRaw = cell(row, "gstRate").replace("%", "").trim();
    const gstRate = gstRaw === "" ? null : Number(gstRaw);
    if (gstRate !== null && !(Number.isFinite(gstRate) && gstRate >= 0 && gstRate <= 40)) problem("gstRate", `"${gstRaw}" is not a GST rate`);
    const scheduleRaw = cell(row, "schedule").toUpperCase().replace(/^SCH(EDULE)?\s*/, "");
    const schedule = scheduleRaw === "" || scheduleRaw === "NONE" ? "none" : scheduleRaw;
    if (!(SCHEDULES as readonly string[]).includes(schedule)) problem("schedule", `"${cell(row, "schedule")}" is not none, G, H, H1 or X`);
    const barcode = cell(row, "barcode");
    if (barcode && !/^[\x21-\x7e]{3,64}$/.test(barcode)) problem("barcode", "Barcode has spaces or unusual characters");

    const otherNames = cell(row, "otherNames")
      .split(/[;|]/)
      .map((n) => n.trim().replace(/\s+/g, " "))
      .filter((n) => normalizeItemName(n) && normalizeItemName(n) !== normalized);

    // Opening stock: all of batch, expiry and quantity, or none of them.
    const batchNo = cell(row, "batchNo").toUpperCase();
    const expiryRaw = cell(row, "expiryDate");
    const qtyRaw = cell(row, "quantity");
    const unitCost = cell(row, "unitCost");
    const packCost = cell(row, "packCost");
    const packQuantity = basis === "packs" ? parsePackQuantity(qtyRaw) : null;
    const nothingInStock = qtyRaw !== "" && (basis === "packs" ? packQuantity?.packs === 0 && packQuantity.loose === 0 : Number(qtyRaw) === 0);
    let batch: StockImportRow["batch"] = null;
    // Old software lists sold-out batches with a zero: that is an item, not stock.
    if (!nothingInStock && (batchNo || expiryRaw || qtyRaw)) {
      const expiryDate = parseExpiry(expiryRaw, order);
      const quantity = Number(qtyRaw);
      if (!batchNo) problem("batchNo", "Batch is required when there is stock");
      else if (/^\d+(\.\d+)?e\+?\d+$/i.test(batchNo)) problem("batchNo", `"${cell(row, "batchNo")}" is how Excel shortens a long number, so the real batch is lost. Format the column as Text and export it again`);
      if (batchNo.length > 60) problem("batchNo", "Batch is longer than 60 characters");
      if (!expiryRaw) problem("expiryDate", "Expiry is required when there is stock");
      else if (/^\d{5}$/.test(expiryRaw)) problem("expiryDate", `"${expiryRaw}" is how Excel stores a date. Format the column as a date and export it again`);
      else if (order === "ambiguous" && couldBeEither(expiryRaw)) problem("expiryDate", `"${expiryRaw}" could be read two ways, and nothing else in this file settles it. Write it as MM/YYYY or yyyy-mm-dd`);
      else if (!isValidDateString(expiryDate)) problem("expiryDate", `"${expiryRaw}" is not a date (yyyy-mm-dd, dd/mm/yyyy or mm/yyyy)`);
      if (!qtyRaw) problem("quantity", "Quantity is required when there is a batch");
      else if (qtyRaw.startsWith("-")) problem("quantity", `The old software shows ${qtyRaw} here. Stock cannot be negative: count what is really on the shelf and enter that`);
      else if (basis === "packs") {
        if (!packQuantity) problem("quantity", `"${qtyRaw}" is not a number of packs, like 4, or packs and loose units, like 4:5`);
      } else if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) problem("quantity", "Quantity must be a whole number of units from 1");
      if (unitCost && !MONEY.test(unitCost)) problem("unitCost", `"${unitCost}" is not an amount like 1.25`);
      if (packCost && !MONEY.test(packCost)) problem("packCost", `"${packCost}" is not an amount like 45.50`);
      const key = `${normalized}|${batchNo}|${expiryDate}`;
      const earlier = batches.get(key);
      if (earlier) problem("batchNo", `Same item, batch and expiry as line ${earlier}`);
      else batches.set(key, line);
      batch = {
        batchNo,
        expiryDate,
        quantity: basis === "packs" ? 0 : quantity,
        packs: packQuantity?.packs ?? 0,
        loose: packQuantity?.loose ?? 0,
        unitCost: basis === "packs" ? null : unitCost || null,
        // With quantities in packs, a cost is a cost per pack too.
        packCost: packCost || (basis === "packs" ? unitCost || null : null),
        expired: expiryDate < today,
      };
    }

    if (problems.length > before) return;
    valid.push({
      line,
      name,
      normalized,
      itemType,
      genericName: cell(row, "genericName") || null,
      form,
      strength: cell(row, "strength").slice(0, 60) || null,
      manufacturer: cell(row, "manufacturer").slice(0, 120) || null,
      category: cell(row, "category").slice(0, 80) || null,
      packSize,
      packSizeGiven,
      price: price || null,
      packPrice: packPrice || null,
      hsn: hsn || null,
      gstRate,
      schedule,
      rack: cell(row, "rack").slice(0, 40) || null,
      barcode: barcode || null,
      reorderLevel,
      otherNames,
      batch,
    });
  });

  return { valid, problems };
}

export const STOCK_TEMPLATE_CSV =
  "name,type,generic_name,form,strength,manufacturer,units_per_pack,selling_price,pack_price,reorder_level,other_names,batch_no,expiry_date,quantity,unit_cost\r\n" +
  "Paracetamol 650,medicine,Paracetamol,tablet,650 mg,Micro Labs,15,2.10,31.50,60,Dolo 650; Calpol 650,DL2401,12/2027,300,1.40\r\n" +
  "Paracetamol 650,medicine,Paracetamol,tablet,650 mg,Micro Labs,15,2.10,31.50,60,,DL2405,2028-03-31,150,1.45\r\n" +
  "Clinic needle 24G,consumable,,,,BD,100,3.00,,200,Needle clinic; Hypodermic needle 24G,ND88,06/2029,500,1.20\r\n" +
  "BP apparatus,instrument,,,,Omron,1,,,,,,,,\r\n";
