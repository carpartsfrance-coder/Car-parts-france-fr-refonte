const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const SavTicket = require('../../models/SavTicket');
const SavSettings = require('../../models/SavSettings');
const AdminUser = require('../../models/AdminUser');
const AuditLog = require('../../models/AuditLog');
const audit = require('../../services/auditLogger');

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

// GET /admin/api/sav/tickets — liste filtrable, paginée, triée
adminRouter.get('/tickets', async (req, res) => {
  try {
    const q = {};
    if (req.query.statut) q.statut = req.query.statut;
    if (req.query.pieceType) q.pieceType = req.query.pieceType;
    if (req.query.assignedToUserId) q.assignedToUserId = req.query.assignedToUserId;
    if (req.query.sla_depasse === 'true') {
      q['sla.dateLimite'] = { $lt: new Date() };
      q.statut = q.statut || { $nin: ['clos', 'refuse', 'resolu_garantie', 'resolu_facture', 'clos_sans_reponse'] };
    }
    if (req.query.search) {
      const s = String(req.query.search).trim();
      if (s) {
        q.$or = [
          { numero: new RegExp(s, 'i') },
          { 'client.email': new RegExp(s, 'i') },
          { 'client.nom': new RegExp(s, 'i') },
          { 'vehicule.vin': new RegExp(s, 'i') },
          { 'vehicule.immatriculation': new RegExp(s, 'i') },
          { numeroCommande: new RegExp(s, 'i') },
        ];
      }
    }

    // Tri
    const sortField = String(req.query.sort || 'createdAt');
    const sortDir = String(req.query.dir || 'desc') === 'asc' ? 1 : -1;
    const sortMap = {
      numero: 'numero',
      client: 'client.email',
      pieceType: 'pieceType',
      statut: 'statut',
      sla: 'sla.dateLimite',
      createdAt: 'createdAt',
      assignedTo: 'assignedToName',
    };
    const sort = { [sortMap[sortField] || 'createdAt']: sortDir };

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage, 10) || 20));
    const skip = (page - 1) * perPage;

    const [tickets, total] = await Promise.all([
      SavTicket.find(q).sort(sort).skip(skip).limit(perPage).lean(),
      SavTicket.countDocuments(q),
    ]);
    return ok(res, { count: tickets.length, total, page, perPage, totalPages: Math.ceil(total / perPage), tickets });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// GET /admin/api/sav/tickets.csv — export CSV (filtré, sans pagination)
