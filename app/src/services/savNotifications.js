/*
 * SAV — Service de notifications
 * Templates : views/emails/sav/*.ejs
 * Envoi : réutilise emailService.sendEmail (MailerSend)
 * Hook : déclenché depuis SavTicket via savNotifications.notifyStatusChange()
 * Logs : logs/sav-emails.log
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const { sendEmail } = require('./emailService');

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'sav-emails.log');
const TEMPLATES_DIR = path.join(__dirname, '..', 'views', 'emails', 'sav');
const INTERNAL_NOTIFY = process.env.SAV_INTERNAL_EMAIL || 'carparts.france@gmail.com';

function ensureLogDir() {
  try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}
ensureLogDir();

function log(line) {
  try {
    fs.appendFile(LOG_FILE, `${new Date().toISOString()} ${line}\n`, () => {});
  } catch (_) {}
}

async function renderTemplate(name, data) {
  const file = path.join(TEMPLATES_DIR, `${name}.ejs`);
  if (!fs.existsSync(file)) {
    throw new Error(`Template SAV introuvable : ${name}`);
  }
  return ejs.renderFile(file, data, { async: true });
}

// ============================================================
// Mapping statut → template + sujet
// ============================================================

const STATUT_TO_TEMPLATE = {
  ouvert: { template: 'ticket_cree', subject: (t) => `Votre demande SAV ${t.numero} est enregistrée` },
  pre_qualification: { template: 'ticket_cree', subject: (t) => `Votre demande SAV ${t.numero} est enregistrée` },
  en_attente_documents: { template: 'documents_recus', subject: () => 'Documents bien reçus' },
  recu_atelier: { template: 'piece_recue_atelier', subject: () => 'Votre pièce est arrivée à notre atelier' },
  en_analyse: { template: 'analyse_en_cours', subject: () => 'Votre pièce est sur notre banc d\'analyse' },
  resolu_garantie: { template: 'analyse_defaut_produit', subject: () => 'Bonne nouvelle : défaut produit confirmé' },
  resolu_facture: { template: 'analyse_pas_de_defaut', subject: () => 'Rapport d\'analyse de votre pièce' },
};

// ============================================================
// Send helpers
// ============================================================

async function sendForTicket(ticket, templateKey, extra) {
  if (!ticket || !ticket.client || !ticket.client.email) {
    log(`SKIP ${templateKey} ${ticket && ticket.numero} (pas d'email client)`);
    return { ok: false, reason: 'no_email' };
  }
  const cfg = STATUT_TO_TEMPLATE[templateKey] || { template: templateKey, subject: () => 'Suivi de votre demande SAV' };
  try {
    const html = await renderTemplate(cfg.template, { ticket, ...(extra || {}) });
    const subject = typeof cfg.subject === 'function' ? cfg.subject(ticket) : cfg.subject;
    const res = await sendEmail({ toEmail: ticket.client.email, subject, html, text: stripHtml(html) });
    log(`SEND ${cfg.template} → ${ticket.client.email} ticket=${ticket.numero} ok=${!!(res && res.ok)}`);
    return res;
  } catch (err) {
    log(`ERROR ${templateKey} ticket=${ticket && ticket.numero} ${err.message}`);
    return { ok: false, reason: 'render_error', error: err.message };
  }
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ============================================================
// API publique
// ============================================================

async function notifyTicketCreated(ticket) {
  return sendForTicket(ticket, 'pre_qualification');
}

async function notifyStatusChange(ticket, nouveauStatut) {
  if (!STATUT_TO_TEMPLATE[nouveauStatut]) {
    log(`NOOP statut=${nouveauStatut} ticket=${ticket && ticket.numero} (pas de template)`);
    return { ok: false, reason: 'no_template' };
  }
  return sendForTicket(ticket, nouveauStatut);
}

async function notifyRelancePaiement(ticket, jour) {
  const map = { 7: 'relance_paiement_j7', 15: 'mise_en_demeure_j15' };
  const tpl = map[jour] || 'relance_paiement_j7';
  try {
    const html = await renderTemplate(tpl, { ticket });
    const subject = jour === 15
      ? `Mise en demeure — Facture ${ticket.numero}`
      : `Relance — Facture analyse ${ticket.numero}`;
    const res = await sendEmail({ toEmail: ticket.client.email, subject, html, text: stripHtml(html) });
    log(`SEND ${tpl} → ${ticket.client.email} ticket=${ticket.numero}`);
    return res;
  } catch (err) {
    log(`ERROR ${tpl} ticket=${ticket && ticket.numero} ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function notifyRelanceDocuments(ticket) {
  try {
    const html = await renderTemplate('relance_documents', { ticket });
    const res = await sendEmail({
      toEmail: ticket.client.email,
      subject: `Documents manquants — Demande ${ticket.numero}`,
      html, text: stripHtml(html),
    });
    log(`SEND relance_documents → ${ticket.client.email} ticket=${ticket.numero}`);
    return res;
  } catch (err) {
    log(`ERROR relance_documents ticket=${ticket && ticket.numero} ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function notifyInternalEscalation(ticket, motif) {
  try {
    const html = `
      <p>Escalade automatique SAV.</p>
      <ul>
        <li><strong>Ticket :</strong> ${ticket.numero}</li>
        <li><strong>Statut :</strong> ${ticket.statut}</li>
        <li><strong>Client :</strong> ${ticket.client && ticket.client.email}</li>
        <li><strong>Motif :</strong> ${motif}</li>
        <li><strong>SLA limite :</strong> ${ticket.sla && ticket.sla.dateLimite}</li>
      </ul>
      <p><a href="${process.env.SITE_URL || ''}/admin/sav/tickets/${ticket.numero}">Ouvrir le ticket</a></p>
    `;
    const res = await sendEmail({
      toEmail: INTERNAL_NOTIFY,
      subject: `[SAV escalade] ${ticket.numero} — ${motif}`,
      html, text: stripHtml(html),
    });
    log(`SEND escalade → ${INTERNAL_NOTIFY} ticket=${ticket.numero} motif=${motif}`);
    return res;
  } catch (err) {
    log(`ERROR escalade ticket=${ticket && ticket.numero} ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  notifyTicketCreated,
  notifyStatusChange,
  notifyRelancePaiement,
  notifyRelanceDocuments,
  notifyInternalEscalation,
  STATUT_TO_TEMPLATE,
};
