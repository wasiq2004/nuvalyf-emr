# Pharmacy: design for GST, returns, accounts, compliance and reports

Status: approved for build (client request after the Shopaid comparison). This extends the pharmacy module (Phase 6, supplier bills, selling by the strip, the Indian medicine list) with what an Indian retail pharmacy needs every day.

## 1. Goals

1. **GST-correct sales.** Every sale is a tax invoice (or a bill of supply for a composition dealer), with HSN, GST rate and the CGST/SGST split per line, and a financial-year invoice series.
2. **Nothing is ever edited.** Sales, returns, purchase returns, receipts and payments are documents. A mistake is corrected by another document that points at the first (credit note, debit note). Stock moves only through the ledger.
3. **Money is exact.** All arithmetic is in integer paise. Every derived figure (tax, discount share, round-off) is computed once, stored on the document, and checked by the database where possible.
4. **The law is enforced, not just recorded.** Schedule H1 and X medicines cannot leave the counter without the prescriber and patient details the register needs.
5. **Accounts fall out of the documents.** Outstanding balances (customers and suppliers) are sums over documents, never a running total someone can drift.

## 2. Non-goals (this round)

- E-way bills, e-invoicing (IRN/QR): clinics' turnover is far below the thresholds.
- Filing returns online: we produce the figures and files a CA or the GST offline tool uses.
- IGST: a retail pharmacy sells within its own state. Inter-state supply is modelled (place of supply) but only B2B customers in another state produce IGST.
- Multi-store and internal transfer.

## 3. Data model

New and changed tables (all clinic-scoped, row-level security as everywhere else):

| Table | Purpose | Mutable? |
|---|---|---|
| `pharmacy_settings` | GSTIN, state code, GST scheme (regular / composition / unregistered), drug licence numbers (20B/21B), round-off on/off, defaults for new medicines (HSN 3004, GST 5 %), reorder lead and cover days | Yes (Clinic Admin) |
| `drugs` + `hsn`, `gst_rate`, `schedule`, `rack`, `barcode` | Tax and compliance attributes of an item; barcode unique per clinic | Yes |
| `pharmacy_customers` | Named customers: optional patient link, phone, address, GSTIN (B2B), state, credit limit | Yes |
| `pharmacy_sales` + `discount`, `round_off`, `taxable_total`, `tax_total`, `customer_id`, `prescriber_name`, `prescriber_reg_no`, `patient_address`, `document_type`, `fiscal_year` | The invoice header | Append-only |
| `pharmacy_sale_items` + `hsn`, `gst_rate`, `gross`, `discount`, `taxable`, `cgst`, `sgst`, `igst`, `schedule`, `unit_cost` | Invoice lines with their tax and cost snapshot | Append-only |
| `sale_returns`, `sale_return_items` | Credit notes: a return or a cancellation of an earlier sale, with tax reversed per line | Append-only |
| `purchase_returns`, `purchase_return_items` | Debit notes: stock sent back to a supplier (typically expired or damaged), with input tax reversed | Append-only |
| `customer_receipts` | Money received against a customer's outstanding balance | Append-only |
| `supplier_payments` | Money paid against a supplier's outstanding balance | Append-only |
| `stock_movements.reason` + `supplier_return` | Stock leaving to a supplier | (ledger) |

### Why these shapes

- **Tax is stored per line, not recomputed.** GST rates change (they did in Sept 2025). A report for last year must show last year's tax, so each sale line keeps the HSN, rate and amounts it was sold with.
- **Each batch keeps its printed MRP** (`stock_batches.mrp`, for a pack of `pack_size`). The clinic's item price stands, but `batchPrice` never lets a batch sell above what is printed on it. Set from the supplier bill or the import, correctable per batch. See [STOCK_MIGRATION.md](STOCK_MIGRATION.md).
- **Cost is stored per sale line** (`unit_cost` from the batch) so margin reports do not depend on batches that may later be adjusted.
- **Cancellation is a credit note**, not a status flag. `pharmacy_sales` is append-only; a sale is "cancelled" when a cancellation note covers it fully. This keeps the audit story and the GST credit-note story identical.
- **Customers are separate from patients.** Walk-in buyers, B2B buyers (nursing homes) and patients all buy from a pharmacy. A customer may link to a patient; credit is only ever given to a named customer.

## 4. Rules (pure modules, unit tested)

### 4.1 Sale pricing and GST (`features/pharmacy/gst-rules.ts`)

Prices are **tax-inclusive** (MRP-based retail). For each line:

1. `gross` = price × quantity (paise).
2. Bill discount is shared across lines in proportion to `gross` (largest-remainder method, so the shares add up to the discount exactly).
3. `net` = gross − discount share. This is the tax-inclusive value of supply.
4. `taxable` = round(net × 100 / (100 + rate)); `tax` = net − taxable.
5. Intra-state: `cgst` = floor(tax / 2), `sgst` = tax − cgst. Inter-state (B2B customer in another state): `igst` = tax.
6. Composition and unregistered dealers: rate is treated as 0 on the invoice (bill of supply); tax fields are 0.

Invoice: `total before round-off` = Σ net. If round-off is on, `round_off` = nearest rupee − total (−0.50 … +0.49), and `total` = rounded value. Round-off is not part of taxable value.

### 4.2 Returns (`features/pharmacy/return-rules.ts`)

