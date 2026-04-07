/*
 * SAV — jobs CRON
 * - Toutes les heures : escalade SLA dépassé
 * - Tous les jours 09:00 : relances documents (J+2/J+5/J+8 → refus auto), relances paiement 149€ (J+3/J+7/J+15), pièces > J+90 → "disposable"
 */

const SavTicket = require('../models/SavTicket');
const notif = require('../services/savNotifications');

const STATUTS_SLA = ['en_analyse', 'en_attente_documents'];

async function checkSavSlaEscalation() {
  const now = new Date();
  const tickets = await SavTicket.find({
    statut: { $in: STATUTS_SLA },
    'sla.dateLimite': { $lt: now },
    'sla.escalade': { $ne: true },
  });
  for (const t of tickets) {
    t.sla.escalade = true;
    t.sla.alertes = t.sla.alertes || [];
    t.sla.alertes.push({ date: now, type: 'sla_depasse', message: 'SLA dépassé — escalade auto' });
    t.addMessage('systeme', 'interne', 'SLA dépassé — escalade interne déclenchée');
    await t.save();
    await notif.notifyInternalEscalation(t, 'SLA dépassé');
  }
  return tickets.length;
}

function daysSince(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

async function runSavDailyReminders() {
  let docsRelances = 0;
  let docsRefus = 0;
  let payRelances = 0;
  let payDemeure = 0;
  let disposables = 0;

  // ---------- Documents manquants ----------
  const docTickets = await SavTicket.find({ statut: 'en_attente_documents' });
  for (const t of docTickets) {
    const age = daysSince(t.sla && t.sla.dateOuverture);
    if (age >= 8) {
      t.changerStatut('refuse', 'systeme');
      t.addMessage('systeme', 'interne', 'Refus auto : documents non fournis après J+8');
      await t.save();
      docsRefus += 1;
      continue;
    }
    if (age === 2 || age === 5) {
      await notif.notifyRelanceDocuments(t);
      docsRelances += 1;
    }
  }

  // ---------- Paiement 149€ impayé ----------
  const payTickets = await SavTicket.find({
    'paiements.facture149.status': { $in: ['a_facturer', 'impayee'] },
  });
  for (const t of payTickets) {
    const age = daysSince(t.paiements && t.paiements.facture149 && t.paiements.facture149.dateGeneration);
    if (age === 3 || age === 7) {
      await notif.notifyRelancePaiement(t, 7);
      payRelances += 1;
    } else if (age === 15) {
      await notif.notifyRelancePaiement(t, 15);
      payDemeure += 1;
      t.paiements.facture149.status = 'impayee';
      t.addMessage('systeme', 'interne', 'Mise en demeure J+15 envoyée (art. 2286 Code civil)');
      await t.save();
    } else if (age >= 90) {
      // Marquage manuel "disposable"
      t.sla.alertes = t.sla.alertes || [];
      t.sla.alertes.push({ date: new Date(), type: 'disposable', message: 'Pièce > J+90 impayée — à valider manuellement pour disposition' });
      t.addMessage('systeme', 'interne', 'Pièce > J+90 impayée — flag disposable (validation manuelle requise)');
      await t.save();
      disposables += 1;
    }
  }

  console.log('[sav-cron] daily reminders', {
    docsRelances, docsRefus, payRelances, payDemeure, disposables,
  });
}

module.exports = {
  checkSavSlaEscalation,
  runSavDailyReminders,
};
