/*
 * /sav/suivi — Suivi invité (sans compte).
 * Auth = ticket numéro + email client → stocké en session 24h.
 *        OU lien magique avec token HMAC (depuis les emails).
 * Rate limit : 5 tentatives / 15 min / IP.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SavTicket = require('../models/SavTicket');
const { STATUTS_LABELS } = require('./accountSavController');

const UPLOAD_BASE = path.join(__dirname, '..', '..', '..', 'uploads', 'sav');
function saveAttachments(numero, files) {
  if (!files || !files.length) return [];
  const dir = path.join(UPLOAD_BASE, numero);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const out = [];
  files.forEach((f) => {
    const safe = `${Date.now()}_${(f.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    try {
      fs.writeFileSync(path.join(dir, safe), f.buffer);
      out.push({ kind: 'client_message', url: `/uploads/sav/${numero}/${safe}`, originalName: f.originalname, size: f.size, mime: f.mimetype });
    } catch (_) {}
  });
  return out;
}

const TTL_MS = 24 * 60 * 60 * 1000;

// ---- Magic link token (HMAC-SHA256) ----
const TOKEN_SECRET = process.env.SAV_GUEST_TOKEN_SECRET || process.env.SESSION_SECRET || 'cpf-sav-guest-default-secret';

/**
 * Generate a deterministic token for a ticket.
 * Token = first 32 chars of HMAC-SHA256(numero + email, secret)
 */
function generateGuestToken(numero, email) {
  const payload = `${String(numero).toUpperCase()}:${String(email).toLowerCase().trim()}`;
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex').slice(0, 32);
}

/**
 * Verify a token against a ticket's numero + email.
 */
function verifyGuestToken(token, numero, email) {
  if (!token || !numero || !email) return false;
  const expected = generateGuestToken(numero, email);
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch (_) {
    return false;
  }
}

/**
 * Build the full magic link URL for a ticket.
 */
function buildGuestLink(ticket) {
  if (!ticket || !ticket.numero || !ticket.client || !ticket.client.email) return null;
  const baseUrl = (process.env.SITE_URL || 'https://www.carpartsfrance.fr').replace(/\/$/, '');
  const tk = generateGuestToken(ticket.numero, ticket.client.email);
  return `${baseUrl}/sav/suivi/${encodeURIComponent(ticket.numero)}?tk=${tk}`;
}

function getGuestAuth(req, numero) {
  const g = req.session && req.session.savGuest;
  if (!g || !g.numero || !g.email || !g.exp) return null;
  if (g.exp < Date.now()) return null;
  if (numero && g.numero !== numero) return null;
  return g;
}

// ---- Rate limiting (in-memory) ----
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  return list.length < MAX_ATTEMPTS;
}
function recordAttempt(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
}

// ---- Controllers ----

exports.getSuiviForm = (req, res) => {
  res.render('sav/suivi-form', {
    title: 'Suivre ma demande SAV — CarParts France',
    metaRobots: 'noindex, nofollow',
    canonicalUrl: `${process.env.SITE_URL || 'https://www.carpartsfrance.fr'}/sav/suivi`,
    error: req.query.error || null,
    numero: req.query.numero || '',
  });
};

exports.postSuiviForm = async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) return res.redirect('/sav/suivi?error=rate');

  const numero = String((req.body && req.body.numero) || '').trim();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!numero || !email) return res.redirect('/sav/suivi?error=missing');

  try {
    const ticket = await SavTicket.findOne({ numero, 'client.email': email })
      .select('numero').lean();
    if (!ticket) {
      recordAttempt(ip);
      return res.redirect(`/sav/suivi?error=notfound&numero=${encodeURIComponent(numero)}`);
    }
    req.session.savGuest = { numero, email, exp: Date.now() + TTL_MS };
    return res.redirect(`/sav/suivi/${encodeURIComponent(numero)}`);
  } catch (e) {
    return res.redirect('/sav/suivi?error=server');
  }
};

