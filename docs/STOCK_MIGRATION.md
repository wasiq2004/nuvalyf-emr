# Moving a pharmacy to NuvaLyf

How stock, dues and old bills come across from another system, and how stock stays right afterwards. For the steps staff follow, see [the pharmacist guide](user-guide/pharmacist.md).

The shelf is the truth, not the old software. Count, correct the old system, then load its closing stock once and prove it matches before billing starts.

## The procedure

**Before the day**

1. Export items and batch-wise stock, plus supplier dues and customer credit.
2. Clean the item list: duplicates, pack sizes, HSN/GST, drug schedules.
3. Load the file into a test clinic.

**Cut-off, after closing**

4. Stop sales and enter every pending purchase bill in the old software.
5. Count rack by rack, per batch, reading batch and expiry off the pack. Two people, without seeing the system figure.
6. Keep expired and damaged stock apart.
7. Recount differences, then correct them in the old software with a reason.
8. Print its batch-wise closing stock with quantity and value. The owner signs it.

**Load and prove**

9. Import once. Set the check's batches, units and value against the signed report.
10. Run **Compare with stock here**. Totals can agree while two batches are wrong in opposite directions.
11. Import opening balances, and set their totals against the old outstanding report.
12. Print **Closing stock** from Pharmacy reports and keep it with the signed report.
13. Make the old software read-only. Never bill in both.

**Keeping it right**

- First week: check closing stock daily for fast movers.
- Ongoing: the daily count, about 20 items. Every correction carries a reason.
- Keep the old software's records for at least three years (Drugs Rules 65). Confirm the period for H1 registers with the drug licence consultant.

## What the system does

### Loading stock

`features/pharmacy/stock-import.service.ts`, on `/pharmacy/stock/import`.

| Rule | Why |
|---|---|
| Quantities must be declared as units or packs before a file can be checked; `20:5` means 20 packs and 5 loose | A file cannot say which it counts, and 40 strips read as 40 tablets is the classic migration error. The check spells out the first lines in words |
| A batch already in stock, or loaded by an import not reversed, is refused | A second upload, or a corrected copy, would add every quantity again. Different batches load normally, so a large stock can be split across files |
| The check reports batches, units, value at cost and value at MRP | These are the control totals. Batches with no cost or MRP are counted separately, not silently left out |
| A date is read by the file's own evidence: 31/12/2027 settles day-first, 12/31/2027 month-first. With neither, a date that could go both ways is refused; with both, the file is | Excel in a US locale writes 12/1/2027 for 1 December. Read day-first, that is a wrong expiry with nothing to show for it |
| Excel's `1.2E+05` batches, date serials and negative stock are refused with the reason | The real value is already lost, or the stock needs counting |
| A zero quantity means the item has no stock | Old software lists sold-out batches |
| A pack size that disagrees with the item is refused | Quantities and MRPs would not match |
| Expired stock is recorded, not refused, and cannot be sold | It is on the shelf, has to be counted and goes back to the supplier |
| A pack cost is kept as stated (`stock_batches.pack_cost`) | Rs 12.35 for 15 tablets cannot be held per tablet in two decimals, and value has to match to the rupee |

**Reversing:** `reverseStockImport` posts equal and opposite movements (`import_reversal`) while nothing else has touched those batches. Items stay. After a sale, a stock count corrects what is there.

**Comparing:** `compareStock` reads the old closing stock in the same format and reports batches that match, differ, or are on only one side. It changes nothing.

### Batch MRP

`stock_batches.mrp` is for a pack of `pack_size`. The clinic's item price stands, and `batchPrice` caps it at the batch's MRP, rounding a loose unit down. So a clinic's lower price is kept, and an older batch never sells above its label after the item's price rises.

The import gives an item the highest MRP among its batches, so each batch sells at its own. A batch with no MRP sells at the item's price, as before. Migration 0025 copies MRPs from existing purchase bills.

A later batch can undersell its label: if the item's price is set lower than a batch's MRP, the lower price applies.

### Stock counts

`features/pharmacy/stock-count.service.ts`, on `/pharmacy/stock/counts`.

- **Blind.** The count screen and sheet never receive the system figure.
- **No need to close.** Saving a count records the ledger's figure at that moment, unseen. A sale afterwards cannot read as a shortage.
- **One open count at a time** (a unique index). Two would each correct the same batch.
- **Posting** moves every difference through the ledger in one transaction, with its reason. A database trigger stops a posted or cancelled count from changing.
- **Daily count:** H1 and X stock not counted in 30 days first, then whatever has waited longest, fastest sellers first among equals.

### Opening balances

`account_openings` is the first document on an account, so balances stay sums of documents. It is append-only: a correction is another row with a minus and a note. No tax and no stock move. An import refuses a party that already has an opening balance.

### Returns on old bills

A credit note can be against an old bill (`sale_returns.old_bill_no`) instead of a sale. There is nothing to check it against, so the pharmacist states the amount and the note carries the HSN, rate and cost a sale line would have. GST reports treat it like any credit note. Units fit to resell go back into the batch; the rest are recorded and written off as damaged. A second note on one bill needs a tick.

### Proving the match

- **Pharmacy reports > Closing stock:** batch by batch from the ledger, for any date, with sellable and expired totals and CSV.
- **Pharmacy reports > Stock movement:** start + in - out = end, and whether every batch agrees with its ledger.

## Limits

- A count does not need two people: the system records who counted and who posted, but one person can do both, for clinics with a single pharmacist.
- Sales history does not come across. Keep the old software readable.
- A return on an old bill cannot be checked against what was sold.
- Damaged stock is left out of the file, or written off after loading. It has no held state.
- GST on a credit note against an invoice from an earlier period is for the clinic's accountant to review.
