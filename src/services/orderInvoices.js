const Order = require('../models/Order');
const { getNextInvoiceNumber } = require('./invoiceNumber');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : value ? String(value).trim() : '';
}

async function ensureInvoiceIssuedForPaidOrder(orderId, { date } = {}) {
  if (!orderId) return null;

  const current = await Order.findById(orderId)
    .select('_id paymentStatus invoice')
    .lean();

  if (!current) return null;

  const isPaid = getTrimmedString(current.paymentStatus).toLowerCase() === 'paid';
  const alreadyIssued = current.invoice && typeof current.invoice.number === 'string' && current.invoice.number.trim();

  if (!isPaid || alreadyIssued) return current;

  const next = await getNextInvoiceNumber({ date: date || new Date() });
  const issuedAt = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();

  await Order.updateOne(
    {
      _id: current._id,
      $or: [
        { 'invoice.number': { $exists: false } },
        { 'invoice.number': null },
        { 'invoice.number': '' },
      ],
    },
    {
      $set: {
        'invoice.number': next.invoiceNumber,
        'invoice.issuedAt': issuedAt,
      },
    }
  );

  return Order.findById(current._id)
    .select('_id paymentStatus invoice')
    .lean();
}

module.exports = {
  ensureInvoiceIssuedForPaidOrder,
};
