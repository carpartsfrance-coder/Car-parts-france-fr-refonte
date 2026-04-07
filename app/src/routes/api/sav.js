const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const SavTicket = require('../../models/SavTicket');

const router = express.Router();

// ---------- Logger ----------

const LOG_DIR = path.join(__dirname, '..', '..', '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'sav-api.log');

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {}
}
ensureLogDir();

function logApi(req, res) {
  const line = `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode}\n`;
  try {
    fs.appendFile(LOG_FILE, line, () => {});
  } catch (_) {}
}

router.use((req, res, next) => {
  res.on('finish', () => logApi(req, res));
  next();
});

// ---------- Helpers ----------

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// ---------- Auth admin (Bearer) ----------

function requireAdminToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expected = (process.env.SAV_API_TOKEN || '').trim();
  if (!expected) return fail(res, 'SAV_API_TOKEN non configuré côté serveur', 500);
  if (!token || token !== expected) return fail(res, 'Non autorisé', 401);
  return next();
}

// ---------- Upload (multer mémoire) ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ============================================================
// PUBLIC (client)
// ============================================================

const publicRouter = express.Router();

// GET /api/sav/stats-publiques — chiffres anonymes pour la page engagement
publicRouter.get('/stats-publiques', async (req, res) => {
  try {
    const STATUTS_ACTIFS = ['ouvert','pre_qualification','en_attente_documents','retour_demande','en_transit_retour','recu_atelier','en_analyse','analyse_terminee','en_attente_decision_client'];
    const [ouverts, total, defaut] = await Promise.all([
      SavTicket.countDocuments({ statut: { $in: STATUTS_ACTIFS } }),
      SavTicket.countDocuments({ 'analyse.conclusion': { $exists: true } }),
      SavTicket.countDocuments({ 'analyse.conclusion': 'defaut_produit' }),
    ]);
    const taux = total > 0 ? Math.round((defaut / total) * 100) : 0;
    return ok(res, { ouverts, taux_defaut_produit: taux });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /api/sav/mollie-webhook — Mollie ping (form-encoded body { id })
publicRouter.post('/mollie-webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const mollieService = require('../../services/mollieService');
    const id = (req.body && req.body.id) || (req.query && req.query.id);
    if (!id) return res.status(200).end(); // Mollie attend toujours 200
    await mollieService.handleWebhook(id);
    return res.status(200).end();
  } catch (err) {
    console.error('[sav-mollie-webhook]', err.message);
    return res.status(200).end(); // ne JAMAIS renvoyer 5xx à Mollie sinon il retry en boucle
  }
});

// POST /api/sav/tickets — création
publicRouter.post('/tickets', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.client || !body.client.email) {
      return fail(res, 'client.email requis');
    }
    if (!body.client.nom) body.client.nom = body.client.email.split('@')[0];
    if (!body.pieceType) return fail(res, 'pieceType requis');

    const clientIp =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.ip ||
      (req.connection && req.connection.remoteAddress) ||
      '';
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 500);

    const ticket = new SavTicket({
      pieceType: body.pieceType,
      referencePiece: body.referencePiece,
      numeroSerie: body.numeroSerie,
      dateAchat: body.dateAchat,
      numeroCommande: body.numeroCommande,
      vehicule: body.vehicule || {},
      client: body.client,
      garage: body.garage || {},
      diagnostic: body.diagnostic || {},
      montage: body.montage || {},
      cgvAcceptance: body.cgvAcceptance
        ? {
            version: body.cgvAcceptance.version || 'cgv-sav-v2-2026-04',
            acceptedAt: body.cgvAcceptance.acceptedAt
              ? new Date(body.cgvAcceptance.acceptedAt)
              : new Date(),
            ip: clientIp,
            userAgent,
          }
        : undefined,
      rgpdAcceptance: body.rgpdAcceptance
        ? {
            version: body.rgpdAcceptance.version || 'rgpd-v1-2026-04',
            acceptedAt: body.rgpdAcceptance.acceptedAt
              ? new Date(body.rgpdAcceptance.acceptedAt)
              : new Date(),
            ip: clientIp,
            userAgent,
          }
        : undefined,
      statut: 'pre_qualification',
      workflow: { track: body.track || 'retour_systematique', etape: 'pre_qualification' },
    });
    ticket.addMessage('client', 'interne', 'Ticket créé via formulaire public');
    await ticket.save();

    // Génère le PDF d'acceptation CGV horodaté + envoie le mail de confirmation
    // (best-effort, n'échoue jamais le ticket si le mail/PDF plante)
    try {
      const cgvPdf = require('../../services/savCgvPdf');
      const url = await cgvPdf.generateCgvAcceptance(ticket);
      ticket.cgvAcceptance = ticket.cgvAcceptance || {};
      ticket.cgvAcceptance.pdfUrl = url;
      await ticket.save();
    } catch (e) {
      console.error('[sav] CGV PDF échec', e && e.message);
    }
    try {
      const notif = require('../../services/savNotifications');
      if (typeof notif.sendConfirmationToClient === 'function') {
        notif.sendConfirmationToClient(ticket).catch((e) => {
          console.error('[sav] mail confirmation échec', e && e.message);
        });
      }
    } catch (e) {
      console.error('[sav] notif require échec', e && e.message);
    }

    return ok(res, { numero: ticket.numero, statut: ticket.statut, sla: ticket.sla }, 201);
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// GET /api/sav/tickets/:numero?email=
publicRouter.get('/tickets/:numero', async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) return fail(res, 'email requis', 401);
    const ticket = await SavTicket.findOne({
      numero: req.params.numero,
      'client.email': email,
    }).lean();
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    // Vue client : on masque les champs internes
    const publicView = {
      numero: ticket.numero,
      statut: ticket.statut,
      pieceType: ticket.pieceType,
      vehicule: ticket.vehicule,
      sla: ticket.sla,
      messages: (ticket.messages || []).filter((m) => m.canal !== 'interne'),
      analyse: ticket.analyse
        ? { conclusion: ticket.analyse.conclusion, rapport: ticket.analyse.rapport }
        : null,
      resolution: ticket.resolution,
    };
    return ok(res, publicView);
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /api/sav/tickets/:numero/documents — upload doc
publicRouter.post(
  '/tickets/:numero/documents',
  upload.single('document'),
  async (req, res) => {
    try {
      const email = (req.body.email || '').toLowerCase().trim();
      if (!email) return fail(res, 'email requis', 401);
      const ticket = await SavTicket.findOne({
        numero: req.params.numero,
        'client.email': email,
      });
      if (!ticket) return fail(res, 'Ticket introuvable', 404);
      if (!req.file) return fail(res, 'Aucun fichier fourni');

      // Stockage minimal disque (placeholder — à remplacer par S3 / media service)
      const uploadDir = path.join(__dirname, '..', '..', '..', '..', 'uploads', 'sav', ticket.numero);
      fs.mkdirSync(uploadDir, { recursive: true });
      const safeName = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const fullPath = path.join(uploadDir, safeName);
      fs.writeFileSync(fullPath, req.file.buffer);
      const url = `/uploads/sav/${ticket.numero}/${safeName}`;

      const kind = (req.body.kind || 'autre').trim();
      if (!ticket.documents) ticket.documents = {};
      if (kind === 'factureMontage') ticket.documents.factureMontage = url;
      else if (kind === 'photoObd') {
        ticket.documents.photosObd = ticket.documents.photosObd || [];
        ticket.documents.photosObd.push(url);
      } else if (kind === 'confirmationReglageBase') {
        ticket.documents.confirmationReglageBase = url;
      } else {
        ticket.documents.photosVisuelles = ticket.documents.photosVisuelles || [];
        ticket.documents.photosVisuelles.push(url);
      }

      ticket.documentsList = ticket.documentsList || [];
      ticket.documentsList.push({
        kind,
        url,
        originalName: req.file.originalname,
        size: req.file.size,
        mime: req.file.mimetype,
        uploadedAt: new Date(),
      });

      ticket.addMessage('client', 'interne', `Document uploadé (${kind}) : ${req.file.originalname} (${req.file.size} octets)`);
      await ticket.save();
      return ok(res, { url, kind });
    } catch (err) {
      return fail(res, err.message, 500);
    }
  }
);

