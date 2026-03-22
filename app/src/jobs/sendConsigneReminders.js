require('dotenv').config();

const mongoose = require('mongoose');

const Order = require('../models/Order');
const User = require('../models/User');
const emailService = require('../services/emailService');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseIntSafe(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function connectMongo() {
  const uri = getTrimmedString(process.env.MONGODB_URI);
  if (!uri) throw new Error('MONGODB_URI manquant');
  await mongoose.connect(uri);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function run() {
  const reminderDays = parseIntSafe(process.env.CONSIGNE_REMINDER_DAYS || '7', 7);
  const now = new Date();
  const soonLimit = addDays(now, reminderDays);

  const dbState = mongoose.connection.readyState;
  if (dbState !== 1) {
    await connectMongo();
  }

  const dryRun = ['1', 'true', 'yes', 'on'].includes(getTrimmedString(process.env.DRY_RUN).toLowerCase());

  const baseSoonQuery = {
    $or: [
      { 'notifications.consigneReminderSoonSentAt': { $exists: false } },
      { 'notifications.consigneReminderSoonSentAt': null },
    ],
    'consigne.lines': {
      $elemMatch: {
        receivedAt: null,
        dueAt: { $gte: now, $lte: soonLimit },
      },
    },
  };

  const baseOverdueQuery = {
    $or: [
      { 'notifications.consigneOverdueSentAt': { $exists: false } },
      { 'notifications.consigneOverdueSentAt': null },
    ],
    'consigne.lines': {
      $elemMatch: {
        receivedAt: null,
        dueAt: { $lt: now },
      },
    },
  };

  const soonOrders = await Order.find(baseSoonQuery)
    .select('_id number userId consigne notifications')
    .limit(200)
    .lean();

  const overdueOrders = await Order.find(baseOverdueQuery)
    .select('_id number userId consigne notifications')
    .limit(200)
    .lean();

  const report = {
    now: now.toISOString(),
    soon: { candidates: soonOrders.length, sent: 0, skipped: 0, errors: 0 },
    overdue: { candidates: overdueOrders.length, sent: 0, skipped: 0, errors: 0 },
  };

  for (const order of soonOrders) {
    try {
      if (!order || !order.userId) {
        report.soon.skipped += 1;
        continue;
      }

      const user = await User.findById(order.userId).select('_id email firstName').lean();
      if (!user || !user.email) {
        report.soon.skipped += 1;
        continue;
      }

      if (dryRun) {
        report.soon.sent += 1;
        continue;
      }

      const sent = await emailService.sendConsigneReminderSoonEmail({ order, user });
      if (sent && sent.ok) {
        await Order.updateOne(
          {
            _id: order._id,
            $or: [
              { 'notifications.consigneReminderSoonSentAt': { $exists: false } },
              { 'notifications.consigneReminderSoonSentAt': null },
            ],
          },
          { $set: { 'notifications.consigneReminderSoonSentAt': new Date() } }
        );
        report.soon.sent += 1;
      } else {
        report.soon.errors += 1;
      }
    } catch (err) {
      report.soon.errors += 1;
      console.error('Erreur rappel consigne (soon) :', err && err.message ? err.message : err);
    }
  }

  for (const order of overdueOrders) {
    try {
      if (!order || !order.userId) {
        report.overdue.skipped += 1;
        continue;
      }

      const user = await User.findById(order.userId).select('_id email firstName').lean();
      if (!user || !user.email) {
        report.overdue.skipped += 1;
        continue;
      }

      if (dryRun) {
        report.overdue.sent += 1;
        continue;
      }

      const sent = await emailService.sendConsigneOverdueEmail({ order, user });
      if (sent && sent.ok) {
        await Order.updateOne(
          {
            _id: order._id,
            $or: [
              { 'notifications.consigneOverdueSentAt': { $exists: false } },
              { 'notifications.consigneOverdueSentAt': null },
            ],
          },
          { $set: { 'notifications.consigneOverdueSentAt': new Date() } }
        );
        report.overdue.sent += 1;
      } else {
        report.overdue.errors += 1;
      }
    } catch (err) {
      report.overdue.errors += 1;
      console.error('Erreur consigne en retard :', err && err.message ? err.message : err);
    }
  }

  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Job consigne reminders: erreur fatale :', err && err.message ? err.message : err);
  process.exitCode = 1;
});
