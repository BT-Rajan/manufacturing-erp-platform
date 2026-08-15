/**
 * Discount + tax math shared by quotations, orders, and purchase
 * orders -- one implementation instead of three, same reasoning as
 * core/workflow.ts and capacityService.ts.
 *
 * Pricing flow for a document:
 *   1. Each line's own total already has its line-level discount
 *      applied (priceLine) -- quantity * unitPrice, minus that line's
 *      own discountPercent.
 *   2. subtotalAmount = sum of those already-discounted line totals.
 *   3. A document-level discountPercent is applied on top of the
 *      subtotal, producing discountAmount and a taxableAmount.
 *   4. taxRate is applied to the taxable amount, producing taxAmount.
 *   5. totalAmount = taxableAmount + taxAmount.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function priceLine(quantity: number, unitPrice: number, discountPercent = 0): number {
  const gross = quantity * unitPrice;
  return round2(gross - gross * (discountPercent / 100));
}

export interface DocumentTotals {
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export function computeDocumentTotals(subtotal: number, discountPercent: number, taxRate: number): DocumentTotals {
  const discountAmount = round2(subtotal * (discountPercent / 100));
  const taxableAmount = round2(subtotal - discountAmount);
  const taxAmount = round2(taxableAmount * (taxRate / 100));
  const totalAmount = round2(taxableAmount + taxAmount);
  return { discountAmount, taxableAmount, taxAmount, totalAmount };
}