adminRouter.get('/tickets.csv', async (req, res) => {
  try {
    const q = {};
    if (req.query.statut) q.statut = req.query.statut;
    if (req.query.pieceType) q.pieceType = req.query.pieceType;
    if (req.query.assignedToUserId) q.assignedToUserId = req.query.assignedToUserId;
    if (req.query.sla_depasse === 'true') q['sla.dateLimite'] = { $lt: new Date() };
    const tickets = await SavTicket.find(q).sort({ createdAt: -1 }).limit(5000).lean();
    const head = ['numero','createdAt','statut','pieceType','client_email','client_nom','vin','immatriculation','vehicule','assigne','sla_limite'];
    const rows = tickets.map((t) => [
      t.numero,
      new Date(t.createdAt).toISOString(),
      t.statut,
      t.pieceType,
      (t.client && t.client.email) || '',
      (t.client && t.client.nom) || '',
      (t.vehicule && t.vehicule.vin) || '',
      (t.vehicule && t.vehicule.immatriculation) || '',
      [(t.vehicule && t.vehicule.marque) || '', (t.vehicule && t.vehicule.modele) || '', (t.vehicule && t.vehicule.annee) || ''].filter(Boolean).join(' '),
      t.assignedToName || '',
      (t.sla && t.sla.dateLimite) ? new Date(t.sla.dateLimite).toISOString() : '',
    ]);
    function csvCell(v) {
      const s = String(v == null ? '' : v).replace(/"/g, '""');
      return /[",\n;]/.test(s) ? '"' + s + '"' : s;
    }
    const csv = [head.join(';'), ...rows.map((r) => r.map(csvCell).join(';'))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sav-tickets-${Date.now()}.csv"`);
    return res.end('\ufeff' + csv);
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// GET /admin/api/sav/team — liste des admins (pour assignation)
adminRouter.get('/team', async (req, res) => {
  try {
    const users = await AdminUser.find({ isActive: true })
      .select('firstName lastName email role')
      .sort({ firstName: 1 })
      .lean();
    return ok(res, { users });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/assign — assigner ticket
adminRouter.post('/tickets/:numero/assign', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const before = { assignedToUserId: ticket.assignedToUserId, assignedToName: ticket.assignedToName };
    const userId = (req.body && req.body.userId) || null;
    if (!userId) {
      ticket.assignedToUserId = null;
      ticket.assignedToName = null;
      ticket.assignedAt = null;
      ticket.addMessage('admin', 'interne', 'Ticket désassigné');
    } else {
      const user = await AdminUser.findById(userId).lean();
      if (!user) return fail(res, 'Utilisateur inconnu', 404);
      ticket.assignedToUserId = user._id;
      ticket.assignedToName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
      ticket.assignedAt = new Date();
      ticket.addMessage('admin', 'interne', `Ticket assigné à ${ticket.assignedToName}`);
      // Mail à l'assigné (best-effort)
      try {
        const { sendEmail } = require('../../services/emailService');
        sendEmail({
          toEmail: user.email,
          subject: `[SAV] Ticket ${ticket.numero} vous est assigné`,
          html: `<p>Bonjour ${user.firstName || ''},</p><p>Le ticket SAV <strong>${ticket.numero}</strong> vous a été assigné.</p><p><a href="${process.env.SITE_URL || ''}/admin/sav/tickets/${ticket.numero}">Ouvrir le ticket</a></p>`,
          text: `Le ticket ${ticket.numero} vous a été assigné. ${process.env.SITE_URL || ''}/admin/sav/tickets/${ticket.numero}`,
        }).catch(() => {});
      } catch (_) {}
    }
    await ticket.save();
    audit.log({ req, action: 'sav.assign', entityType: 'sav_ticket', entityId: ticket.numero, before, after: { assignedToUserId: ticket.assignedToUserId, assignedToName: ticket.assignedToName } });
    return ok(res, { numero: ticket.numero, assignedToName: ticket.assignedToName });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/fournisseur — mettre à jour fournisseur
adminRouter.post('/tickets/:numero/fournisseur', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const before = JSON.parse(JSON.stringify(ticket.fournisseur || {}));
    const f = req.body || {};
    ticket.fournisseur = ticket.fournisseur || {};
    ['nom','contact','rmaNumero','transporteur','colisNumero','trackingUrl','rapportUrl','reponse'].forEach((k) => {
      if (f[k] != null) ticket.fournisseur[k] = String(f[k]);
    });
    if (f.coutAnalyse != null) ticket.fournisseur.coutAnalyse = Number(f.coutAnalyse) || 0;
    if (f.coutRefacture != null) ticket.fournisseur.coutRefacture = Number(f.coutRefacture) || 0;
    if (f.dateEnvoi) ticket.fournisseur.dateEnvoi = new Date(f.dateEnvoi);
    if (f.dateRetour) ticket.fournisseur.dateRetour = new Date(f.dateRetour);
    if (f.changeStatutToEnAttente) ticket.changerStatut('en_attente_fournisseur', 'admin');
    await ticket.save();
    audit.log({ req, action: 'sav.fournisseur', entityType: 'sav_ticket', entityId: ticket.numero, before, after: ticket.fournisseur });
    return ok(res, { numero: ticket.numero, fournisseur: ticket.fournisseur });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/diagnostic-enrichi — diagnostic banc enrichi
adminRouter.post('/tickets/:numero/diagnostic-enrichi', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const body = req.body || {};
    ticket.diagnosticEnrichi = ticket.diagnosticEnrichi || {};
    if (body.mesures) ticket.diagnosticEnrichi.mesures = Object.assign(ticket.diagnosticEnrichi.mesures || {}, body.mesures);
    if (body.avis2eTechnicienTexte != null) ticket.diagnosticEnrichi.avis2eTechnicienTexte = String(body.avis2eTechnicienTexte);
    if (body.videoUrl) ticket.diagnosticEnrichi.videoUrl = String(body.videoUrl);
    if (body.courbeBancUrl) ticket.diagnosticEnrichi.courbeBancUrl = String(body.courbeBancUrl);

    // Score risque calculé : symptômes (5pts/symptome, max 40) + mesures (jusqu'à 60)
    const sympts = (ticket.diagnostic && ticket.diagnostic.symptomes) || [];
    let score = Math.min(40, sympts.length * 5);
    const m = ticket.diagnosticEnrichi.mesures || {};
    if (typeof m.pressionHydraulique === 'number' && m.pressionHydraulique < 5) score += 20;
    if (m.fuiteInterne && m.fuiteInterne.toLowerCase() !== 'non') score += 15;
    if ((m.codesAvantReset || []).length > 0) score += 10;
    if ((m.codesApresReset || []).length > 0) score += 15;
    ticket.diagnosticEnrichi.scoreCalcule = Math.min(100, score);

    await ticket.save();
    audit.log({ req, action: 'sav.diag.enrichi', entityType: 'sav_ticket', entityId: ticket.numero, after: { score: ticket.diagnosticEnrichi.scoreCalcule } });
    return ok(res, { numero: ticket.numero, diagnosticEnrichi: ticket.diagnosticEnrichi });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/tickets/:numero/communication — envoyer un message client (email/whatsapp/interne)
// Note : WhatsApp non câblé dans cette release, le canal whatsapp est loggé "envoyé" uniquement
adminRouter.post('/tickets/:numero/communication', async (req, res) => {
  try {
    const ticket = await SavTicket.findOne({ numero: req.params.numero });
    if (!ticket) return fail(res, 'Ticket introuvable', 404);
    const { canal, sujet, contenu, html } = req.body || {};
    if (!canal || !contenu) return fail(res, 'canal et contenu requis');

    if (canal === 'email') {
      try {
        const { sendEmail } = require('../../services/emailService');
        const stripped = String(html || contenu).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        await sendEmail({
          toEmail: ticket.client && ticket.client.email,
          subject: sujet || `[SAV ${ticket.numero}]`,
          html: html || `<p>${stripped}</p>`,
          text: stripped,
        });
      } catch (e) {
        console.error('[sav-comm email]', e.message);
      }
    }

    ticket.addMessage('admin', canal, contenu);
    await ticket.save();
    audit.log({ req, action: 'sav.comm.' + canal, entityType: 'sav_ticket', entityId: ticket.numero });
    return ok(res, { numero: ticket.numero });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// GET /admin/api/sav/settings — récupérer paramètres
adminRouter.get('/settings', async (req, res) => {
  try {
    const s = await SavSettings.getSingleton();
    return ok(res, s.toObject());
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/settings — sauver paramètres
adminRouter.post('/settings', async (req, res) => {
  try {
    const s = await SavSettings.getSingleton();
    const before = s.toObject();
    if (Array.isArray(req.body.slaPerPiece)) s.slaPerPiece = req.body.slaPerPiece;
    if (Array.isArray(req.body.automationRules)) s.automationRules = req.body.automationRules;
    await s.save();
    audit.log({ req, action: 'sav.settings.update', entityType: 'sav_settings', entityId: 'global', before, after: s.toObject() });
    return ok(res, s.toObject());
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// POST /admin/api/sav/automations/run — déclencher manuellement le moteur
adminRouter.post('/automations/run', async (req, res) => {
  try {
    const auto = require('../../services/savAutomations');
    const summary = await auto.runRules();
    audit.log({ req, action: 'sav.automations.run', entityType: 'sav_settings', entityId: 'global', after: summary });
    return ok(res, summary);
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// GET /admin/api/sav/audit — consultation logs filtrable
adminRouter.get('/audit', async (req, res) => {
  try {
    const q = {};
    if (req.query.action) q.action = new RegExp(req.query.action, 'i');
    if (req.query.userEmail) q.userEmail = new RegExp(req.query.userEmail, 'i');
    if (req.query.entityId) q.entityId = req.query.entityId;
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
    const items = await AuditLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    return ok(res, { items });
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
    const before = { statut: ticket.statut };
    ticket.changerStatut(statut, auteur || 'admin');
    await ticket.save();
    audit.log({ req, action: 'sav.statut', entityType: 'sav_ticket', entityId: ticket.numero, before, after: { statut: ticket.statut } });
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
    audit.log({ req, action: 'sav.diagnostic', entityType: 'sav_ticket', entityId: ticket.numero, after: { conclusion: ticket.analyse.conclusion } });
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
    audit.log({ req, action: 'sav.resolution', entityType: 'sav_ticket', entityId: ticket.numero, after: ticket.resolution });
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
    audit.log({ req, action: 'sav.facturer149', entityType: 'sav_ticket', entityId: req.params.numero, after: { mollieId: result && result.mollieId } });
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

// GET /admin/api/sav/dashboard — KPI étendus + chart 12 mois
adminRouter.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const STATUTS_ACTIFS = [
      'ouvert',
      'pre_qualification',
      'en_attente_documents',
      'relance_1',
      'relance_2',
      'retour_demande',
      'en_transit_retour',
      'recu_atelier',
      'en_analyse',
      'analyse_terminee',
      'en_attente_decision_client',
      'en_attente_fournisseur',
    ];
    const STATUTS_CLOS = ['clos', 'refuse', 'resolu_garantie', 'resolu_facture', 'clos_sans_reponse'];

    const [
      ouverts,
      enAttenteDoc,
      enAnalyse,
      slaDepasse,
      total,
      defautProduit,
      facturesPayees,
      facturesImpayees,
      mesTickets,
      tousResolus,
    ] = await Promise.all([
      SavTicket.countDocuments({ statut: { $in: STATUTS_ACTIFS } }),
      SavTicket.countDocuments({ statut: { $in: ['en_attente_documents', 'relance_1', 'relance_2'] } }),
      SavTicket.countDocuments({ statut: 'en_analyse' }),
      SavTicket.countDocuments({
        statut: { $in: STATUTS_ACTIFS },
        'sla.dateLimite': { $lt: now },
      }),
      SavTicket.countDocuments({ 'analyse.conclusion': { $exists: true, $ne: null } }),
      SavTicket.countDocuments({ 'analyse.conclusion': 'defaut_produit' }),
      SavTicket.countDocuments({ 'paiements.facture149.status': 'payee' }),
      SavTicket.countDocuments({ 'paiements.facture149.status': 'impayee' }),
      // Mes tickets : on regarde le query param userId si fourni
      req.query.userId ? SavTicket.countDocuments({ assignedToUserId: req.query.userId, statut: { $in: STATUTS_ACTIFS } }) : Promise.resolve(0),
      SavTicket.find({ statut: { $in: STATUTS_CLOS }, createdAt: { $gte: new Date(Date.now() - 365 * 24 * 3600 * 1000) } })
        .select('createdAt updatedAt statut')
        .lean(),
    ]);

    // Temps moyen de résolution (jours) sur les tickets clos cette année
    let avgResolutionDays = 0;
    if (tousResolus.length) {
      const sum = tousResolus.reduce((acc, t) => {
        const start = new Date(t.createdAt).getTime();
        const end = new Date(t.updatedAt || t.createdAt).getTime();
        return acc + Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
      }, 0);
      avgResolutionDays = Math.round((sum / tousResolus.length) * 10) / 10;
    }
    const tauxDefautProduit = total > 0 ? Math.round((defautProduit / total) * 100) : 0;
    const caRecupere = facturesPayees * 149;
    const caPerdu = facturesImpayees * 149;

    // SAV récurrents fournisseur : nombre de tickets pour le même VIN > 1
    let savRecurrents = 0;
    try {
      const groups = await SavTicket.aggregate([
        { $match: { 'vehicule.vin': { $exists: true, $ne: null, $ne: '' } } },
        { $group: { _id: '$vehicule.vin', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: 'recurrents' },
      ]);
      savRecurrents = (groups[0] && groups[0].recurrents) || 0;
    } catch (_) {}

    // Chart 12 mois : ouverts vs clos par mois
    const monthsBack = 12;
    const start = new Date();
    start.setMonth(start.getMonth() - (monthsBack - 1));
    start.setDate(1); start.setHours(0, 0, 0, 0);
    const monthly = await SavTicket.aggregate([
      { $match: { createdAt: { $gte: start } } },
      {
        $group: {
          _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
          ouverts: { $sum: 1 },
          clos: {
            $sum: { $cond: [{ $in: ['$statut', STATUTS_CLOS] }, 1, 0] },
          },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]);
    const labels = [];
    const ouvertsArr = [];
    const closArr = [];
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(start);
      d.setMonth(start.getMonth() + i);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      labels.push(`${String(m).padStart(2, '0')}/${String(y).slice(2)}`);
      const found = monthly.find((x) => x._id.y === y && x._id.m === m);
      ouvertsArr.push(found ? found.ouverts : 0);
      closArr.push(found ? found.clos : 0);
    }

    return ok(res, {
      ouverts: ouverts || 0,
      en_attente_doc: enAttenteDoc || 0,
      en_analyse: enAnalyse || 0,
      sla_depasse: slaDepasse || 0,
      total_analyses: total || 0,
      taux_defaut_produit: tauxDefautProduit,
      ca_recupere: caRecupere,
      ca_perdu: caPerdu,
      avg_resolution_days: avgResolutionDays,
      sav_recurrents: savRecurrents,
      mes_tickets: mesTickets || 0,
      chart: { labels, ouverts: ouvertsArr, clos: closArr },
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
