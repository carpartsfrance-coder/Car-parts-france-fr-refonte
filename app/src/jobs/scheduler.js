const cron = require('node-cron');

const { detectAbandonedCarts } = require('./detectAbandonedCarts');
const { sendAbandonedCartReminders } = require('./sendAbandonedCartReminders');
const { expireDraftOrders } = require('./expireDraftOrders');
const { checkOrderAlerts } = require('./checkOrderAlerts');
const { sendConsigneReminders } = require('./sendConsigneReminders');

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

  // Expire draft orders daily at 3:00 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('[scheduler] Vérification brouillons expirés...');
    try {
      await expireDraftOrders();
    } catch (err) {
      console.error('[scheduler] Erreur expiration brouillons:', err.message || err);
    }
  });

  // Check order alerts every hour (at minute 10)
  cron.schedule('10 * * * *', async () => {
    console.log('[scheduler] Vérification alertes commandes...');
    try {
      await checkOrderAlerts();
    } catch (err) {
      console.error('[scheduler] Erreur vérification alertes commandes:', err.message || err);
    }
  });

  // Send consigne reminders daily at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[scheduler] Envoi relances consigne...');
    try {
      await sendConsigneReminders();
    } catch (err) {
      console.error('[scheduler] Erreur relances consigne:', err.message || err);
    }
  });

  console.log('[scheduler] CRON paniers abandonnés programmé (détection :00, relances :05)');
  console.log('[scheduler] CRON alertes commandes programmé (:10)');
  console.log('[scheduler] CRON relances consigne programmé (09:00 quotidien)');
  console.log('[scheduler] CRON expiration brouillons programmé (03:00 quotidien)');
}

module.exports = { startScheduler };