exports.getSuiviDetail = async (req, res) => {
  const numero = req.params.numero;
  const tk = req.query.tk || '';
  let auth = getGuestAuth(req, numero);

  // Magic link: auto-authenticate via token
  if (!auth && tk) {
    try {
      const ticket = await SavTicket.findOne({ numero }).select('numero client').lean();
      if (ticket && ticket.client && ticket.client.email && verifyGuestToken(tk, numero, ticket.client.email)) {
        // Token valid → create session
        req.session.savGuest = { numero, email: ticket.client.email, exp: Date.now() + TTL_MS };
        auth = req.session.savGuest;
      }
    } catch (_) {}
  }

  if (!auth) {
    return res.redirect(`/sav/suivi?error=auth&numero=${encodeURIComponent(numero)}`);
  }
  try {
    const ticket = await SavTicket.findOne({
      numero,
      'client.email': auth.email,
    }).lean();
    if (!ticket) return res.redirect('/sav/suivi?error=notfound');

    SavTicket.updateOne({ _id: ticket._id }, { $set: { lastClientReadAt: new Date() } }).catch(() => {});

    return res.render('sav/suivi-detail', {
      title: `Suivi SAV ${numero} — CarParts France`,
      metaRobots: 'noindex, nofollow',
      ticket,
      STATUTS_LABELS,
      guestEmail: auth.email,
      sent: req.query.sent === '1',
      error: req.query.error || null,
    });
  } catch (e) {
    return res.redirect('/sav/suivi?error=server');
  }
};

exports.postSuiviMessage = async (req, res) => {
  const numero = req.params.numero;
  const auth = getGuestAuth(req, numero);
  if (!auth) return res.redirect(`/sav/suivi?error=auth&numero=${encodeURIComponent(numero)}`);

  const contenu = String((req.body && req.body.contenu) || '').trim();
  if (!contenu || contenu.length < 5) {
    return res.redirect(`/sav/suivi/${encodeURIComponent(numero)}?error=empty`);
  }
  try {
    const ticket = await SavTicket.findOne({ numero, 'client.email': auth.email });
    if (!ticket) return res.redirect('/sav/suivi?error=notfound');
    const saved = saveAttachments(numero, req.files || []);
    if (saved.length) {
      ticket.documentsList = ticket.documentsList || [];
      saved.forEach((d) => ticket.documentsList.push(d));
    }
    const finalContenu = saved.length
      ? `${contenu}\n\n📎 ${saved.length} pièce(s) jointe(s) :\n${saved.map((d) => '• ' + d.originalName).join('\n')}`
      : contenu;
    ticket.addMessage('client', 'email', finalContenu);
    await ticket.save();

    try {
      const { sendEmail } = require('../services/emailService');
      const to = process.env.SAV_INTERNAL_EMAIL || 'carparts.france@gmail.com';
      const link = `${process.env.PUBLIC_URL || 'https://www.carpartsfrance.fr'}/admin/sav/tickets/${ticket.numero}`;
      sendEmail({
        toEmail: to,
        subject: `[SAV] Nouvelle réponse client — ${ticket.numero}`,
        html: `<p>Nouvelle réponse de <strong>${auth.email}</strong> sur le ticket <strong>${ticket.numero}</strong>.</p><blockquote>${contenu.replace(/</g, '&lt;')}</blockquote><p><a href="${link}">Ouvrir le ticket</a></p>`,
        text: `Nouvelle réponse client sur ${ticket.numero} : ${contenu}`,
      }).catch(() => {});
    } catch (_) {}

    return res.redirect(`/sav/suivi/${encodeURIComponent(numero)}?sent=1`);
  } catch (e) {
    return res.redirect(`/sav/suivi/${encodeURIComponent(numero)}?error=server`);
  }
};

// ---- Exports utilitaires pour les emails ----
exports.buildGuestLink = buildGuestLink;
exports.generateGuestToken = generateGuestToken;
