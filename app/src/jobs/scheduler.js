const cron = require('node-cron');

const { detectAbandonedCarts } = require('./detectAbandonedCarts');
const { sendAbandonedCartReminders } = require('./sendAbandonedCartReminders');

function startScheduler() {
  // Detect abandoned carts every hour (at minute 0)
  cron.schedule('0 * * * *', async () => {
    console.log('[scheduler] Lancement détection paniers abandonnés...');
    try {
      await detectAbandonedCarts();
    } catch (err) {
      console.error('[scheduler] Erreur détection paniers abandonnés:', err.message || err);
    }
  });

  // Send abandoned cart reminders every hour (at minute 5, after detection)
  cron.schedule('5 * * * *', async () => {
    console.log('[scheduler] Lancement envoi relances paniers abandonnés...');
    try {
      await sendAbandonedCartReminders();
    } catch (err) {
      console.error('[scheduler] Erreur envoi relances paniers abandonnés:', err.message || err);
    }
  });

  console.log('[scheduler] CRON paniers abandonnés programmé (détection :00, relances :05)');
}

module.exports = { startScheduler };