// POST /api/sav/tickets/:numero/messages — message client
publicRouter.post('/tickets/:numero/messages', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const contenu = (req.body.contenu || '').trim();
    if (!email) return fail(res, 'email requis', 401);
    if (!contenu) return fail(res, 'contenu requis');
    const ticket = await SavTicket.findOne({
      numero: req.params.numero,
      'client.email': email,
    });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    ticket.addMessage('client', 'email', contenu);
    await ticket.save();
    return ok(res, { ok: true });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// ============================================================
// ADMIN (Bearer)
// ============================================================

const adminRouter = express.Router();
adminRouter.use(requireAdminToken);

// GET /admin/api/sav/tickets — liste filtrable
adminRouter.get('/tickets', async (req, res) => {
  try {
    const q = {};
    if (req.query.statut) q.statut = req.query.statut;
    if (req.query.pieceType) q.pieceType = req.query.pieceType;
    if (req.query.sla_depasse === 'true') {
      q['sla.dateLimite'] = { $lt: new Date() };
      q.statut = q.statut || { $nin: ['clos', 'refuse', 'resolu_garantie', 'resolu_facture'] };
    }
    const tickets = await SavTicket.find(q)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(req.query.limit, 10) || 50, 200))
      .lean();
    return ok(res, { count: tickets.length, tickets });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// GET /admin/api/sav/tickets/:numero — détail
adminRouter.get('/tickets/:numero', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero }).lean();
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    return ok(res, ticket);
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// PATCH /admin/api/sav/tickets/:numero/statut
adminRouter.patch('/tickets/:numero/statut', async (req, res) => {
  try {
    const { statut, auteur } = req.body || {};
    if (!statut) return fail(res, 'statut requis');
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    ticket.changerStatut(statut, auteur || 'admin');
    await ticket.save();
    // TODO Phase 4 : déclencher email auto selon statut
    return ok(res, { numero: ticket.numero, statut: ticket.statut });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/diagnostic
adminRouter.post('/tickets/:numero/diagnostic', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const { conclusion, rapport, photosBanc, symptomes, codesDefaut, scoreRisque, redFlags } =
      req.body || {};
    if (!conclusion) return fail(res, 'conclusion requise');
    ticket.analyse = ticket.analyse || {};
    ticket.analyse.conclusion = conclusion;
    if (rapport) ticket.analyse.rapport = rapport;
    if (Array.isArray(photosBanc)) ticket.analyse.photosBanc = photosBanc;
    if (symptomes || codesDefaut || scoreRisque != null || redFlags) {
      ticket.diagnostic = ticket.diagnostic || {};
      if (symptomes) ticket.diagnostic.symptomes = symptomes;
      if (codesDefaut) ticket.diagnostic.codesDefaut = codesDefaut;
      if (scoreRisque != null) ticket.diagnostic.scoreRisque = scoreRisque;
      if (redFlags) ticket.diagnostic.redFlags = redFlags;
    }
    // Si conclusion ≠ defaut_produit → 149€ à facturer
    if (conclusion !== 'defaut_produit') {
      ticket.analyse.facture149 = { status: 'a_facturer' };
    } else {
      ticket.analyse.facture149 = { status: 'na' };
    }
    ticket.changerStatut('analyse_terminee', 'admin');
    await ticket.save();
    return ok(res, { numero: ticket.numero, analyse: ticket.analyse });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/resolution
adminRouter.post('/tickets/:numero/resolution', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const { type, montant } = req.body || {};
    if (!type) return fail(res, 'type requis');
    ticket.resolution = { type, montant: montant || 0, dateResolution: new Date() };
    const nouveauStatut =
      ticket.analyse && ticket.analyse.conclusion === 'defaut_produit'
        ? 'resolu_garantie'
        : 'resolu_facture';
    ticket.changerStatut(nouveauStatut, 'admin');
    await ticket.save();
    return ok(res, { numero: ticket.numero, resolution: ticket.resolution, statut: ticket.statut });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/messages
adminRouter.post('/tickets/:numero/messages', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const { auteur, canal, contenu } = req.body || {};
    if (!canal || !contenu) return fail(res, 'canal et contenu requis');
    ticket.addMessage(auteur || 'admin', canal, contenu);
    await ticket.save();
    return ok(res, { ok: true, count: ticket.messages.length });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/facturer-149
adminRouter.post('/tickets/:numero/facturer-149', async (req, res) => {
  try {
    const mollieService = require('../../services/mollieService');
    const result = await mollieService.createPayment149(req.params.numero);
    return ok(res, { numero: req.params.numero, ...result });
  } catch (err) {
    const code = /interdite/.test(err.message) ? 409 : 500;
    return fail(res, err.message, code);
  }
});

// POST /admin/api/sav/tickets/:numero/rapport-pdf
adminRouter.post('/tickets/:numero/rapport-pdf', async (req, res) => {
  try {
    const reportPdf = require('../../services/savReportPdf');
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const url = await reportPdf.generateAnalysisReport(ticket);
    ticket.analyse = ticket.analyse || {};
    ticket.analyse.rapport = url;
    ticket.addMessage('admin', 'interne', `Rapport PDF généré : ${url}`);
    await ticket.save();
    return ok(res, { url });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// GET /admin/api/sav/dashboard
adminRouter.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const STATUTS_ACTIFS = [
      'ouvert',
      'pre_qualification',
      'en_attente_documents',
      'retour_demande',
      'en_transit_retour',
      'recu_atelier',
      'en_analyse',
      'analyse_terminee',
      'en_attente_decision_client',
    ];
    const [ouverts, slaDepasse, total, defautProduit, factures] = await Promise.all([
      SavTicket.countDocuments({ statut: { $in: STATUTS_ACTIFS } }),
      SavTicket.countDocuments({
        statut: { $in: STATUTS_ACTIFS },
        'sla.dateLimite': { $lt: now },
      }),
      SavTicket.countDocuments({ 'analyse.conclusion': { $exists: true } }),
      SavTicket.countDocuments({ 'analyse.conclusion': 'defaut_produit' }),
      SavTicket.countDocuments({ 'paiements.facture149.status': 'payee' }),
    ]);
    const tauxDefautProduit = total > 0 ? Math.round((defautProduit / total) * 100) : 0;
    const caRecupere = factures * 149;
    return ok(res, {
      ouverts,
      sla_depasse: slaDepasse,
      total_analyses: total,
      taux_defaut_produit: tauxDefautProduit,
      ca_recupere: caRecupere,
    });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

router.use('/public', publicRouter); // monté manuellement par app.js
router.use('/admin', adminRouter);

module.exports = {
  publicRouter,
  adminRouter,
};