- A line can be returned up to `sold − already returned` units.
- The refund for returned units is the line's `net` × returned / sold, computed in paise with the last return of a line taking exactly what is left (so a fully returned line always refunds its exact net, and tax reversal sums to the original tax).
- Tax reversed is computed the same way from the line's taxable/CGST/SGST/IGST.
- Round-off is refunded only on a full cancellation.
- Stock goes back into the same batch (reason `return`), even if it has since expired. An expired batch simply cannot be sold again.
- A cancellation is allowed only for a sale with no returns yet, and only within the clinic's cancellation window (same day by default); after that, use a return.
- Returns against a prescription reduce what counts as dispensed, so the course can be filled again.

### 4.3 Purchase returns

- Return from a batch: up to what is on hand in that batch, including expired stock (the usual reason).
- Value per unit = the batch's cost; input tax reversed at the GST rate on the bill line that brought the batch in (or the item's rate if the batch has no bill).
- Optional link to the supplier bill; the debit note number series is separate.

### 4.4 Accounts

- **Customer balance** = Σ credit sales − Σ credit-note refunds credited to the account − Σ receipts. Credit sale refused if it would exceed the credit limit (when set).
- **Supplier balance** = Σ bills − Σ debit notes − Σ payments.
- A refund for a returned item goes back by the original method, or to the customer's account for a credit sale.

### 4.5 Schedule H, H1, X (`features/pharmacy/schedule-rules.ts`)

| Schedule | At the counter |
|---|---|
| none / G | Nothing extra |
| H | Prescriber name required ("sold on prescription") |
| H1 | Prescriber name and registration number, patient name and address required; line goes to the H1 register |
| X | As H1; also never sold without a prescriber registration number |

When dispensing a signed prescription, the details come from the prescription itself.

The **Schedule H1 register** (Drugs Rules 65(9)) lists: date, invoice, patient name and address, prescriber name and registration number, drug, batch, quantity. It is a report over sale lines, exportable.

### 4.6 Numbering

Financial-year series, at most 16 characters as GST requires: `S/2627/000001` (sales), `CN/2627/000001` (credit notes), `DN/2627/000001` (debit notes), `RC/2627/000001` (receipts), `PY/2627/000001` (supplier payments). FY = April–March in the clinic's timezone. Counters reset per FY; the counter row lock is taken last in the transaction (lesson from the load test).

### 4.7 Reordering

For each active item: average daily units out over the last 30 days (sales and dispensing), lead time L and cover C days (settings). Suggest an order when on-hand ≤ reorder level, or on-hand < daily × L. Quantity = ceil(daily × (L + C)) − on-hand, rounded up to whole packs. Suggestions are grouped by the supplier of the item's latest bill; one click creates draft purchase orders, which still go through approval.

### 4.8 Barcodes and racks

- `barcode` is unique per clinic; scanning (a scanner types the code and Enter) into the counter-sale search adds the item directly.
- `rack` is shown wherever a pharmacist picks stock.
- Labels: Code 128 (pure encoder, unit tested) printed from the browser with name, MRP and batch/expiry.

## 5. Reports (`/pharmacy/reports`)

| Report | Built from |
|---|---|
| Daily sales, by payment mode, by user | sales − credit notes |
| Item-wise sales and margin | sale lines (net, taxable, unit cost) − return lines |
| GST output (by rate, by HSN) | sale lines − credit-note lines |
| GST input (by rate, by HSN) | bill lines − debit-note lines |
| GSTR-1 (B2B, B2C small, credit notes, HSN summary, documents issued) | as above, per month |
| GSTR-3B (3.1 outward taxable supplies, 4 eligible ITC) | as above, per month |
| Schedule H1 register | H1/X sale lines |
| Customer outstanding, supplier outstanding | accounts (4.4) |

Every report is a dated query over append-only documents, so re-running it for a closed month always gives the same answer. Each has a CSV export, which is audited.

## 6. Permissions

| Permission | Who (default) | Covers |
|---|---|---|
| `pharmacy:sell`, `pharmacy:dispense` | Pharmacist | Sales; now also discount within the clinic limit, customers |
| `pharmacy:return` (new) | Pharmacist | Sales returns |
| `pharmacy:cancel` (new) | Clinic Admin | Cancelling a sale; discounts above the clinic limit |
| `stock:manage` | Pharmacist | Purchase returns, reorder, labels |
| `accounts:manage` (new) | Clinic Admin, Pharmacist | Receipts, supplier payments, customer credit limits |
| `pharmacy:reports` (new) | Clinic Admin, Pharmacist | Pharmacy and GST reports |
| `settings:manage` | Clinic Admin | Pharmacy settings |

## 7. Migration of existing data

- Existing sales keep their numbers and are treated as GST 0 with no HSN (they predate the settings); reports mark them "before GST setup".
- Items get HSN/GST defaults only when the clinic saves pharmacy settings with "apply defaults to medicines without HSN".

## 8. Testing

- Unit: GST maths (inclusive back-out, discount allocation, round-off, CGST/SGST split), return pro-rating to the paisa, FY numbering, schedule rules, reorder maths, Code 128.
- Integration: a sale with discount and round-off reconciles to the paisa; returns never exceed what was sold and refund exactly; cancellation restores stock; purchase return of an expired batch; balances; H1 sale refused without details; every new table append-only; GSTR-1/3B totals equal the sum of documents.
- End-to-end: a counter sale with discount and a H1 medicine, a return, a credit sale and receipt, a purchase return, the reports.
