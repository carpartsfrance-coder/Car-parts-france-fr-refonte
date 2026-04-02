const Order = require('../models/Order');

/**
 * Expire draft orders older than 30 days.
 * Drafts that haven't been validated within 30 days are automatically cancelled.
 */
async function expireDraftOrders() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await Order.updateMany(
    {
      status: 'draft',
      createdAt: { $lt: thirtyDaysAgo },
    },
    {
      $set: { status: 'cancelled' },
      $push: {
        statusHistory: {
          status: 'cancelled',
          changedAt: new Date(),
          changedBy: 'system (draft expired)',
        },
      },
    }
  );

  if (result.modifiedCount > 0) {
    console.log(`[expireDraftOrders] ${result.modifiedCount} brouillon(s) expiré(s) et annulé(s).`);
  }

  return result.modifiedCount || 0;
}

module.exports = { expireDraftOrders };
