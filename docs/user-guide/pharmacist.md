# Pharmacist guide

You dispense signed prescriptions, sell over the counter, keep stock and raise purchase orders.

## The pharmacy home

**Pharmacy** shows **Prescriptions waiting**, **Sales today**, medicines **Low or out of stock**, and stock **Expiring / expired**:

- **Prescription queue:** signed prescriptions, oldest first. **Part filled** means some items were dispensed; **Asked doctor** means you have an open question.
- **Today's sales.**
- **Needs attention:** medicines that are **Out**, **Low**, **Expired** or **Expiring**.

## Dispensing a prescription

1. Click **Fill**.
2. For each medicine, choose the **Batch**. NuvaLyf suggests the one expiring first, and expired batches cannot be chosen. Under **Sell as**, choose loose **Tablets** or **Strips**, then confirm the **Quantity**. You can never dispense more than the prescribed course, counted in tablets: a strip of 15 cannot be given against a 9-tablet course, so sell 9 loose tablets or ask the doctor. If the patient takes only part now, the rest stays on the prescription as **Part filled**.
3. If something is unclear or unavailable, click **Ask doctor**, type **Your question** and **Send**. The doctor's reply appears under **Questions to the doctor**.
4. Choose **Paid by** (and a **Reference** for card or UPI), then click **Dispense & take ₹X**. Stock is reduced and a receipt is created.

If the patient does not want the medicines, **Close without dispensing** with a **Reason**.

## Over-the-counter sale

1. **New sale**, then **Search a medicine in stock** and add items to the basket.
2. For items that come in strips or packs, choose how each line is sold: loose **Tablets**, or **Strips of 15** (the number is the item's units per pack). A strip is charged at its pack price (usually its MRP); loose tablets at the price per tablet. Stock always goes down in tablets: 2 strips of 15 take 30 tablets out of the batch. Add the same medicine twice to sell some strips and some loose tablets.
3. Under **Payment**, add the customer's name and phone if you want, choose **Paid by**, and click **Complete sale**.
4. **Receipt PDF** prints the receipt. It shows strips as, for example, "2 strips (30 tablets)".

Clicking twice never sells or charges twice.

## Entering a supplier bill

When a delivery arrives with the supplier's bill, type the bill in. Saving it adds every line to stock at once, and sales take the stock down from there.

1. **Purchases → Enter a supplier bill**.
2. Under **Bill**, choose the **Supplier** (or **Add supplier**), and enter the **Bill number** and **Bill date** as printed.
3. For each line on the bill, type the item **as it is printed on the bill** in the item box. NuvaLyf searches every name the item is known by, with the words in any order, so "Needle clinic" finds "Clinic needle 24G".
   - Pick the right item from the list. If the bill spells it differently, NuvaLyf offers **Remember “…” as another name for …**. Leave it ticked and next time that spelling finds the item straight away (shown as **Known as “…”**).
   - If the item is new to the clinic, choose **Add “…” as a new item**. Pick its **Type**: **Medicine** (can be prescribed), **Consumable** (needles, syringes, gauze) or **Instrument**. Give its **Units per pack**, then **Add item**.
4. Fill in the line as printed: **Batch**, **Expiry** (MM/YY is fine), **Qty (packs)**, **Free** packs, **Units / pack**, **Rate / pack**, **MRP / pack** and **GST %**. Under each line you see how many units go into stock and the cost per unit.
5. Use **Add line** for every line on the bill. Check that the **Bill total** matches the paper bill.
6. Leave **Set selling prices from the MRP** ticked to price each item from its MRP: the strip price becomes the MRP, and the tablet price the MRP ÷ tablets per strip.
7. Click **Save bill & add to stock**.

Stock is always counted in single units: 10 strips of 15 tablets plus 2 free strips is (10 + 2) × 15 = 180 tablets. The cost per unit spreads what you paid over the free units too.

A bill number can be entered only once per supplier, and clicking twice saves it once. Saved bills cannot be edited. If something was typed wrongly, correct the stock with **Adjust** on the item's stock page.

## Stock

**Stock** lists every item (medicines, consumables and instruments) with **On hand**, **Reorder at**, **Next expiry** and **Price**. Use **Low / out**, **Expiring** and **Slow moving** to focus.

Open an item to:

- **Add stock:** **Batch number**, **Expiry**, **Quantity (units)**, **Cost per unit**, why it is being added, and a note.
- **Adjust** a batch after a stock count, or to write off expired or damaged stock. Choose the **Reason** and give a note.
- Set **Alert at or below**, the reorder level that puts the medicine on the low-stock list.

Every change is a line in the **Ledger**. Lines are never edited or deleted, so the ledger always explains the current stock. Stock can never go below zero.

## Importing items and opening stock

When the clinic starts using NuvaLyf, bring the item list and current stock in from the old software or a spreadsheet.

1. **Stock → Import items & stock**, then **Template CSV** to see the columns. From Excel, use Save As → CSV.
2. One row per batch: the item's **name**, its **type**, units per pack, selling price, any **other_names** (other spellings or brands, separated by `;`), then **batch_no**, **expiry_date** and **quantity** in single units. Leave the stock columns empty for an item you have none of.
3. **Choose a CSV file** and click **Check file**. Every problem is listed by line, and nothing is imported until the file is clean.
4. Click **Import N rows**. Either everything is imported or nothing is.

A row whose name, or one of its other names, is already in your list adds stock to that item instead of creating a copy.

## Purchase orders

Most deliveries are simply entered from their bill (above). Use a purchase order when an order must be approved before it is placed.

1. **Purchases → New order:** choose the **Supplier** and **Create draft**. Add a supplier first with **Add supplier** if needed.
2. Add lines: **Medicine**, **Quantity**, **Cost / unit**, **Add**.
3. **Submit for approval**. Someone else, usually the Clinic Admin, must **Approve** or **Reject** it. Nobody can approve their own order.
4. When the delivery arrives, **Receive delivery**: enter batch numbers and expiry dates, then **Add to stock**.

Order statuses: **Draft → Awaiting approval → Approved → Received** (or **Rejected** / **Cancelled**).
