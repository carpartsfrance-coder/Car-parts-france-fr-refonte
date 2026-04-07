/*
 * SAV — Wrapper Mollie pour facturation 149€
 * S'appuie sur services/mollie.js (createPayment / getPayment).
 * Variables d'env utilisées :
 *   - MOLLIE_API_KEY      (déjà utilisé par mollie.js)
 *   - MOLLIE_WEBHOOK_URL  (URL publique du webhook SAV ; sinon construit depuis SITE_URL)
 *   - SITE_URL            (pour le redirectUrl)
 */

const mollie = require('./mollie');
const SavTicket = require('../models/SavTicket');

const PRICE_CENTS_149 = 14900;

function getSiteUrl() {
  return (process.env.SITE_URL || 'https://www.carpartsfrance.fr').replace(/\/$/, '');
}

function getWebhookUrl() {
  const fromEnv = (process.env.MOLLIE_WEBHOOK_URL || '').trim();
  if (fromEnv) return fromEnv;
  return `${getSiteUrl()}/api/sav/mollie-webhook`;
}

async function createPayment149(ticketNumero) {
  const ticket = await SavTicket.findOne({ numero: ticketNumero });
  if (!ticket) throw new Error(`Ticket SAV introuvable : ${ticketNumero}`);

  if (ticket.analyse && ticket.analyse.conclusion === 'defaut_produit') {
    throw new Error('Facturation 149€ interdite : conclusion = défaut produit');
  }

  const payment = await mollie.createPayment({
    amountCents: PRICE_CENTS_149,
    description: `Analyse SAV ${ticket.numero} - Car Parts France`,
    redirectUrl: `${getSiteUrl()}/sav/suivi/${encodeURIComponent(ticket.numero)}`,
    webhookUrl: getWebhookUrl(),
    metadata: { savNumero: ticket.numero, kind: 'sav-analyse-149' },
  });

  if (!payment || !payment.id) {
    throw new Error('Réponse Mollie invalide (pas d\'id)');
  }

  ticket.paiements = ticket.paiements || {};
  ticket.paiements.facture149 = {
    status: 'a_facturer',
    mollieId: payment.id,
    dateGeneration: new Date(),
  };
  ticket.analyse = ticket.analyse || {};
  ticket.analyse.facture149 = { status: 'a_facturer' };
  ticket.addMessage('admin', 'interne', `Lien de paiement Mollie généré (${payment.id})`);
  await ticket.save();

  return {
    mollieId: payment.id,
    paymentUrl: payment._links && payment._links.checkout && payment._links.checkout.href,
    status: payment.status,
  };
}

// Mapping Mollie status → notre statut interne
function mapMollieStatus(s) {
  if (s === 'paid') return 'payee';
  if (s === 'failed' || s === 'canceled' || s === 'expired') return 'impayee';
  return 'a_facturer'; // open / pending / authorized
}

async function handleWebhook(mollieId) {
  if (!mollieId) throw new Error('mollieId manquant');
  const payment = await mollie.getPayment(mollieId);
  if (!payment) throw new Error('Paiement Mollie introuvable');

  const savNumero = payment.metadata && payment.metadata.savNumero;
  if (!savNumero) {
    return { ok: false, reason: 'no_sav_metadata', mollieId };
  }

  const ticket = await SavTicket.findOne({ numero: savNumero });
  if (!ticket) {
    return { ok: false, reason: 'ticket_not_found', mollieId, savNumero };
  }

  const newStatus = mapMollieStatus(payment.status);
  ticket.paiements = ticket.paiements || {};
  ticket.paiements.facture149 = ticket.paiements.facture149 || {};
  ticket.paiements.facture149.status = newStatus;
  ticket.paiements.facture149.mollieId = mollieId;
  if (newStatus === 'payee') {
    ticket.paiements.facture149.datePaiement = new Date();
    if (ticket.analyse) ticket.analyse.facture149 = { status: 'payee' };
    ticket.addMessage('systeme', 'interne', `Paiement 149€ confirmé (Mollie ${mollieId})`);
  } else if (newStatus === 'impayee') {
    if (ticket.analyse) ticket.analyse.facture149 = { status: 'impayee' };
    ticket.addMessage('systeme', 'interne', `Paiement 149€ échoué/annulé (Mollie ${mollieId}, status=${payment.status})`);
  }
  await ticket.save();

  return { ok: true, savNumero, mollieStatus: payment.status, internalStatus: newStatus };
}

module.exports = {
  createPayment149,
  handleWebhook,
  PRICE_CENTS_149,
};
