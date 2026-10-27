// Pure rules for importing items and opening stock from a spreadsheet (unit
// tested). One row per batch; an item without stock is a row without a
// quantity. Rows naming the same item add batches to it. The service matches
// names against the clinic's list and commits everything or nothing.
import { parseCsv } from "@/features/import/import-rules";
import { normalizeExpiry } from "./purchase-rules";
import { DRUG_FORMS } from "@/features/catalog/catalog-options";
import { ITEM_TYPES, normalizeItemName, type ItemType } from "@/features/catalog/item-rules";
import { isValidDateString } from "@/lib/time";

export { parseCsv, normalizeExpiry };

export const MAX_STOCK_IMPORT_ROWS = 3000;

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
  reorderLevel: ["reorder level", "reorder", "min stock", "minimum stock"],
  otherNames: ["other names", "aliases", "also known as"],
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
  price: string | null;
  packPrice: string | null;
  reorderLevel: number;
  otherNames: string[];
  batch: { batchNo: string; expiryDate: string; quantity: number; unitCost: string | null } | null;
};
export type StockImportProblem = { line: number; field: string; message: string };

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const TYPE_ALIASES: Record<string, ItemType> = { "": "medicine", drug: "medicine", medicine: "medicine", consumable: "consumable", supply: "consumable", instrument: "instrument", equipment: "instrument" };

export function validateStockRows(rows: string[][], today: string): { valid: StockImportRow[]; problems: StockImportProblem[] } {
  const problems: StockImportProblem[] = [];
  if (rows.length < 2) return { valid: [], problems: [{ line: 1, field: "file", message: "The file has no item rows." }] };
  const { map, missing } = mapStockHeaders(rows[0]);
  if (missing.length) return { valid: [], problems: [{ line: 1, field: "header", message: "Missing column: name" }] };
  if (rows.length - 1 > MAX_STOCK_IMPORT_ROWS) {
    return { valid: [], problems: [{ line: 1, field: "file", message: `At most ${MAX_STOCK_IMPORT_ROWS} rows per file; this one has ${rows.length - 1}. Split it.` }] };
  }

  const cell = (row: string[], key: string) => (map[key] === undefined ? "" : (row[map[key]] ?? "").trim());
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
    if (!Number.isInteger(packSize) || packSize < 1 || packSize > 10000) problem("packSize", "Units per pack must be a whole number from 1");

    const price = cell(row, "price");
    if (price && !MONEY.test(price)) problem("price", `"${price}" is not an amount like 12 or 12.50`);
    const packPrice = cell(row, "packPrice");
    if (packPrice && !MONEY.test(packPrice)) problem("packPrice", `"${packPrice}" is not an amount like 45 or 45.50`);
    const reorderRaw = cell(row, "reorderLevel");
    const reorderLevel = reorderRaw ? Number(reorderRaw) : 0;
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) problem("reorderLevel", "Reorder level must be a whole number");

    const otherNames = cell(row, "otherNames")
      .split(/[;|]/)
      .map((n) => n.trim().replace(/\s+/g, " "))
      .filter((n) => normalizeItemName(n) && normalizeItemName(n) !== normalized);

    // Opening stock: all of batch, expiry and quantity, or none of them.
    const batchNo = cell(row, "batchNo").toUpperCase();
    const expiryRaw = cell(row, "expiryDate");
    const qtyRaw = cell(row, "quantity");
    const unitCost = cell(row, "unitCost");
    let batch: StockImportRow["batch"] = null;
    if (batchNo || expiryRaw || qtyRaw) {
      const expiryDate = normalizeExpiry(expiryRaw);
      const quantity = Number(qtyRaw);
      if (!batchNo) problem("batchNo", "Batch is required when there is stock");
      if (batchNo.length > 60) problem("batchNo", "Batch is longer than 60 characters");
      if (!expiryRaw) problem("expiryDate", "Expiry is required when there is stock");
      else if (!isValidDateString(expiryDate)) problem("expiryDate", `"${expiryRaw}" is not a date (yyyy-mm-dd, dd/mm/yyyy or mm/yyyy)`);
      else if (expiryDate < today) problem("expiryDate", "Already expired: leave it out or write it off");
      if (!qtyRaw) problem("quantity", "Quantity is required when there is a batch");
      else if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) problem("quantity", "Quantity must be a whole number of units from 1");
      if (unitCost && !MONEY.test(unitCost)) problem("unitCost", `"${unitCost}" is not an amount like 1.25`);
      const key = `${normalized}|${batchNo}|${expiryDate}`;
      const earlier = batches.get(key);
      if (earlier) problem("batchNo", `Same item, batch and expiry as line ${earlier}`);
      else batches.set(key, line);
      batch = { batchNo, expiryDate, quantity, unitCost: unitCost || null };
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
      price: price || null,
      packPrice: packPrice || null,
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
