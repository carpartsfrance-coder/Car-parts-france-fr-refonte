// ---------------------------------------------------------------------------
// checkOrderAlerts.js
// Vérifie les retours en retard (exchange uniquement, PAS exchange_cloning),
// détecte la prise en charge des colis client (clonage) via 17Track,
// et met à jour les statuts automatiquement.
// Tourne toutes les heures via le scheduler.
// ---------------------------------------------------------------------------

const mongoose = require('mongoose');

async function checkOrderAlerts() {
  const dbConnected = mongoose.connection.readyState === 1;
  if (!dbConnected) return;

  const Order = mongoose.model('Order');
  const now = new Date();

  // ─── a) Retours en retard (exchange uniquement, PAS exchange_cloning) ───
  try {
    const overdueResult = await Order.updateMany(
      {
        orderType: 'exchange',
        returnStatus: 'pending',
        'returnDates.returnDueDate': { $lt: now },
        status: { $nin: ['cancelled', 'refunded', 'draft'] },
      },
      { $set: { returnStatus: 'overdue' } }
    );
    if (overdueResult.modifiedCount > 0) {
      console.log(`[checkOrderAlerts] ${overdueResult.modifiedCount} retour(s) marqué(s) en retard (exchange uniquement).`);
    }
  } catch (err) {
    console.error('[checkOrderAlerts] Erreur vérification retours en retard:', err.message);
  }

  // ─── b) Auto-détection prise en charge colis client (clonage) ───
  // Si cloningStatus='label_sent' et qu'on a un trackingNumber,
  // interroger 17Track pour voir si le colis a été pris en charge
  try {
    const track17ApiKey = typeof process.env.TRACK17_API_KEY === 'string'
      ? process.env.TRACK17_API_KEY.trim()
      : '';

    const isProd = process.env.NODE_ENV === 'production';
    const track17EnabledRaw = typeof process.env.TRACK17_ENABLED === 'string'
      ? process.env.TRACK17_ENABLED.trim().toLowerCase()
      : '';
    let track17Enabled = isProd;
    if (track17EnabledRaw) {
      track17Enabled = ['1', 'true', 'yes', 'on'].includes(track17EnabledRaw);
    }

    if (track17Enabled && track17ApiKey) {
      const track17 = require('../services/track17');

      const pendingOrders = await Order.find({
        orderType: 'exchange_cloning',
        cloningStatus: 'label_sent',
        'cloningTracking.trackingNumber': { $exists: true, $ne: '' },
        status: { $nin: ['cancelled', 'refunded', 'draft'] },
      }).select('_id number cloningTracking').lean();

      let advancedCount = 0;
      for (const o of pendingOrders) {
        const tn = o.cloningTracking && o.cloningTracking.trackingNumber;
        if (!tn) continue;

        try {
          const trackingInfo = await track17.getTrackingByNumber(track17ApiKey, tn);
          if (!trackingInfo) continue;

          // Check if parcel has been picked up (status codes: in_transit, picked_up, etc.)
          // 17Track status_code: 0=delivered, 10=in transit, 20=expired, 30=failed, 40=info received
          // Events: check if any event indicates pickup/in_transit
          const events = Array.isArray(trackingInfo.events) ? trackingInfo.events : [];
          const statusCode = trackingInfo.status_code;

          // status_code 10 = in transit, 0 = delivered — both mean picked up
          const isPickedUp = statusCode === 10 || statusCode === 0 || events.some((ev) => {
            if (!ev || !ev.event) return false;
            const lower = String(ev.event).toLowerCase();
            return lower.includes('pris en charge') || lower.includes('picked up') || lower.includes('en transit')
              || lower.includes('collected') || lower.includes('scan') || lower.includes('déposé');
          });

          if (isPickedUp) {
            const order = await Order.findById(o._id);
            if (order && order.cloningStatus === 'label_sent') {
              order.cloningStatus = 'client_piece_in_transit';
              order._statusChangedBy = 'system';
              order._statusChangeNote = 'Prise en charge détectée automatiquement via suivi transporteur';
              await order.save();
              advancedCount++;
            }
          }
        } catch (trackErr) {
          // Silently ignore tracking errors for individual orders
        }
      }

      if (advancedCount > 0) {
        console.log(`[checkOrderAlerts] ${advancedCount} commande(s) clonage : pièce client détectée en transit.`);
      }
    }
  } catch (err) {
    console.error('[checkOrderAlerts] Erreur détection transit clonage:', err.message);
  }
}

module.exports = { checkOrderAlerts };
