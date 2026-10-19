import { FinanceInvoice } from '../entities/finance-invoice.entity';
import { FinanceInvoiceStatus } from '../enums';

/** A write-off clears collection, but must never count as money received. */
export function applyInvoiceSettlement(
  invoice: FinanceInvoice,
  paid = Number(invoice.paidAmount || 0),
) {
  const total = Number(invoice.totalAmount || 0);
  const writtenOff = Number(invoice.writtenOffAmount || 0);
  invoice.paidAmount = paid.toFixed(2);
  invoice.balanceDue = Math.max(0, total - paid - writtenOff).toFixed(2);
  if (
    [FinanceInvoiceStatus.Cancelled, FinanceInvoiceStatus.Void].includes(
      invoice.status,
    )
  )
    return;
  if (paid >= total && writtenOff === 0 && total > 0) {
    invoice.status = FinanceInvoiceStatus.Paid;
    invoice.paidAt = invoice.paidAt ?? new Date();
  } else {
    invoice.status =
      paid > 0
        ? FinanceInvoiceStatus.PartiallyPaid
        : invoice.issuedAt || invoice.issueDate
          ? FinanceInvoiceStatus.Issued
          : FinanceInvoiceStatus.Draft;
    invoice.paidAt = null;
  }
}
