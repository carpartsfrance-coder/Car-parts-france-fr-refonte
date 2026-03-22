const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Category = require('../models/Category');
const ReturnRequest = require('../models/ReturnRequest');
const PromoCode = require('../models/PromoCode');
const PromoRedemption = require('../models/PromoRedemption');
const VehicleMake = require('../models/VehicleMake');
const ShippingClass = require('../models/ShippingClass');
const ProductOptionTemplate = require('../models/ProductOptionTemplate');
const ProductDraftGeneration = require('../models/ProductDraftGeneration');

const track17 = require('../services/track17');
const emailService = require('../services/emailService');
const invoiceSettings = require('../services/invoiceSettings');
const siteSettings = require('../services/siteSettings');
const productOptions = require('../services/productOptions');
const mediaStorage = require('../services/mediaStorage');
const adminUsers = require('../services/adminUsers');
const openaiProductGenerator = require('../services/openaiProductGenerator');
const { getSiteUrlFromEnv } = require('../services/siteUrl');

const ADMIN_LOGIN_BUCKETS = new Map();
const ADMIN_RESET_BUCKETS = new Map();
const ADMIN_AI_PRODUCT_BUCKETS = new Map();
const ADMIN_AI_PRODUCT_LIMIT = 60;
const ADMIN_AI_PRODUCT_WINDOW_MS = 10 * 60 * 1000;
const PRODUCT_DRAFT_QUEUE_CONCURRENCY = 1;
const PRODUCT_DRAFT_BATCH_MAX = 50;

let activeProductDraftQueueWorkers = 0;
let productDraftQueueScheduled = false;
const activeProductDraftAbortControllers = new Map();

function buildAiProfileViewData() {
  return {
    aiSingleProfiles: openaiProductGenerator.getAiGenerationProfilesByScope('single'),
    defaultAiSingleProfileKey: openaiProductGenerator.getDefaultAiGenerationProfileKey('single'),
    aiBatchProfiles: openaiProductGenerator.getAiGenerationProfilesByScope('batch'),
    defaultAiBatchProfileKey: openaiProductGenerator.getDefaultAiGenerationProfileKey('batch'),
    batchDraftMax: PRODUCT_DRAFT_BATCH_MAX,
  };
}

function getClientIp(req) {
  const xfwd = req && req.headers ? req.headers['x-forwarded-for'] : null;
  const fromHeader = Array.isArray(xfwd) ? xfwd[0] : typeof xfwd === 'string' ? xfwd.split(',')[0] : '';
  const candidate = getTrimmedString(fromHeader) || (req && req.ip ? String(req.ip) : '');
  return candidate || 'unknown';
}

function consumeRateLimit(buckets, key, { limit, windowMs, units } = {}) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
  const safeWindowMs = Number.isFinite(windowMs) ? Math.max(1000, Math.floor(windowMs)) : 10 * 60 * 1000;
  const safeUnits = Number.isFinite(units) ? Math.max(1, Math.floor(units)) : 1;
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || typeof entry.resetAt !== 'number' || now >= entry.resetAt) {
    buckets.set(key, { count: safeUnits, resetAt: now + safeWindowMs });
    return { limited: safeUnits > safeLimit, remaining: Math.max(0, safeLimit - safeUnits) };
  }

  entry.count += safeUnits;
  const remaining = Math.max(0, safeLimit - entry.count);
  return { limited: entry.count > safeLimit, remaining };
}

const ADMIN_CREDENTIALS_FILE = path.join(__dirname, '..', '..', '.admin-credentials.json');

function slugify(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function normalizeEnvString(value) {
  if (typeof value !== 'string') return '';
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function isChecked(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function readAdminCredentialsFile() {
  try {
    if (!fs.existsSync(ADMIN_CREDENTIALS_FILE)) return null;
    const raw = fs.readFileSync(ADMIN_CREDENTIALS_FILE, 'utf8');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const salt = parsed && parsed.password && typeof parsed.password.salt === 'string'
      ? parsed.password.salt
      : '';
    const hash = parsed && parsed.password && typeof parsed.password.hash === 'string'
      ? parsed.password.hash
      : '';

    if (!salt || !hash) return null;
    return { salt, hash };
  } catch (err) {
    return null;
  }
}

async function postAdminBulkGenerateProductDrafts(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const safeReturnTo = getSafeAdminReturnTo(req.body && req.body.returnTo, '/admin/catalogue');
    const aiProfile = openaiProductGenerator.normalizeAiGenerationProfile(req.body && req.body.aiProfile, { scope: 'batch' });
    const aiProfileMeta = openaiProductGenerator.getAiGenerationProfileMeta(aiProfile, { scope: 'batch' });

    if (!dbConnected) {
      req.session.adminCatalogError = 'La base de données n’est pas disponible. Réessayez dans quelques instants.';
      return res.redirect(safeReturnTo);
    }

    const uniqueIds = parseAdminSelectedIds(req.body && (req.body.productIds || req.body.productId || req.body.ids));
    if (!uniqueIds.length) {
      req.session.adminCatalogError = 'Aucun produit sélectionné pour la génération IA.';
      return res.redirect(safeReturnTo);
    }

    if (uniqueIds.length > PRODUCT_DRAFT_BATCH_MAX) {
      req.session.adminCatalogError = `Vous pouvez lancer jusqu’à ${PRODUCT_DRAFT_BATCH_MAX} produits à la fois pour garder une génération stable.`;
      return res.redirect(safeReturnTo);
    }

    const validIds = uniqueIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validIds.length) {
      req.session.adminCatalogError = 'Sélection invalide.';
      return res.redirect(safeReturnTo);
    }

    const selectedProducts = await Product.find({ _id: { $in: validIds } })
      .select('_id name sku brand category compatibleReferences')
      .lean();

    if (!selectedProducts.length) {
      req.session.adminCatalogError = 'Aucun produit trouvé.';
      return res.redirect(safeReturnTo);
    }

    const orderedProducts = validIds
      .map((id) => selectedProducts.find((product) => String(product._id) === String(id)))
      .filter(Boolean);

    const adminUserId = getAdminUserIdFromRequest(req);
    const sourceNotes = getTrimmedString(req.body && req.body.bulkAiSourceNotes);
    const activeJobs = await ProductDraftGeneration.find({
      productId: { $in: orderedProducts.map((product) => product._id) },
      status: { $in: ['queued', 'processing'] },
      adminUserId: adminUserId || null,
    })
      .select('productId')
      .lean();

    const activeProductIds = new Set(activeJobs.map((job) => String(job.productId)));
    const jobsToCreate = [];
    let skippedActiveCount = 0;
    let skippedEmptyCount = 0;

    for (const product of orderedProducts) {
      const productId = String(product._id);
      if (activeProductIds.has(productId)) {
        skippedActiveCount += 1;
        continue;
      }

      const payload = buildProductDraftPayloadFromProduct(product, { sourceNotes, profile: aiProfile });
      if (!hasProductDraftPayloadContent(payload)) {
        skippedEmptyCount += 1;
        continue;
      }

      jobsToCreate.push({
        productId: product._id,
        adminUserId,
        status: 'queued',
        requestPayload: payload,
      });
    }

    if (!jobsToCreate.length) {
      req.session.adminCatalogError = skippedActiveCount
        ? 'Des générations IA sont déjà en cours pour les produits sélectionnés.'
        : 'Impossible de lancer l’IA : les produits sélectionnés ne contiennent pas assez d’informations de base.';
      return res.redirect(safeReturnTo);
    }

    const rate = consumeRateLimit(ADMIN_AI_PRODUCT_BUCKETS, getClientIp(req), {
      limit: ADMIN_AI_PRODUCT_LIMIT,
      windowMs: ADMIN_AI_PRODUCT_WINDOW_MS,
      units: jobsToCreate.length,
    });

    if (rate.limited) {
      req.session.adminCatalogError = 'Trop de demandes IA en peu de temps. Merci de patienter quelques minutes puis de réessayer.';
      return res.redirect(safeReturnTo);
    }

    const createdJobs = await ProductDraftGeneration.insertMany(jobsToCreate);
    scheduleProductDraftQueue();

    const launchedCount = Array.isArray(createdJobs) ? createdJobs.length : 0;
    const details = [];
    if (skippedActiveCount) details.push(`${skippedActiveCount} déjà en cours`);
    if (skippedEmptyCount) details.push(`${skippedEmptyCount} sans assez d’informations`);

    req.session.adminCatalogSuccess = `${launchedCount} brouillon(s) IA lancé(s) en mode ${aiProfileMeta.label.toLowerCase()}. Ouvre ensuite chaque fiche produit pour relire et appliquer la proposition.${details.length ? ` (${details.join(' • ')})` : ''}`;
    return res.redirect(safeReturnTo);
  } catch (err) {
    return next(err);
  }
}

async function postAdminCancelAllProductDrafts(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const acceptHeader = req && req.headers && typeof req.headers.accept === 'string' ? req.headers.accept : '';
    const wantsJson = acceptHeader.includes('application/json');
    const safeReturnTo = getSafeAdminReturnTo(req.body && req.body.returnTo, '/admin/catalogue');

    if (!dbConnected) {
      if (wantsJson) {
        return res.status(503).json({
          ok: false,
          error: 'La base de données n’est pas disponible. Réessayez dans quelques instants.',
        });
      }
      req.session.adminCatalogError = 'La base de données n’est pas disponible. Réessayez dans quelques instants.';
      return res.redirect(safeReturnTo);
    }

    const adminUserId = getAdminUserIdFromRequest(req);
    const activeJobs = await ProductDraftGeneration.find({
      adminUserId: adminUserId || null,
      status: { $in: ['queued', 'processing'] },
    })
      .select('_id')
      .lean();

    if (!activeJobs.length) {
      if (wantsJson) {
        return res.status(409).json({
          ok: false,
          error: 'Aucune génération IA active à arrêter.',
        });
      }
      req.session.adminCatalogError = 'Aucune génération IA active à arrêter.';
      return res.redirect(safeReturnTo);
    }

    const activeJobIds = activeJobs.map((job) => String(job._id));
    await ProductDraftGeneration.updateMany(
      {
        _id: { $in: activeJobIds },
        status: { $in: ['queued', 'processing'] },
      },
      {
        $set: {
          status: 'canceled',
          errorMessage: 'Génération IA arrêtée à la demande.',
          completedAt: new Date(),
        },
      }
    );

    for (const jobId of activeJobIds) {
      const activeController = activeProductDraftAbortControllers.get(jobId);
      if (activeController) {
        activeController.abort();
      }
    }

    const successMessage = `${activeJobIds.length} génération${activeJobIds.length > 1 ? 's' : ''} IA arrêtée${activeJobIds.length > 1 ? 's' : ''}.`;

    if (wantsJson) {
      return res.json({
        ok: true,
        canceledCount: activeJobIds.length,
        status: 'canceled',
        message: successMessage,
      });
    }

    req.session.adminCatalogSuccess = successMessage;
    return res.redirect(safeReturnTo);
  } catch (err) {
    return next(err);
  }
}

function writeAdminCredentialsFile({ salt, hash } = {}) {
  if (!salt || !hash) return false;
  try {
    fs.writeFileSync(
      ADMIN_CREDENTIALS_FILE,
      JSON.stringify({ password: { salt, hash }, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    return true;
  } catch (err) {
    return false;
  }
}

function hashPassword(password, salt) {
  const inputPassword = typeof password === 'string' ? password : '';
  const inputSalt = typeof salt === 'string' ? salt : '';
  if (!inputPassword || !inputSalt) return '';

  try {
    return crypto.scryptSync(inputPassword, inputSalt, 64).toString('hex');
  } catch (err) {
    return '';
  }
}

function verifyPassword({ password, salt, hash } = {}) {
  const computed = hashPassword(password, salt);
  if (!computed || !hash) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  } catch (err) {
    return false;
  }
}

async function postAdminMarkOrderConsigneReceived(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { orderId } = req.params;

    if (!dbConnected) return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.redirect('/admin/commandes');

    const existing = await Order.findById(orderId)
      .select('_id number userId consigne status notifications')
      .lean();
    if (!existing) {
      req.session.adminOrderError = 'Commande introuvable.';
      return res.redirect('/admin/commandes');
    }

    const lines = existing && existing.consigne && Array.isArray(existing.consigne.lines)
      ? existing.consigne.lines
      : [];

    if (!lines.length) {
      req.session.adminOrderError = 'Aucune consigne à marquer comme reçue.';
      return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    }

    const now = new Date();
    const updatedLines = lines.map((l) => {
      if (!l) return l;
      if (l.receivedAt) return l;

      const delayDays = Number.isFinite(l.delayDays) ? Math.max(0, Math.floor(l.delayDays)) : 30;
      const startAt = l.startAt ? new Date(l.startAt) : now;
      const dueAt = l.dueAt ? new Date(l.dueAt) : (() => {
        const d = new Date(startAt);
        d.setDate(d.getDate() + delayDays);
        return d;
      })();

      return {
        productId: l.productId,
        name: l.name,
        sku: l.sku || '',
        quantity: l.quantity,
        amountCents: l.amountCents,
        delayDays,
        startAt,
        dueAt,
        receivedAt: now,
      };
    });

    await Order.updateOne({ _id: orderId }, { $set: { consigne: { lines: updatedLines } } });

    try {
      const refreshed = await Order.findById(orderId)
        .select('_id number userId consigne notifications')
        .lean();

      const alreadySent = refreshed
        && refreshed.notifications
        && refreshed.notifications.consigneReceivedSentAt;

      const linesAfter = refreshed && refreshed.consigne && Array.isArray(refreshed.consigne.lines)
        ? refreshed.consigne.lines
        : [];
      const allReceived = linesAfter.length > 0 && linesAfter.every((l) => l && l.receivedAt);

      if (!alreadySent && allReceived) {
        const user = refreshed && refreshed.userId
          ? await User.findById(refreshed.userId).select('_id email firstName').lean()
          : null;

        if (user && user.email) {
          const sent = await emailService.sendConsigneReceivedEmail({ order: refreshed, user });
          if (sent && sent.ok) {
            await Order.updateOne(
              {
                _id: refreshed._id,
                $or: [
                  { 'notifications.consigneReceivedSentAt': { $exists: false } },
                  { 'notifications.consigneReceivedSentAt': null },
                ],
              },
              { $set: { 'notifications.consigneReceivedSentAt': new Date() } }
            );
          }
        }
      }
    } catch (err) {
      console.error('Erreur email consigne reçue (admin) :', err && err.message ? err.message : err);
    }

    req.session.adminOrderSuccess = 'Consigne marquée comme reçue.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Consigne marquée comme reçue.', data: { orderId } });
    return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
  } catch (err) {
    return next(err);
  }
}

async function getAdminGenerateProductDraftStatus(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      return res.status(503).json({
        ok: false,
        error: 'La base de données n’est pas disponible. Réessayez dans quelques instants.',
      });
    }

    const jobId = getTrimmedString(req.params && req.params.jobId);
    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({
        ok: false,
        error: 'Identifiant de génération invalide.',
      });
    }

    const adminUserId = getAdminUserIdFromRequest(req);
    const filter = { _id: jobId };
    if (adminUserId) filter.adminUserId = adminUserId;

    const job = await ProductDraftGeneration.findOne(filter).lean();
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: 'Demande de génération introuvable.',
      });
    }

    return res.json({
      ok: true,
      jobId: String(job._id),
      status: job.status,
      model: job.model || '',
      profile: getTrimmedString(job && job.requestPayload && job.requestPayload.profile),
      error: job.status === 'failed' || job.status === 'canceled' ? getTrimmedString(job.errorMessage) : '',
      draft: job.status === 'completed' && job.resultDraft
        ? buildGeneratedProductDraftResponse(job.resultDraft)
        : null,
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminCancelProductDraft(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const acceptHeader = req && req.headers && typeof req.headers.accept === 'string' ? req.headers.accept : '';
    const wantsJson = acceptHeader.includes('application/json');
    const safeReturnTo = getSafeAdminReturnTo(req.body && req.body.returnTo, '/admin/catalogue');

    if (!dbConnected) {
      if (wantsJson) {
        return res.status(503).json({
          ok: false,
          error: 'La base de données n’est pas disponible. Réessayez dans quelques instants.',
        });
      }
      req.session.adminCatalogError = 'La base de données n’est pas disponible. Réessayez dans quelques instants.';
      return res.redirect(safeReturnTo);
    }

    const jobId = getTrimmedString(req.params && req.params.jobId);
    if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
      if (wantsJson) {
        return res.status(400).json({
          ok: false,
          error: 'Identifiant de génération invalide.',
        });
      }
      req.session.adminCatalogError = 'Identifiant de génération invalide.';
      return res.redirect(safeReturnTo);
    }

    const adminUserId = getAdminUserIdFromRequest(req);
    const filter = { _id: jobId };
    if (adminUserId) filter.adminUserId = adminUserId;

    const existingJob = await ProductDraftGeneration.findOne(filter)
      .select('_id status')
      .lean();

    if (!existingJob) {
      if (wantsJson) {
        return res.status(404).json({
          ok: false,
          error: 'Demande de génération introuvable.',
        });
      }
      req.session.adminCatalogError = 'Demande de génération introuvable.';
      return res.redirect(safeReturnTo);
    }

    if (existingJob.status !== 'queued' && existingJob.status !== 'processing') {
      const errorMessage = existingJob.status === 'canceled'
        ? 'Cette génération IA est déjà arrêtée.'
        : 'Cette génération IA est déjà terminée et ne peut plus être arrêtée.';
      if (wantsJson) {
        return res.status(409).json({
          ok: false,
          error: errorMessage,
          status: existingJob.status,
        });
      }
      req.session.adminCatalogError = errorMessage;
      return res.redirect(safeReturnTo);
    }

    const canceledMessage = existingJob.status === 'processing'
      ? 'Génération IA arrêtée à la demande.'
      : 'Génération IA retirée de la file d’attente.';

    const updatedJob = await ProductDraftGeneration.findOneAndUpdate(
      {
        _id: existingJob._id,
        status: { $in: ['queued', 'processing'] },
      },
      {
        $set: {
          status: 'canceled',
          errorMessage: canceledMessage,
          completedAt: new Date(),
        },
      },
      {
        new: true,
      }
    ).lean();

    if (!updatedJob) {
      if (wantsJson) {
        return res.status(409).json({
          ok: false,
          error: 'La génération IA ne peut plus être arrêtée car son état a changé entre-temps.',
        });
      }
      req.session.adminCatalogError = 'La génération IA ne peut plus être arrêtée car son état a changé entre-temps.';
      return res.redirect(safeReturnTo);
    }

    const activeController = activeProductDraftAbortControllers.get(String(existingJob._id));
    if (activeController) {
      activeController.abort();
    }

    if (wantsJson) {
      return res.json({
        ok: true,
        jobId: String(updatedJob._id),
        status: 'canceled',
        message: canceledMessage,
      });
    }

    req.session.adminCatalogSuccess = canceledMessage;
    return res.redirect(safeReturnTo);
  } catch (err) {
    return next(err);
  }
}

async function getAdminSiteSettingsPage(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;
  const fallback = siteSettings.buildEnvFallback();

  if (!dbConnected) {
    return res.status(503).render('admin/site-settings', {
      title: 'Admin - Site',
      dbConnected,
      form: fallback,
      successMessage: null,
      errorMessage: "La base de données n'est pas disponible.",
    });
  }

  const successMessage = req.session.adminSiteSettingsSuccess || null;
  const errorMessage = req.session.adminSiteSettingsError || null;
  delete req.session.adminSiteSettingsSuccess;
  delete req.session.adminSiteSettingsError;

  const merged = await siteSettings.getSiteSettingsMergedWithFallback({ bypassCache: true });

  return res.render('admin/site-settings', {
    title: 'Admin - Site',
    dbConnected,
    form: merged,
    successMessage,
    errorMessage,
  });
}

async function postAdminSiteSettings(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminSiteSettingsError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/parametres/site');
    }

    await siteSettings.updateSiteSettingsFromForm(req.body);
    req.session.adminSiteSettingsSuccess = 'Paramètres du site enregistrés.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Paramètres du site enregistrés.' });
    return res.redirect('/admin/parametres/site');
  } catch (err) {
    return next(err);
  }
}

function cleanupUploadedFiles() {}

function getAdminCredentials() {
  const email = normalizeEmail(normalizeEnvString(process.env.ADMIN_EMAIL));
  const password = normalizeEnvString(process.env.ADMIN_PASSWORD);
  const override = readAdminCredentialsFile();

  const isProd = process.env.NODE_ENV === 'production';
  const shouldFallback = !email || (!password && !override);
  const isDevFallback = shouldFallback && !isProd;

  if (isDevFallback) {
    return {
      email: 'admin@carpartsfrance.fr',
      password: 'admin12345',
      isDevFallback: true,
    };
  }

  return {
    email,
    password,
    passwordHash: override ? override.hash : '',
    passwordSalt: override ? override.salt : '',
    usesOverride: Boolean(override),
    isDevFallback: false,
  };
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

async function ensureAdminUserStoreReady() {
  const dbConnected = mongoose.connection.readyState === 1;
  if (!dbConnected) return null;

  const legacyCreds = getAdminCredentials();
  return adminUsers.ensurePrimaryAdminUser({
    legacyEmail: legacyCreds.email,
    legacyPassword: legacyCreds.usesOverride ? '' : legacyCreds.password,
    legacyPasswordHash: legacyCreds.usesOverride ? legacyCreds.passwordHash : '',
    legacyPasswordSalt: legacyCreds.usesOverride ? legacyCreds.passwordSalt : '',
  });
}

function getCurrentAdminSession(req) {
  return req && req.session && req.session.admin && typeof req.session.admin === 'object'
    ? req.session.admin
    : null;
}

function canManageAdminUsers(req) {
  const currentAdmin = getCurrentAdminSession(req);
  return Boolean(currentAdmin && currentAdmin.role === 'owner');
}

function getAdminRoleLabel(role) {
  return role === 'owner' ? 'Administrateur principal' : 'Employé back-office';
}

function renderAdminLoginPage(res, { status = 200, dbConnected, errorMessage, successMessage, email, returnTo, legacyCreds } = {}) {
  const safeCreds = legacyCreds || getAdminCredentials();
  const showDevFallback = !dbConnected && safeCreds.isDevFallback;
  return res.status(status).render('admin/login', {
    title: 'Admin - Connexion',
    dbConnected,
    errorMessage: errorMessage || null,
    successMessage: successMessage || null,
    email: email || '',
    returnTo: returnTo || '/admin',
    isDevFallback: showDevFallback,
    devFallbackEmail: showDevFallback ? safeCreds.email : '',
    devFallbackPassword: showDevFallback ? safeCreds.password : '',
  });
}

function splitCategoryName(value) {
  if (typeof value !== 'string') return { main: '', sub: '' };

  const parts = value
    .split('>')
    .map((p) => String(p || '').trim())
    .filter(Boolean);

  const main = parts[0] || '';
  const sub = parts.length > 1 ? parts.slice(1).join(' > ').trim() : '';

  return { main, sub };
}

function composeCategoryName(mainName, subName) {
  const main = typeof mainName === 'string' ? mainName.trim() : '';
  const sub = typeof subName === 'string' ? subName.trim() : '';
  if (!main) return '';
  if (!sub) return main;
  return `${main} > ${sub}`;
}

async function getAdminCategoriesPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pageRaw = typeof req.query.page === 'string' ? req.query.page.trim() : '';
    const page = Math.max(1, Number.parseInt(pageRaw || '1', 10) || 1);
    const perPage = 10;

    if (!dbConnected) {
      return res.render('admin/categories', {
        title: 'Admin - Catégories',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible.",
        categories: [],
        categoryGroups: [],
        mainCategoryOptions: [],
        shippingClassOptions: [],
        filters: { q },
        pagination: {
          page: 1,
          perPage,
          totalItems: 0,
          totalPages: 1,
          hasPrev: false,
          hasNext: false,
        },
      });
    }

    const errorMessage = req.session.adminCategoryError || null;
    delete req.session.adminCategoryError;

    const categoryDocs = await Category.find({})
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    const shippingClassDocs = await ShippingClass.find({})
      .sort({ sortOrder: 1, name: 1 })
      .select('_id name domicilePriceCents')
      .lean();

    const shippingClassOptions = shippingClassDocs.map((c) => ({
      id: String(c._id),
      name: typeof c.name === 'string' ? c.name.trim() : '',
      domicilePrice: formatEuro(Number.isFinite(c.domicilePriceCents) ? c.domicilePriceCents : 0),
    }));

    const productCategoryCounts = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const countByCategoryName = new Map();
    for (const row of productCategoryCounts) {
      const key = typeof row._id === 'string' ? row._id.trim() : '';
      if (!key) continue;
      const count = Number.isFinite(row.count) ? row.count : 0;
      countByCategoryName.set(key, count);
    }

    const categories = categoryDocs.map((c) => {
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      const usedCountExact = name ? (countByCategoryName.get(name) || 0) : 0;
      const parts = splitCategoryName(name);

      return {
        id: String(c._id),
        name: c.name,
        mainName: parts.main,
        subName: parts.sub,
        isSub: !!parts.sub,
        slug: c.slug,
        isActive: c.isActive !== false,
        isHomeFeatured: c.isHomeFeatured === true,
        sortOrder: Number.isFinite(c.sortOrder) ? c.sortOrder : 0,
        shippingClassId: c.shippingClassId ? String(c.shippingClassId) : '',
        createdAt: formatDateTimeFR(c.createdAt),
        usedCountExact,
      };
    });

    const groupMap = new Map();
    for (const c of categories) {
      const main = c.mainName || '';
      if (!main) continue;
      if (!groupMap.has(main)) {
        groupMap.set(main, { main, mainDoc: null, subs: [] });
      }
      const group = groupMap.get(main);
      if (c.isSub) group.subs.push(c);
      else group.mainDoc = c;
    }

    const categoryGroupsAll = Array.from(groupMap.values())
      .map((g) => {
        let usedCountTotal = 0;
        for (const [key, value] of countByCategoryName.entries()) {
          if (key === g.main || key.startsWith(`${g.main} >`)) {
            usedCountTotal += value;
          }
        }

        const subs = g.subs
          .slice()
          .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'fr'))
          .map((s) => ({
            ...s,
            canDelete: (s.usedCountExact || 0) === 0,
          }));

        const mainDoc = g.mainDoc
          ? {
              ...g.mainDoc,
              usedCountTotal,
              canDelete: usedCountTotal === 0 && subs.length === 0,
            }
          : {
              id: '',
              name: g.main,
              mainName: g.main,
              subName: '',
              isSub: false,
              slug: '',
              isActive: true,
              isHomeFeatured: false,
              sortOrder: 0,
              shippingClassId: '',
              createdAt: '—',
              usedCountExact: 0,
              usedCountTotal,
              canDelete: usedCountTotal === 0 && subs.length === 0,
            };

        return {
          main: g.main,
          usedCountTotal,
          mainDoc,
          subs,
        };
      })
      .sort((a, b) => {
        const aOrder = a.mainDoc && Number.isFinite(a.mainDoc.sortOrder) ? a.mainDoc.sortOrder : 0;
        const bOrder = b.mainDoc && Number.isFinite(b.mainDoc.sortOrder) ? b.mainDoc.sortOrder : 0;
        return (aOrder - bOrder) || a.main.localeCompare(b.main, 'fr');
      });

    const mainCategoryOptions = categoryGroupsAll.map((g) => g.main);

    const filteredGroups = (() => {
      if (!q) return categoryGroupsAll;
      const rx = new RegExp(escapeRegExp(q), 'i');

      return categoryGroupsAll
        .map((g) => {
          const mainMatch = rx.test(g.main);
          if (mainMatch) return g;

          const subs = (g.subs || []).filter((s) => rx.test(s.subName || '') || rx.test(s.name || ''));
          if (!subs.length) return null;

          const usedCountTotal = subs.reduce((sum, s) => sum + (Number(s.usedCountExact) || 0), 0);
          return { ...g, subs, usedCountTotal };
        })
        .filter(Boolean);
    })();

    const totalItems = filteredGroups.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * perPage;
    const paginatedGroups = filteredGroups.slice(startIndex, startIndex + perPage);

    return res.render('admin/categories', {
      title: 'Admin - Catégories',
      dbConnected,
      errorMessage,
      categories,
      categoryGroups: paginatedGroups,
      mainCategoryOptions,
      shippingClassOptions,
      filters: { q },
      pagination: {
        page: currentPage,
        perPage,
        totalItems,
        totalPages,
        hasPrev: currentPage > 1,
        hasNext: currentPage < totalPages,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminCreateCategory(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    const nameFromParts = composeCategoryName(req.body.mainName, req.body.subName);
    const name = nameFromParts || getTrimmedString(req.body.name);
    const sortOrderRaw = typeof req.body.sortOrder === 'string' ? req.body.sortOrder.trim() : '';
    const sortOrderNum = sortOrderRaw ? Number(sortOrderRaw) : 0;
    const sortOrder = Number.isFinite(sortOrderNum) ? Math.floor(sortOrderNum) : 0;

    const shippingClassIdRaw = getTrimmedString(req.body.shippingClassId);
    const shippingClassId = shippingClassIdRaw && mongoose.Types.ObjectId.isValid(shippingClassIdRaw)
      ? new mongoose.Types.ObjectId(shippingClassIdRaw)
      : null;
    const isHomeFeatured = isChecked(req.body && req.body.isHomeFeatured);

    if (!name) {
      req.session.adminCategoryError = 'Merci de renseigner un nom de catégorie.';
      return res.redirect('/admin/categories');
    }

    const slug = slugify(name);
    if (!slug) {
      req.session.adminCategoryError = 'Nom de catégorie invalide.';
      return res.redirect('/admin/categories');
    }

    await Category.create({
      name,
      slug,
      isActive: true,
      isHomeFeatured,
      sortOrder,
      shippingClassId,
    });

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Catégorie créée.' });
    return res.redirect('/admin/categories');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminCategoryError = 'Cette catégorie existe déjà.';
      return res.redirect('/admin/categories');
    }
    return next(err);
  }
}

async function postAdminUpdateCategory(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { categoryId } = req.params;

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.redirect('/admin/categories');
    }

    const existing = await Category.findById(categoryId).select('_id name sortOrder shippingClassId isHomeFeatured').lean();
    if (!existing || typeof existing.name !== 'string' || !existing.name.trim()) {
      return res.redirect('/admin/categories');
    }

    const oldName = existing.name.trim();
    const oldParts = splitCategoryName(oldName);
    const oldIsMain = !!oldParts.main && !oldParts.sub;

    const nextNameFromParts = composeCategoryName(req.body.mainName, req.body.subName);
    const nextNameRaw = nextNameFromParts || getTrimmedString(req.body.name);
    const nextName = typeof nextNameRaw === 'string' ? nextNameRaw.trim() : '';

    const sortOrderRaw = typeof req.body.sortOrder === 'string' ? req.body.sortOrder.trim() : '';
    const sortOrderNum = sortOrderRaw ? Number(sortOrderRaw) : (Number.isFinite(existing.sortOrder) ? existing.sortOrder : 0);
    const sortOrder = Number.isFinite(sortOrderNum) ? Math.floor(sortOrderNum) : 0;

    const shippingClassIdRaw = getTrimmedString(req.body.shippingClassId);
    const shippingClassId = shippingClassIdRaw && mongoose.Types.ObjectId.isValid(shippingClassIdRaw)
      ? new mongoose.Types.ObjectId(shippingClassIdRaw)
      : null;
    const isHomeFeatured = isChecked(req.body && req.body.isHomeFeatured);

    if (!nextName) {
      req.session.adminCategoryError = 'Merci de renseigner un nom de catégorie.';
      return res.redirect('/admin/categories');
    }

    const nextSlug = slugify(nextName);
    if (!nextSlug) {
      req.session.adminCategoryError = 'Nom de catégorie invalide.';
      return res.redirect('/admin/categories');
    }

    const nextParts = splitCategoryName(nextName);
    const nextIsMain = !!nextParts.main && !nextParts.sub;
    const nextIsSub = !!nextParts.main && !!nextParts.sub;

    if (oldIsMain && nextIsSub) {
      const childRx = new RegExp(`^${escapeRegExp(oldParts.main)}\\s*>`);
      const childrenCount = await Category.countDocuments({ name: { $regex: childRx } });
      if (childrenCount > 0) {
        req.session.adminCategoryError = 'Impossible : cette catégorie principale possède des sous-catégories. Supprime ou déplace d’abord les sous-catégories.';
        return res.redirect('/admin/categories');
      }
    }

    const mainRenamed = oldIsMain && nextIsMain && oldParts.main !== nextParts.main;

    if (mainRenamed) {
      const oldMain = oldParts.main;
      const newMain = nextParts.main;

      const catRx = new RegExp(`^${escapeRegExp(oldMain)}(\\s*>|$)`);
      const affectedCats = await Category.find({ name: { $regex: catRx } }).select('_id name sortOrder isHomeFeatured').lean();

      for (const cat of affectedCats) {
        const current = typeof cat.name === 'string' ? cat.name.trim() : '';
        if (!current) continue;

        let updatedName = '';
        if (current === oldMain) {
          updatedName = newMain;
        } else {
          updatedName = current.replace(new RegExp(`^${escapeRegExp(oldMain)}\\s*>\\s*`), `${newMain} > `);
        }

        const updatedSlug = slugify(updatedName);
        if (!updatedSlug) continue;

        const updatedSortOrder = String(cat._id) === String(existing._id)
          ? sortOrder
          : (Number.isFinite(cat.sortOrder) ? cat.sortOrder : 0);

        await Category.findByIdAndUpdate(cat._id, {
          $set: {
            name: updatedName,
            slug: updatedSlug,
            sortOrder: updatedSortOrder,
            ...(String(cat._id) === String(existing._id) ? { shippingClassId, isHomeFeatured } : {}),
          },
        });
      }

      const prodRx = new RegExp(`^${escapeRegExp(oldMain)}(\\s*>|$)`);
      const products = await Product.find({ category: { $regex: prodRx } }).select('_id category').lean();
      for (const p of products) {
        const current = typeof p.category === 'string' ? p.category.trim() : '';
        if (!current) continue;

        let updated = '';
        if (current === oldMain) {
          updated = newMain;
        } else {
          updated = current.replace(new RegExp(`^${escapeRegExp(oldMain)}\\s*>\\s*`), `${newMain} > `);
        }

        if (updated && updated !== current) {
          await Product.updateOne({ _id: p._id }, { $set: { category: updated } });
        }
      }
    } else {
      if (
        nextName !== oldName ||
        sortOrder !== (Number.isFinite(existing.sortOrder) ? existing.sortOrder : 0) ||
        String(existing.shippingClassId || '') !== String(shippingClassId || '') ||
        existing.isHomeFeatured === true !== isHomeFeatured
      ) {
        await Category.findByIdAndUpdate(categoryId, {
          $set: { name: nextName, slug: nextSlug, sortOrder, shippingClassId, isHomeFeatured },
        });
      }

      if (nextName !== oldName) {
        await Product.updateMany({ category: oldName }, { $set: { category: nextName } });
      }
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Catégorie mise à jour.' });
    return res.redirect('/admin/categories');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminCategoryError = 'Cette catégorie existe déjà.';
      return res.redirect('/admin/categories');
    }
    return next(err);
  }
}

async function postAdminToggleCategory(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { categoryId } = req.params;

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.redirect('/admin/categories');
    }

    const existing = await Category.findById(categoryId).select('_id name isActive').lean();
    if (!existing) {
      return res.redirect('/admin/categories');
    }

    const nextIsActive = existing.isActive === false;

    const name = typeof existing.name === 'string' ? existing.name.trim() : '';
    const parts = splitCategoryName(name);
    const isMain = !!parts.main && !parts.sub;

    await Category.findByIdAndUpdate(categoryId, {
      $set: { isActive: nextIsActive },
    });

    if (isMain && parts.main) {
      const childRx = new RegExp(`^${escapeRegExp(parts.main)}\\s*>`);
      await Category.updateMany({ name: { $regex: childRx } }, { $set: { isActive: nextIsActive } });
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Statut modifié.', data: { id: categoryId, isActive: nextIsActive } });
    return res.redirect('/admin/categories');
  } catch (err) {
    return next(err);
  }
}

async function postAdminDeleteCategory(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { categoryId } = req.params;

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.redirect('/admin/categories');
    }

    const existing = await Category.findById(categoryId).select('_id name').lean();
    if (!existing) {
      return res.redirect('/admin/categories');
    }

    const name = typeof existing.name === 'string' ? existing.name.trim() : '';
    const parts = splitCategoryName(name);
    const isMain = !!parts.main && !parts.sub;

    if (isMain && parts.main) {
      const childRx = new RegExp(`^${escapeRegExp(parts.main)}\\s*>`);
      const childrenCount = await Category.countDocuments({ name: { $regex: childRx } });
      if (childrenCount > 0) {
        const msg = 'Impossible de supprimer : cette cat\u00e9gorie principale poss\u00e8de des sous-cat\u00e9gories.';
        if (wantsJsonResponse(req)) return res.status(409).json({ ok: false, error: msg });
        req.session.adminCategoryError = msg;
        return res.redirect('/admin/categories');
      }

      const usedRx = new RegExp(`^${escapeRegExp(parts.main)}(\\s*>|$)`);
      const usedCount = await Product.countDocuments({ category: { $regex: usedRx } });
      if (usedCount > 0) {
        const msg = 'Impossible de supprimer : cette cat\u00e9gorie est utilis\u00e9e par des produits.';
        if (wantsJsonResponse(req)) return res.status(409).json({ ok: false, error: msg });
        req.session.adminCategoryError = msg;
        return res.redirect('/admin/categories');
      }
    } else {
      const usedCount = await Product.countDocuments({ category: existing.name });
      if (usedCount > 0) {
        const msg = 'Impossible de supprimer : cette cat\u00e9gorie est utilis\u00e9e par des produits.';
        if (wantsJsonResponse(req)) return res.status(409).json({ ok: false, error: msg });
        req.session.adminCategoryError = msg;
        return res.redirect('/admin/categories');
      }
    }

    await Category.findByIdAndDelete(categoryId);
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Cat\u00e9gorie supprim\u00e9e.', data: { deletedIds: [categoryId] } });
    return res.redirect('/admin/categories');
  } catch (err) {
    return next(err);
  }
}

async function postAdminBulkDeleteCategories(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    const rawIds = req.body && (req.body.categoryIds || req.body.categoryId || req.body.ids);
    const ids = Array.isArray(rawIds)
      ? rawIds
      : typeof rawIds === 'string'
        ? [rawIds]
        : [];

    const uniqueIds = Array.from(
      new Set(
        ids
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter(Boolean)
      )
    );

    if (!uniqueIds.length) {
      req.session.adminCategoryError = 'Aucune catégorie sélectionnée.';
      return res.redirect('/admin/categories');
    }

    const validIds = uniqueIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validIds.length) {
      req.session.adminCategoryError = 'Sélection invalide.';
      return res.redirect('/admin/categories');
    }

    const selectedCats = await Category.find({ _id: { $in: validIds } })
      .select('_id name')
      .lean();

    if (!selectedCats.length) {
      req.session.adminCategoryError = 'Aucune catégorie trouvée.';
      return res.redirect('/admin/categories');
    }

    const selectedById = new Map(selectedCats.map((c) => [String(c._id), c]));
    const selectedIdSet = new Set(Array.from(selectedById.keys()));

    const names = selectedCats
      .map((c) => (typeof c.name === 'string' ? c.name.trim() : ''))
      .filter(Boolean);

    const subNames = [];
    const mains = [];
    const mainSet = new Set();

    for (const name of names) {
      const parts = splitCategoryName(name);
      const isMain = !!parts.main && !parts.sub;
      if (isMain) {
        if (!mainSet.has(parts.main)) {
          mainSet.add(parts.main);
          mains.push(parts.main);
        }
      } else {
        subNames.push(name);
      }
    }

    const usedSubCounts = new Map();
    if (subNames.length) {
      const counts = await Product.aggregate([
        { $match: { category: { $in: subNames } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);
      for (const row of counts) {
        const key = typeof row._id === 'string' ? row._id.trim() : '';
        if (!key) continue;
        usedSubCounts.set(key, Number.isFinite(row.count) ? row.count : 0);
      }
    }

    const mainChildrenByMain = new Map();
    for (const main of mains) {
      const childRx = new RegExp(`^${escapeRegExp(main)}\\s*>`);
      const children = await Category.find({ name: { $regex: childRx } })
        .select('_id')
        .lean();
      mainChildrenByMain.set(
        main,
        children.map((c) => String(c._id))
      );
    }

    const deletableIds = [];
    const blocked = [];

    for (const cat of selectedCats) {
      const id = String(cat._id);
      const name = typeof cat.name === 'string' ? cat.name.trim() : '';
      const parts = splitCategoryName(name);
      const isMain = !!parts.main && !parts.sub;

      if (!name) {
        blocked.push('Catégorie invalide');
        continue;
      }

      if (isMain && parts.main) {
        const childrenIds = mainChildrenByMain.get(parts.main) || [];
        const missingChildren = childrenIds.filter((childId) => !selectedIdSet.has(childId));

        if (missingChildren.length) {
          blocked.push(`${parts.main} (possède des sous-catégories)`);
          continue;
        }

        const usedRx = new RegExp(`^${escapeRegExp(parts.main)}(\\s*>|$)`);
        const usedCount = await Product.countDocuments({ category: { $regex: usedRx } });
        if (usedCount > 0) {
          blocked.push(`${parts.main} (utilisée par des produits)`);
          continue;
        }

        deletableIds.push(id);
      } else {
        const usedCount = usedSubCounts.get(name) || 0;
        if (usedCount > 0) {
          blocked.push(`${name} (utilisée par des produits)`);
          continue;
        }

        deletableIds.push(id);
      }
    }

    if (!deletableIds.length) {
      const errMsg = blocked.length
        ? `Aucune suppression possible. Bloqué : ${blocked.slice(0, 5).join(', ')}${blocked.length > 5 ? '…' : ''}`
        : 'Aucune suppression possible.';
      if (wantsJsonResponse(req)) return res.status(409).json({ ok: false, error: errMsg });
      req.session.adminCategoryError = errMsg;
      return res.redirect('/admin/categories');
    }

    await Category.deleteMany({ _id: { $in: deletableIds } });

    if (blocked.length) {
      req.session.adminCategoryError = `Suppression partielle : ${deletableIds.length} supprimée(s). Bloqué : ${blocked.slice(0, 5).join(', ')}${blocked.length > 5 ? '…' : ''}`;
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: deletableIds.length + ' catégorie(s) supprimée(s).', data: { deletedIds: deletableIds, blockedCount: blocked.length } });
    return res.redirect('/admin/categories');
  } catch (err) {
    return next(err);
  }
}

function getSafeReturnTo(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/admin')) return null;
  if (value.startsWith('//')) return null;
  return value;
}

function getOrderStatusBadge(status) {
  switch (status) {
    case 'expediee':
      return { label: 'Expédiée', className: 'status-chip status-expediee' };
    case 'livree':
      return { label: 'Livrée', className: 'status-chip status-livree' };
    case 'annulee':
      return { label: 'Annulée', className: 'status-chip status-annulee' };
    case 'validee':
      return { label: 'En préparation', className: 'status-chip status-en-preparation' };
    case 'remboursee':
      return { label: 'Remboursée', className: 'status-chip status-remboursee' };
    case 'en_attente':
    default:
      return { label: 'En attente', className: 'status-chip status-en-attente' };
  }
}

function getOrderStatusOptions() {
  return [
    { key: 'en_attente', label: 'En attente' },
    { key: 'validee', label: 'En préparation' },
    { key: 'expediee', label: 'Expédiée' },
    { key: 'livree', label: 'Livrée' },
    { key: 'annulee', label: 'Annulée' },
  ];
}

function getReturnStatusBadge(status) {
  switch (status) {
    case 'accepte':
      return { label: 'Accepté', className: 'bg-green-50 text-green-700' };
    case 'refuse':
      return { label: 'Refusé', className: 'bg-red-50 text-red-700' };
    case 'en_transit':
      return { label: 'En transit', className: 'bg-blue-50 text-blue-700' };
    case 'recu':
      return { label: 'Reçu', className: 'bg-slate-100 text-slate-700' };
    case 'rembourse':
      return { label: 'Remboursé', className: 'bg-green-50 text-green-700' };
    case 'cloture':
      return { label: 'Clôturé', className: 'bg-slate-100 text-slate-700' };
    case 'en_attente':
    default:
      return { label: 'En attente', className: 'bg-amber-50 text-amber-800' };
  }
}

function getReturnStatusOptions() {
  return [
    { key: 'en_attente', label: 'En attente' },
    { key: 'accepte', label: 'Accepté' },
    { key: 'refuse', label: 'Refusé' },
    { key: 'en_transit', label: 'En transit' },
    { key: 'recu', label: 'Reçu' },
    { key: 'rembourse', label: 'Remboursé' },
    { key: 'cloture', label: 'Clôturé' },
  ];
}

async function getAdminLogin(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;
  const creds = getAdminCredentials();

  if (dbConnected) {
    try {
      await ensureAdminUserStoreReady();
    } catch (err) {
      console.error('Initialisation comptes back-office impossible :', err && err.message ? err.message : err);
    }
  }

  const returnTo = getSafeReturnTo(req.query.returnTo) || '/admin';
  const errorMessage = req.session.adminAuthError || null;
  const successMessage = req.session.adminAuthSuccess || null;
  const email = req.session.adminAuthEmail || '';

  delete req.session.adminAuthError;
  delete req.session.adminAuthSuccess;
  delete req.session.adminAuthEmail;

  return renderAdminLoginPage(res, {
    dbConnected,
    errorMessage,
    successMessage,
    email,
    returnTo,
    legacyCreds: creds,
  });
}

async function postAdminLogin(req, res) {
  const creds = getAdminCredentials();
  const dbConnected = mongoose.connection.readyState === 1;
  const email = normalizeEmail(req.body.email);
  const password = normalizeEnvString(req.body.password);
  const returnTo = getSafeReturnTo(req.body.returnTo) || '/admin';

  const ip = getClientIp(req);
  const honeypot = getTrimmedString(req.body && req.body.website);
  if (honeypot) {
    return renderAdminLoginPage(res, {
      status: 401,
      dbConnected,
      errorMessage: 'Identifiants incorrects.',
      email,
      returnTo,
      legacyCreds: creds,
    });
  }

  const limit = consumeRateLimit(ADMIN_LOGIN_BUCKETS, ip, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (limit.limited) {
    return renderAdminLoginPage(res, {
      status: 429,
      dbConnected,
      errorMessage: 'Trop de tentatives. Merci de patienter quelques minutes puis de réessayer.',
      email,
      returnTo,
      legacyCreds: creds,
    });
  }

  if (!email || !password) {
    return renderAdminLoginPage(res, {
      status: 400,
      dbConnected,
      errorMessage: 'Merci de renseigner votre email et votre mot de passe.',
      email,
      returnTo,
      legacyCreds: creds,
    });
  }

  if (dbConnected) {
    let adminUser = null;
    try {
      await ensureAdminUserStoreReady();
      adminUser = await adminUsers.authenticateAdminUser({ email, password });
    } catch (err) {
      console.error('Connexion back-office MongoDB impossible :', err && err.message ? err.message : err);
      adminUser = null;
    }

    if (!adminUser) {
      return renderAdminLoginPage(res, {
        status: 401,
        dbConnected,
        errorMessage: 'Identifiants incorrects.',
        email,
        returnTo,
        legacyCreds: creds,
      });
    }

    const sessionAdmin = adminUsers.sanitizeAdminForSession(adminUser);

    if (req.session && typeof req.session.regenerate === 'function') {
      return req.session.regenerate((err) => {
        if (err) return res.redirect('/admin/connexion');
        req.session.admin = sessionAdmin;
        return req.session.save(() => {
          adminUsers.touchLastLogin(sessionAdmin.adminUserId).catch(() => {});
          return res.redirect(returnTo);
        });
      });
    }

    if (!req.session || typeof req.session.save !== 'function') {
      return res.redirect(returnTo);
    }

    req.session.admin = sessionAdmin;
    return req.session.save(() => {
      adminUsers.touchLastLogin(sessionAdmin.adminUserId).catch(() => {});
      return res.redirect(returnTo);
    });
  }

  const passwordOk = creds.usesOverride
    ? verifyPassword({ password, salt: creds.passwordSalt, hash: creds.passwordHash })
    : password === normalizeEnvString(creds.password);

  if (email !== creds.email || !passwordOk) {
    return renderAdminLoginPage(res, {
      status: 401,
      dbConnected,
      errorMessage: 'Identifiants incorrects.',
      email,
      returnTo,
      legacyCreds: creds,
    });
  }

  req.session.admin = {
    email,
  };

  if (req.session && typeof req.session.regenerate === 'function') {
    return req.session.regenerate((err) => {
      if (err) return res.redirect('/admin/connexion');
      req.session.admin = { email };
      return req.session.save(() => res.redirect(returnTo));
    });
  }

  if (!req.session || typeof req.session.save !== 'function') {
    return res.redirect(returnTo);
  }

  req.session.admin = { email };
  return req.session.save(() => res.redirect(returnTo));
}

function getAdminResetTokenFromEnv() {
  return normalizeEnvString(process.env.ADMIN_RESET_TOKEN);
}

function getAdminResetPassword(req, res) {
  const token = getAdminResetTokenFromEnv();
  const enabled = Boolean(token);
  const errorMessage = req.session.adminResetError || null;
  const successMessage = req.session.adminResetSuccess || null;

  delete req.session.adminResetError;
  delete req.session.adminResetSuccess;

  return res.render('admin/reset-password', {
    title: 'Admin - Réinitialisation',
    enabled,
    errorMessage,
    successMessage,
  });
}

async function postAdminResetPassword(req, res) {
  const expected = getAdminResetTokenFromEnv();
  if (!expected) {
    req.session.adminResetError = 'Réinitialisation désactivée (ADMIN_RESET_TOKEN manquant).';
    return res.redirect('/admin/reinitialiser');
  }

  const ip = getClientIp(req);
  const honeypot = getTrimmedString(req.body && req.body.website);
  if (honeypot) {
    req.session.adminResetSuccess = 'Mot de passe admin mis à jour. Vous pouvez vous connecter.';
    return res.redirect('/admin/reinitialiser');
  }

  const limit = consumeRateLimit(ADMIN_RESET_BUCKETS, ip, { limit: 12, windowMs: 10 * 60 * 1000 });
  if (limit.limited) {
    req.session.adminResetError = 'Trop de tentatives. Merci de patienter quelques minutes puis de réessayer.';
    return res.redirect('/admin/reinitialiser');
  }

  const providedToken = normalizeEnvString(req.body && req.body.token);
  const password = normalizeEnvString(req.body && req.body.password);
  const passwordConfirm = normalizeEnvString(req.body && req.body.passwordConfirm);
  const dbConnected = mongoose.connection.readyState === 1;

  if (!providedToken || providedToken !== expected) {
    req.session.adminResetError = 'Code secret invalide.';
    return res.redirect('/admin/reinitialiser');
  }

  if (!password || password.length < 8) {
    req.session.adminResetError = 'Le nouveau mot de passe doit faire au moins 8 caractères.';
    return res.redirect('/admin/reinitialiser');
  }

  if (password !== passwordConfirm) {
    req.session.adminResetError = 'Les deux mots de passe ne correspondent pas.';
    return res.redirect('/admin/reinitialiser');
  }

  if (dbConnected) {
    try {
      await ensureAdminUserStoreReady();
      const updated = await adminUsers.updatePrimaryAdminPassword(password);
      if (!updated || !updated.ok) {
        req.session.adminResetError = 'Impossible de mettre à jour le compte principal pour le moment.';
        return res.redirect('/admin/reinitialiser');
      }

      req.session.adminAuthSuccess = 'Mot de passe admin mis à jour. Vous pouvez vous connecter.';
      return res.redirect('/admin/connexion');
    } catch (err) {
      req.session.adminResetError = 'Impossible de mettre à jour le mot de passe (erreur interne).';
      return res.redirect('/admin/reinitialiser');
    }
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  if (!hash) {
    req.session.adminResetError = 'Impossible de sécuriser le mot de passe (erreur interne).';
    return res.redirect('/admin/reinitialiser');
  }

  const ok = writeAdminCredentialsFile({ salt, hash });
  if (!ok) {
    req.session.adminResetError = 'Impossible d’enregistrer le mot de passe (droits serveur).';
    return res.redirect('/admin/reinitialiser');
  }

  req.session.adminAuthSuccess = 'Mot de passe admin mis à jour. Vous pouvez vous connecter.';
  return res.redirect('/admin/connexion');
}

function postAdminLogout(req, res) {
  delete req.session.admin;
  if (!req.session || typeof req.session.save !== 'function') {
    return res.redirect('/admin/connexion');
  }
  return req.session.save(() => res.redirect('/admin/connexion'));
}

async function getAdminDashboard(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    if (!dbConnected) {
      return res.render('admin/dashboard', {
        title: 'Admin - Dashboard',
        dbConnected,
        kpis: {},
        weeklyChart: { labels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'], values: [0, 0, 0, 0, 0, 0, 0], prevValues: [0, 0, 0, 0, 0, 0, 0] },
        monthlyChart: { labels: [], values: [] },
        activities: [],
      });
    }

    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startMonth = new Date(now);
    startMonth.setDate(1);
    startMonth.setHours(0, 0, 0, 0);

    const revenueTodayAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: startToday } } },
      { $group: { _id: null, total: { $sum: '$totalCents' } } },
    ]);
    const revenueMonthAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: startMonth } } },
      { $group: { _id: null, total: { $sum: '$totalCents' } } },
    ]);

    const revenueTodayCents = revenueTodayAgg && revenueTodayAgg[0] ? Number(revenueTodayAgg[0].total) : 0;
    const revenueMonthCents = revenueMonthAgg && revenueMonthAgg[0] ? Number(revenueMonthAgg[0].total) : 0;

    const pendingOrdersCount = await Order.countDocuments({ status: 'en_attente' });
    const stockAlertsCount = await Product.countDocuments({ stockQty: { $ne: null, $lte: 2 } });

    /* ── Weekly bar chart data (last 7 days + previous 7 days) ── */
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    const dailyRevenueAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: prevWeekStart } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Europe/Paris' } },
          total: { $sum: '$totalCents' },
        },
      },
    ]);
    const dailyMap = new Map(dailyRevenueAgg.map((d) => [d._id, d.total]));

    const weekLabels = [];
    const weekValues = [];
    const prevWeekValues = [];
    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      weekLabels.push(dayNames[d.getDay()] + ' ' + d.getDate());
      weekValues.push(Math.round((dailyMap.get(key) || 0) / 100));

      const pd = new Date(prevWeekStart);
      pd.setDate(pd.getDate() + i);
      const pkey = pd.toISOString().slice(0, 10);
      prevWeekValues.push(Math.round((dailyMap.get(pkey) || 0) / 100));
    }

    /* ── Monthly line chart data (last 6 months) ── */
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyRevenueAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Europe/Paris' } },
          total: { $sum: '$totalCents' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const monthlyMap = new Map(monthlyRevenueAgg.map((m) => [m._id, m]));

    const monthLabels = [];
    const monthValues = [];
    const monthNamesFR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
    for (let i = 0; i < 6; i++) {
      const md = new Date(sixMonthsAgo);
      md.setMonth(md.getMonth() + i);
      const key = md.toISOString().slice(0, 7);
      monthLabels.push(monthNamesFR[md.getMonth()] + ' ' + md.getFullYear());
      const entry = monthlyMap.get(key);
      monthValues.push(Math.round((entry ? entry.total : 0) / 100));
    }

    /* ── New KPIs: average basket + top products ── */
    const ordersThisMonth = await Order.countDocuments({ createdAt: { $gte: startMonth } });
    const averageBasketCents = ordersThisMonth > 0 ? Math.round(revenueMonthCents / ordersThisMonth) : 0;

    const topProductsAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: startMonth } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          totalQty: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.lineTotalCents' },
        },
      },
      { $sort: { totalQty: -1 } },
      { $limit: 3 },
    ]);
    const topProducts = topProductsAgg.map((p) => ({
      name: p._id || 'Sans nom',
      qty: p.totalQty,
      revenue: formatEuro(p.totalRevenue),
    }));

    const latestOrders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('_id number userId accountType totalCents createdAt status')
      .lean();

    const userIds = latestOrders
      .map((o) => (o && o.userId ? String(o.userId) : null))
      .filter(Boolean)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const users = await User.find({ _id: { $in: userIds } })
      .select('_id firstName lastName email companyName accountType')
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const activities = latestOrders.map((o) => {
      const u = o.userId ? userMap.get(String(o.userId)) : null;
      const customer = u
        ? u.accountType === 'pro'
          ? u.companyName || `${u.firstName} ${u.lastName}`
          : `${u.firstName} ${u.lastName}`
        : 'Client';

      return {
        number: o.number,
        accountType: o.accountType,
        customer,
        total: formatEuro(o.totalCents),
        when: formatDateTimeFR(o.createdAt),
        statusBadge: getOrderStatusBadge(o.status),
      };
    });

    return res.render('admin/dashboard', {
      title: 'Admin - Dashboard',
      dbConnected,
      kpis: {
        revenueToday: formatEuro(revenueTodayCents),
        revenueMonth: formatEuro(revenueMonthCents),
        pendingOrdersCount,
        stockAlertsCount,
        averageBasket: formatEuro(averageBasketCents),
        ordersThisMonth,
        topProducts,
      },
      weeklyChart: { labels: weekLabels, values: weekValues, prevValues: prevWeekValues },
      monthlyChart: { labels: monthLabels, values: monthValues },
      activities,
    });
  } catch (err) {
    return next(err);
  }
}

async function getAdminOrdersPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const period = typeof req.query.period === 'string' ? req.query.period.trim() : '';
    const sortFieldRaw = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';
    const sortOrderRaw = typeof req.query.order === 'string' ? req.query.order.trim() : '';
    const allowedOrderSortFields = new Set(['date', 'total', 'status']);
    const activeSortField = allowedOrderSortFields.has(sortFieldRaw) ? sortFieldRaw : 'date';
    const activeSortDir = sortOrderRaw === 'asc' ? 1 : -1;
    const orderSortFieldMap = { date: 'createdAt', total: 'totalCents', status: 'status' };
    const mongoOrderSort = { [orderSortFieldMap[activeSortField]]: activeSortDir };
    const limitRaw = typeof req.query.limit === 'string' ? req.query.limit.trim() : '';
    const requestedLimit = Number.parseInt(limitRaw || '20', 10) || 20;
    const allowedOrderLimits = new Set([20, 50, 100]);
    const perPage = allowedOrderLimits.has(requestedLimit) ? requestedLimit : 20;
    const rawPage = typeof req.query.page !== 'undefined' ? String(req.query.page) : '';
    const requestedPage = Math.max(1, Number.parseInt(rawPage, 10) || 1);

    if (!dbConnected) {
      return res.render('admin/orders', {
        title: 'Admin - Commandes',
        dbConnected,
        orders: [],
        filters: { q, status, type, period },
        pagination: { page: 1, perPage, totalItems: 0, totalPages: 1, from: 0, to: 0, hasPrev: false, hasNext: false, prevPage: 1, nextPage: 1 },
      });
    }

    const query = {};

    const allowedStatus = new Set(getOrderStatusOptions().map((o) => o.key));
    if (status && allowedStatus.has(status)) {
      query.status = status;
    }

    if (type === 'pro' || type === 'particulier') {
      query.accountType = type;
    }

    if (period) {
      const today = new Date();
      const start = new Date(today);
      if (period === '7d') start.setDate(start.getDate() - 7);
      if (period === '30d') start.setDate(start.getDate() - 30);
      if (period === '90d') start.setDate(start.getDate() - 90);
      if (period === '365d') start.setDate(start.getDate() - 365);
      if (['7d', '30d', '90d', '365d'].includes(period)) {
        query.createdAt = { $gte: start };
      }
    }

    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      const userMatches = await User.find({
        $or: [{ email: rx }, { firstName: rx }, { lastName: rx }, { companyName: rx }],
      })
        .select('_id')
        .limit(50)
        .lean();

      const userIds = userMatches
        .map((u) => (u && u._id ? u._id : null))
        .filter(Boolean);

      query.$or = [{ number: rx }];
      if (userIds.length) {
        query.$or.push({ userId: { $in: userIds } });
      }
    }

    const totalItems = await Order.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const page = Math.min(requestedPage, totalPages);
    const skip = (page - 1) * perPage;

    const orders = await Order.find(query)
      .sort(mongoOrderSort)
      .skip(skip)
      .limit(perPage)
      .lean();

    const userIds = orders
      .map((o) => (o && o.userId ? String(o.userId) : null))
      .filter(Boolean)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const users = await User.find({ _id: { $in: userIds } })
      .select('_id accountType firstName lastName email companyName')
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const viewOrders = orders.map((o) => {
      const u = o.userId ? userMap.get(String(o.userId)) : null;
      const customer = u
        ? u.accountType === 'pro'
          ? u.companyName || `${u.firstName} ${u.lastName}`
          : `${u.firstName} ${u.lastName}`
        : 'Client';

      const itemCount = Array.isArray(o.items)
        ? o.items.reduce((sum, it) => {
            if (!it || !Number.isFinite(it.quantity)) return sum;
            return sum + it.quantity;
          }, 0)
        : 0;

      return {
        id: String(o._id),
        number: o.number,
        date: formatDateTimeFR(o.createdAt),
        customer,
        customerEmail: u && u.email ? u.email : '',
        accountType: o.accountType,
        itemCount,
        total: formatEuro(o.totalCents),
        statusBadge: getOrderStatusBadge(o.status),
      };
    });

    const pagination = {
      page,
      perPage,
      totalItems,
      totalPages,
      from: totalItems ? skip + 1 : 0,
      to: totalItems ? skip + orders.length : 0,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: Math.max(1, page - 1),
      nextPage: Math.min(totalPages, page + 1),
    };

    return res.render('admin/orders', {
      title: 'Admin - Commandes',
      dbConnected,
      orders: viewOrders,
      filters: { q, status, type, period, sort: activeSortField, order: activeSortDir === 1 ? 'asc' : 'desc', limit: perPage },
      pagination,
    });
  } catch (err) {
    return next(err);
  }
}

async function getAdminOrderDetailPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { orderId } = req.params;

    if (!dbConnected) {
      return res.status(503).render('admin/order', {
        title: 'Admin - Commande',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible.",
        successMessage: null,
        order: null,
        statusOptions: getOrderStatusOptions(),
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const errorMessage = req.session.adminOrderError || null;
    const successMessage = req.session.adminOrderSuccess || null;
    delete req.session.adminOrderError;
    delete req.session.adminOrderSuccess;

    const orderDoc = await Order.findById(orderId).lean();
    if (!orderDoc) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const user = orderDoc.userId
      ? await User.findById(orderDoc.userId)
          .select('_id accountType firstName lastName email companyName')
          .lean()
      : null;

    const customer = user
      ? user.accountType === 'pro'
        ? user.companyName || `${user.firstName} ${user.lastName}`
        : `${user.firstName} ${user.lastName}`
      : orderDoc.accountType === 'pro'
        ? 'Client Pro'
        : 'Client';

    const fallbackItemsSubtotalCents = Array.isArray(orderDoc.items)
      ? orderDoc.items.reduce((sum, it) => sum + (Number(it && it.lineTotalCents) || 0), 0)
      : 0;

    const itemsSubtotalCents = Number.isFinite(orderDoc.itemsSubtotalCents)
      ? orderDoc.itemsSubtotalCents
      : fallbackItemsSubtotalCents;

    const clientDiscountPercent = Number.isFinite(orderDoc.clientDiscountPercent)
      ? orderDoc.clientDiscountPercent
      : 0;

    const clientDiscountCents = Number.isFinite(orderDoc.clientDiscountCents)
      ? orderDoc.clientDiscountCents
      : 0;

    const promoCode = typeof orderDoc.promoCode === 'string' ? orderDoc.promoCode : '';

    const promoDiscountCents = Number.isFinite(orderDoc.promoDiscountCents)
      ? orderDoc.promoDiscountCents
      : 0;

    const itemsTotalAfterDiscountCents = Number.isFinite(orderDoc.itemsTotalAfterDiscountCents)
      ? orderDoc.itemsTotalAfterDiscountCents
      : Math.max(0, itemsSubtotalCents - clientDiscountCents - promoDiscountCents);

    const shippingCostCents = Number(orderDoc.shippingCostCents) || 0;
    const totalCents = Number.isFinite(orderDoc.totalCents)
      ? orderDoc.totalCents
      : itemsTotalAfterDiscountCents + shippingCostCents;

    const htCents = Math.round(totalCents / 1.2);
    const vatCents = Math.max(0, totalCents - htCents);

    const statusHistory = Array.isArray(orderDoc.statusHistory)
      ? orderDoc.statusHistory
          .slice()
          .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
          .map((h) => ({
            statusKey: h.status,
            statusBadge: getOrderStatusBadge(h.status),
            changedAt: formatDateTimeFR(h.changedAt),
            changedBy: h.changedBy || '—',
          }))
      : [];

    const shipments = Array.isArray(orderDoc.shipments)
      ? orderDoc.shipments
          .filter(Boolean)
          .slice()
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((s) => ({
            id: String(s._id),
            label: s.label || '',
            carrier: s.carrier || '',
            trackingNumber: s.trackingNumber,
            note: s.note || '',
            createdAt: formatDateTimeFR(s.createdAt),
            createdBy: s.createdBy || '',
          }))
      : [];

    const items = Array.isArray(orderDoc.items)
      ? orderDoc.items.map((it) => ({
          name: it.name,
          sku: it.sku || '',
          optionsSummary: it && typeof it.optionsSummary === 'string' ? it.optionsSummary : '',
          quantity: it.quantity,
          unitPrice: formatEuro(it.unitPriceCents),
          lineTotal: formatEuro(it.lineTotalCents),
          imageUrl: null,
          inStock: null,
        }))
      : [];

    const consigneLines = orderDoc && orderDoc.consigne && Array.isArray(orderDoc.consigne.lines)
      ? orderDoc.consigne.lines
      : [];

    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);

    const viewConsigneLines = consigneLines
      .filter(Boolean)
      .map((l) => {
        const qty = Number.isFinite(l.quantity) ? l.quantity : 1;
        const amountCents = Number.isFinite(l.amountCents) ? l.amountCents : 0;
        const totalLineCents = amountCents * qty;

        const dueAt = l.dueAt ? new Date(l.dueAt) : null;
        const receivedAt = l.receivedAt ? new Date(l.receivedAt) : null;

        let daysLeft = null;
        if (dueAt && !Number.isNaN(dueAt.getTime())) {
          const dueDay = new Date(dueAt);
          dueDay.setHours(0, 0, 0, 0);
          daysLeft = Math.ceil((dueDay.getTime() - startToday.getTime()) / (24 * 60 * 60 * 1000));
        }

        const isReceived = !!receivedAt;
        const isOverdue = !isReceived && daysLeft !== null && daysLeft < 0;
        const isPending = !isReceived;

        return {
          name: l.name || 'Produit',
          sku: l.sku || '',
          quantity: qty,
          amount: formatEuro(amountCents),
          amountCents,
          total: formatEuro(totalLineCents),
          totalCents: totalLineCents,
          startAt: l.startAt ? formatDateTimeFR(l.startAt) : '',
          dueAt: dueAt ? formatDateTimeFR(dueAt) : '',
          receivedAt: receivedAt ? formatDateTimeFR(receivedAt) : '',
          daysLeft,
          isReceived,
          isOverdue,
          isPending,
        };
      });

    const totalDueCents = viewConsigneLines
      .filter((l) => l && l.isOverdue)
      .reduce((sum, l) => sum + (Number(l.totalCents) || 0), 0);

    const totalAllCents = viewConsigneLines
      .reduce((sum, l) => sum + (Number(l.totalCents) || 0), 0);

    const consigne = {
      hasConsigne: viewConsigneLines.length > 0,
      hasPending: viewConsigneLines.some((l) => l && l.isPending),
      hasOverdue: viewConsigneLines.some((l) => l && l.isOverdue),
      lines: viewConsigneLines,
      totalDue: formatEuro(totalDueCents),
      totalDueCents,
      totalAll: formatEuro(totalAllCents),
      totalAllCents,
    };

    return res.render('admin/order', {
      title: `Admin - ${orderDoc.number}`,
      dbConnected,
      errorMessage,
      successMessage,
      statusOptions: getOrderStatusOptions(),
      order: {
        id: String(orderDoc._id),
        number: orderDoc.number,
        dateTime: formatDateTimeFR(orderDoc.createdAt),
        statusKey: orderDoc.status,
        statusBadge: getOrderStatusBadge(orderDoc.status),
        statusHistory,
        customer,
        customerEmail: user && user.email ? user.email : '',
        accountType: orderDoc.accountType,
        vehicle: orderDoc.vehicle
          ? {
              identifierType: orderDoc.vehicle.identifierType || '',
              plate: orderDoc.vehicle.plate || '',
              vin: orderDoc.vehicle.vin || '',
              consentAt: orderDoc.vehicle.consentAt ? formatDateTimeFR(orderDoc.vehicle.consentAt) : '',
              providedAt: orderDoc.vehicle.providedAt ? formatDateTimeFR(orderDoc.vehicle.providedAt) : '',
            }
          : null,
        legal: orderDoc.legal
          ? {
              cgvAcceptedAt: orderDoc.legal.cgvAcceptedAt ? formatDateTimeFR(orderDoc.legal.cgvAcceptedAt) : '',
              cgvSlug: orderDoc.legal.cgvSlug || 'cgv',
              cgvUpdatedAt: orderDoc.legal.cgvUpdatedAt ? formatDateTimeFR(orderDoc.legal.cgvUpdatedAt) : '',
            }
          : null,
        consigne,
        shippingMethod: orderDoc.shippingMethod || 'domicile',
        shippingCostCents,
        shippingCost: formatEuro(shippingCostCents),
        shippingAddress: orderDoc.shippingAddress || null,
        billingAddress: orderDoc.billingAddress || null,
        items,
        shipments,
        itemsSubtotal: formatEuro(itemsSubtotalCents),
        clientDiscountPercent,
        clientDiscountCents,
        promoCode,
        promoDiscountCents,
        itemsTotalAfterDiscount: formatEuro(itemsTotalAfterDiscountCents),
        itemsTotalAfterDiscountCents,
        ht: formatEuro(htCents),
        vat: formatEuro(vatCents),
        total: formatEuro(totalCents),
        totalCents,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminUpdateOrderStatus(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { orderId } = req.params;
    const status = typeof req.body.status === 'string' ? req.body.status : '';

    if (!dbConnected) return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.redirect('/admin/commandes');

    const allowed = new Set(getOrderStatusOptions().map((o) => o.key));
    if (!allowed.has(status)) {
      return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    }

    const existing = await Order.findById(orderId)
      .select('_id number userId status consigne notifications')
      .lean();
    if (!existing) {
      if (wantsJsonResponse(req)) return res.status(400).json({ ok: false, error: 'Commande introuvable.' });
      req.session.adminOrderError = 'Commande introuvable.';
      return res.redirect('/admin/commandes');
    }

    if (existing.status !== status) {
      const changedBy = req.session && req.session.admin && req.session.admin.email
        ? String(req.session.admin.email)
        : 'admin';

      const setPatch = { status };
      if (status === 'livree') {
        const lines = existing && existing.consigne && Array.isArray(existing.consigne.lines)
          ? existing.consigne.lines
          : [];

        if (lines.length) {
          const now = new Date();
          const updatedLines = lines.map((l) => {
            if (!l) return l;
            if (l.receivedAt) return l;
            if (l.startAt && l.dueAt) return l;
            const delayDays = Number.isFinite(l.delayDays) ? Math.max(0, Math.floor(l.delayDays)) : 30;
            const dueAt = new Date(now);
            dueAt.setDate(dueAt.getDate() + delayDays);
            return {
              productId: l.productId,
              name: l.name,
              sku: l.sku || '',
              quantity: l.quantity,
              amountCents: l.amountCents,
              delayDays,
              startAt: now,
              dueAt,
              receivedAt: null,
            };
          });
          setPatch.consigne = { lines: updatedLines };
        }
      }

      await Order.findByIdAndUpdate(orderId, {
        $set: setPatch,
        $push: {
          statusHistory: {
            status,
            changedAt: new Date(),
            changedBy,
          },
        },
      });

      if (status === 'livree') {
        try {
          const refreshed = await Order.findById(orderId)
            .select('_id number userId consigne notifications')
            .lean();

          const alreadySent = refreshed
            && refreshed.notifications
            && refreshed.notifications.consigneStartSentAt;

          const linesAfter = refreshed && refreshed.consigne && Array.isArray(refreshed.consigne.lines)
            ? refreshed.consigne.lines
            : [];

          if (!alreadySent && linesAfter.length) {
            const user = refreshed && refreshed.userId
              ? await User.findById(refreshed.userId).select('_id email firstName').lean()
              : null;

            if (user && user.email) {
              const sent = await emailService.sendConsigneStartEmail({ order: refreshed, user });
              if (sent && sent.ok) {
                await Order.updateOne(
                  {
                    _id: refreshed._id,
                    $or: [
                      { 'notifications.consigneStartSentAt': { $exists: false } },
                      { 'notifications.consigneStartSentAt': null },
                    ],
                  },
                  { $set: { 'notifications.consigneStartSentAt': new Date() } }
                );
              }
            }
          }
        } catch (err) {
          console.error('Erreur email consigne début (admin) :', err && err.message ? err.message : err);
        }
      }
    }

    req.session.adminOrderSuccess = 'Statut mis à jour.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Statut mis à jour.', data: { id: orderId, status: status } });
    return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
  } catch (err) {
    return next(err);
  }
}

async function postAdminCreateReturnFromOrder(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { orderId } = req.params;

    if (!dbConnected) {
      req.session.adminOrderError = "La base de données n'est pas disponible.";
      return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.redirect('/admin/commandes');
    }

    const orderDoc = await Order.findById(orderId)
      .select('_id number userId accountType')
      .lean();
    if (!orderDoc) {
      req.session.adminOrderError = 'Commande introuvable.';
      return res.redirect('/admin/commandes');
    }

    const changedBy = req.session && req.session.admin && req.session.admin.email
      ? String(req.session.admin.email)
      : 'admin';

    const createdAt = new Date();
    let rr;
    for (let i = 0; i < 3; i += 1) {
      const number = `R${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      try {
        rr = await ReturnRequest.create({
          number,
          orderId: orderDoc._id,
          orderNumber: orderDoc.number,
          userId: orderDoc.userId,
          accountType: orderDoc.accountType,
          reason: '',
          message: '',
          status: 'en_attente',
          statusHistory: [{ status: 'en_attente', changedAt: createdAt, changedBy }],
          adminNote: '',
        });
        break;
      } catch (e) {
        if (!(e && e.code === 11000)) throw e;
      }
    }

    if (!rr) {
      req.session.adminOrderError = "Impossible de créer le retour pour le moment.";
      return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Retour créé.', data: { returnId: String(rr._id) } });
    return res.redirect(`/admin/retours/${encodeURIComponent(String(rr._id))}`);
  } catch (err) {
    return next(err);
  }
}

async function postAdminAddOrderShipment(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { orderId } = req.params;

    if (!dbConnected) return res.redirect('/admin/commandes');
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.redirect('/admin/commandes');

    const existing = await Order.findById(orderId)
      .select('_id number userId notifications')
      .lean();
    if (!existing) {
      req.session.adminOrderError = 'Commande introuvable.';
      return res.redirect('/admin/commandes');
    }

    const label = getTrimmedString(req.body.label);
    const carrier = getTrimmedString(req.body.carrier);
    const trackingNumber = getTrimmedString(req.body.trackingNumber);
    const note = getTrimmedString(req.body.note);

    if (!trackingNumber) {
      req.session.adminOrderError = 'Merci de renseigner un numéro de suivi.';
      return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    }

    const adminEmail = req.session && req.session.admin && req.session.admin.email
      ? String(req.session.admin.email)
      : 'admin';

    await Order.findByIdAndUpdate(orderId, {
      $push: {
        shipments: {
          label,
          carrier,
          trackingNumber,
          note,
          createdAt: new Date(),
          createdBy: adminEmail,
        },
      },
    });

    try {
      const alreadySent = existing
        && existing.notifications
        && Array.isArray(existing.notifications.shipmentTrackingNumbersSent)
        && existing.notifications.shipmentTrackingNumbersSent.includes(trackingNumber);

      if (!alreadySent && existing.userId) {
        const user = await User.findById(existing.userId).select('_id email firstName').lean();
        if (user && user.email) {
          const sent = await emailService.sendShipmentTrackingEmail({
            order: { _id: existing._id, number: existing.number },
            user,
            shipment: { label, carrier, trackingNumber },
          });

          if (sent && sent.ok) {
            await Order.updateOne(
              {
                _id: existing._id,
                $or: [
                  { 'notifications.shipmentTrackingNumbersSent': { $exists: false } },
                  { 'notifications.shipmentTrackingNumbersSent': { $ne: trackingNumber } },
                ],
              },
              {
                $set: { 'notifications.shipmentLastSentAt': new Date() },
                $addToSet: { 'notifications.shipmentTrackingNumbersSent': trackingNumber },
              }
            );
          }
        }
      }
    } catch (err) {
      console.error('Erreur email expédition (admin) :', err && err.message ? err.message : err);
    }

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
      try {
        await track17.registerTracking(track17ApiKey, trackingNumber);
      } catch (err) {
        console.warn('17Track: init tracking failed:', err && err.message ? err.message : err);
      }
    }

    req.session.adminOrderSuccess = 'Suivi ajouté.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Suivi ajouté.', data: { orderId } });
    return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
  } catch (err) {
    return next(err);
  }
}

async function postAdminDeleteOrderShipment(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { orderId, shipmentId } = req.params;

    if (!dbConnected) return res.redirect('/admin/commandes');
    if (!mongoose.Types.ObjectId.isValid(orderId)) return res.redirect('/admin/commandes');
    if (!mongoose.Types.ObjectId.isValid(shipmentId)) {
      return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    }

    const existing = await Order.findById(orderId).select('_id shipments').lean();
    if (!existing) {
      req.session.adminOrderError = 'Commande introuvable.';
      return res.redirect('/admin/commandes');
    }

    const hasShipment = Array.isArray(existing.shipments)
      ? existing.shipments.some((s) => s && String(s._id) === String(shipmentId))
      : false;

    if (!hasShipment) {
      req.session.adminOrderError = 'Suivi introuvable.';
      return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
    }

    await Order.findByIdAndUpdate(orderId, {
      $pull: {
        shipments: { _id: new mongoose.Types.ObjectId(shipmentId) },
      },
    });

    req.session.adminOrderSuccess = 'Suivi supprimé.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Suivi supprimé.', data: { orderId, shipmentId } });
    return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
  } catch (err) {
    return next(err);
  }
}

function formatEuro(totalCents) {
  if (!Number.isFinite(totalCents)) return '—';
  return `${(totalCents / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDateTimeFR(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const date = d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${date} • ${time}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildStockQuery(stockKey) {
  const key = typeof stockKey === 'string' ? stockKey.trim() : '';
  if (key === 'in') return { inStock: true };
  if (key === 'out') return { inStock: false };
  return {};
}

function buildSeoAssistantFormFromProduct(product) {
  const safeProduct = product || {};
  const galleryValue = Array.isArray(safeProduct.galleryUrls)
    ? safeProduct.galleryUrls.filter(Boolean).join('\n')
    : '';
  const faqsValue = Array.isArray(safeProduct.faqs)
    ? safeProduct.faqs
        .filter((f) => f && (f.question || f.answer))
        .map((f) => `${f.question || ''} | ${f.answer || ''}`.trim())
        .join('\n')
    : '';
  const compatibilityValue = Array.isArray(safeProduct.compatibility)
    ? safeProduct.compatibility
        .filter((c) => c && (c.make || c.model || c.years || c.engine))
        .map((c) => `${c.make || ''} | ${c.model || ''} | ${c.years || ''} | ${c.engine || ''}`.trim())
        .join('\n')
    : '';

  return {
    name: safeProduct.name || '',
    sku: safeProduct.sku || '',
    brand: safeProduct.brand || '',
    category: safeProduct.category || '',
    imageUrl: safeProduct.imageUrl || '',
    galleryUrls: galleryValue,
    shortDescription: safeProduct.shortDescription || '',
    description: safeProduct.description || '',
    faqs: faqsValue,
    compatibility: compatibilityValue,
    metaTitle: safeProduct.seo && safeProduct.seo.metaTitle ? safeProduct.seo.metaTitle : '',
    metaDescription: safeProduct.seo && safeProduct.seo.metaDescription ? safeProduct.seo.metaDescription : '',
  };
}

function computeCatalogSeoScore(product) {
  return buildProductSeoAssistant({
    form: buildSeoAssistantFormFromProduct(product),
    mode: 'catalog',
    productId: product && product._id ? String(product._id) : '',
  }).score;
}

function resolveAdminCatalogMongoSort(sortKey) {
  switch (sortKey) {
    case 'updated_asc':
      return { updatedAt: 1 };
    case 'category_asc':
      return { category: 1, name: 1 };
    case 'category_desc':
      return { category: -1, name: 1 };
    case 'name_asc':
      return { name: 1 };
    case 'name_desc':
      return { name: -1 };
    case 'price_asc':
      return { priceCents: 1 };
    case 'price_desc':
      return { priceCents: -1 };
    case 'stock_asc':
      return { stockQty: 1, name: 1 };
    case 'stock_desc':
      return { stockQty: -1, name: 1 };
    default:
      return { updatedAt: -1 };
  }
}

function parseStockQty(value) {
  if (typeof value !== 'string') {
    return { ok: true, qty: null };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, qty: null };
  }

  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { ok: false, qty: null };
  }
  if (num < 0) {
    return { ok: false, qty: null };
  }
  if (!Number.isInteger(num)) {
    return { ok: false, qty: null };
  }

  return { ok: true, qty: num };
}

function formatPriceForInput(priceCents) {
  if (!Number.isFinite(priceCents)) return '';
  return (priceCents / 100).toFixed(2).replace('.', ',');
}

function parsePriceToCents(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.');

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;

  return Math.round(num * 100);
}

function normalizePromoCode(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

function isValidPromoCode(value) {
  if (!value) return false;
  return /^[A-Z0-9_-]{3,30}$/.test(value);
}

function parsePercent(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const num = Number.parseFloat(trimmed);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return null;
  if (num > 90) return null;
  return Math.round(num * 100) / 100;
}

function parsePercentAllowZero(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return 0;
  const num = Number.parseFloat(trimmed);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  if (num > 90) return null;
  return Math.round(num * 100) / 100;
}

function parseOptionalInt(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function formatDateTimeLocal(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseDateTimeLocal(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;

  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);

  const d = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function getTrimmedString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function getRequiredProductContentError({ form, hasMainImage }) {
  const missing = [];

  if (!hasMainImage) missing.push('image principale');
  if (!getTrimmedString(form && form.specType)) missing.push('type');
  if (!getTrimmedString(form && form.specProgrammation)) missing.push('programmation');
  if (!getTrimmedString(form && form.badgeTopLeft)) missing.push('garantie');
  if (!getTrimmedString(form && form.badgeCondition)) missing.push('état');
  if (!getTrimmedString(form && form.shortDescription)) missing.push('résumé');
  if (!getTrimmedString(form && form.description)) missing.push('description');

  if (!missing.length) return null;

  return `Merci de renseigner les champs obligatoires des sections Médias et Description : ${missing.join(', ')}.`;
}

function formatOptionChoiceLines(choices) {
  return Array.isArray(choices)
    ? choices
        .filter((choice) => choice && choice.label)
        .map((choice) => {
          const label = getTrimmedString(choice.label);
          const price = Number.isFinite(choice.priceDeltaCents) ? choice.priceDeltaCents : 0;
          if (!label) return '';
          return price > 0 ? `${label} | ${formatPriceForInput(price)}` : label;
        })
        .filter(Boolean)
        .join('\n')
    : '';
}

function parseOptionChoiceLines(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const choices = [];
  for (const line of lines) {
    const parts = line.split('|');
    const label = getTrimmedString(parts[0]);
    const priceRaw = getTrimmedString(parts.slice(1).join('|'));
    if (!label) continue;

    let priceDeltaCents = 0;
    if (priceRaw) {
      const parsed = parsePriceToCents(priceRaw);
      if (parsed === null) {
        return { ok: false, error: `Choix invalide : ${label}` };
      }
      priceDeltaCents = parsed;
    }

    choices.push({ label, priceDeltaCents });
  }

  return { ok: true, choices };
}

function parseProductOptionTemplatePayload(body) {
  const name = getTrimmedString(body && body.name);
  const key = getTrimmedString(body && body.key);
  const type = getTrimmedString(body && body.type) === 'text' ? 'text' : 'choice';
  const required = body && (body.required === 'on' || body.required === 'true');
  const placeholder = getTrimmedString(body && body.placeholder);
  const helpText = getTrimmedString(body && body.helpText);
  const priceDelta = getTrimmedString(body && body.priceDelta);

  if (!name) {
    return { ok: false, error: 'Merci de renseigner le nom de l’option.' };
  }

  const priceDeltaCents = priceDelta ? parsePriceToCents(priceDelta) : 0;
  if (priceDelta && priceDeltaCents === null) {
    return { ok: false, error: 'Le supplément de prix est invalide.' };
  }

  const parsedChoices = parseOptionChoiceLines(body && body.choicesText);
  if (!parsedChoices.ok) {
    return parsedChoices;
  }

  if (type === 'choice' && !parsedChoices.choices.length) {
    return { ok: false, error: 'Ajoutez au moins un choix pour une option de type liste.' };
  }

  const normalized = productOptions.normalizeProductOptions([
    {
      key,
      label: name,
      type,
      required,
      placeholder,
      helpText,
      priceDeltaCents: type === 'text' ? (priceDeltaCents || 0) : 0,
      choices: type === 'choice' ? parsedChoices.choices : [],
    },
  ]);

  const option = normalized.length ? normalized[0] : null;
  if (!option) {
    return { ok: false, error: 'Impossible de préparer cette option.' };
  }

  return {
    ok: true,
    option,
    templateData: {
      name: option.label,
      key: option.key,
      type: option.type,
      required: option.required,
      placeholder: option.placeholder,
      helpText: option.helpText,
      priceDeltaCents: option.type === 'text' ? option.priceDeltaCents : 0,
      choices: option.type === 'choice' ? option.choices : [],
    },
  };
}

async function listProductOptionTemplates({ includeInactive = true } = {}) {
  const query = includeInactive ? {} : { isActive: true };
  const templates = await ProductOptionTemplate.find(query)
    .sort({ isActive: -1, sortOrder: 1, name: 1, createdAt: 1 })
    .lean();

  return templates.map((template) => ({
    id: String(template._id),
    name: getTrimmedString(template.name),
    key: getTrimmedString(template.key),
    type: getTrimmedString(template.type) === 'text' ? 'text' : 'choice',
    required: template.required === true,
    placeholder: getTrimmedString(template.placeholder),
    helpText: getTrimmedString(template.helpText),
    priceDeltaCents: Number.isFinite(template.priceDeltaCents) ? template.priceDeltaCents : 0,
    priceDeltaLabel: formatPriceForInput(Number.isFinite(template.priceDeltaCents) ? template.priceDeltaCents : 0),
    choices: Array.isArray(template.choices)
      ? template.choices.map((choice) => ({
          key: getTrimmedString(choice && choice.key),
          label: getTrimmedString(choice && choice.label),
          priceDeltaCents: Number.isFinite(choice && choice.priceDeltaCents) ? choice.priceDeltaCents : 0,
          priceDeltaLabel: formatPriceForInput(Number.isFinite(choice && choice.priceDeltaCents) ? choice.priceDeltaCents : 0),
        }))
      : [],
    choicesText: formatOptionChoiceLines(Array.isArray(template.choices) ? template.choices : []),
    isActive: template.isActive !== false,
    updatedAtLabel: formatDateTimeFR(template.updatedAt),
  }));
}

function extractProductOptionTemplateObjectIds(options) {
  return productOptions
    .extractOptionTemplateIds(options)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

function formatCompatibilityLines(items) {
  return Array.isArray(items)
    ? items
        .map((item) => {
          const make = getTrimmedString(item && item.make);
          const model = getTrimmedString(item && item.model);
          const years = getTrimmedString(item && item.years);
          const engine = getTrimmedString(item && item.engine);
          if (!make && !model && !years && !engine) return '';
          return `${make} | ${model} | ${years} | ${engine}`.trim();
        })
        .filter(Boolean)
        .join('\n')
    : '';
}

function formatFaqLines(items) {
  return Array.isArray(items)
    ? items
        .map((item) => {
          const question = getTrimmedString(item && item.question);
          const answer = getTrimmedString(item && item.answer);
          if (!question && !answer) return '';
          return `${question} | ${answer}`.trim();
        })
        .filter(Boolean)
        .join('\n')
    : '';
}

function formatStepLines(items) {
  return Array.isArray(items)
    ? items
        .map((item) => {
          const title = getTrimmedString(item && item.title);
          const description = getTrimmedString(item && item.description);
          if (!title && !description) return '';
          return `${title}: ${description}`.trim();
        })
        .filter(Boolean)
        .join('\n')
    : '';
}

function buildGeneratedProductDraftResponse(draft) {
  const safeDraft = draft && typeof draft === 'object' ? draft : {};
  const options = Array.isArray(safeDraft.options) ? safeDraft.options : [];
  return {
    name: getTrimmedString(safeDraft.name),
    slug: getTrimmedString(safeDraft.slug),
    brand: getTrimmedString(safeDraft.brand),
    category: getTrimmedString(safeDraft.category),
    shippingDelayText: getTrimmedString(safeDraft.shippingDelayText),
    specType: getTrimmedString(safeDraft.specType),
    specProgrammation: getTrimmedString(safeDraft.specProgrammation),
    badgeTopLeft: getTrimmedString(safeDraft.badgeTopLeft),
    badgeCondition: getTrimmedString(safeDraft.badgeCondition),
    shortDescription: getTrimmedString(safeDraft.shortDescription),
    description: getTrimmedString(safeDraft.description),
    compatibleReferences: Array.isArray(safeDraft.compatibleReferences)
      ? safeDraft.compatibleReferences.filter(Boolean).join('\n')
      : '',
    compatibility: formatCompatibilityLines(safeDraft.compatibility),
    faqs: formatFaqLines(safeDraft.faqs),
    reconditioningSteps: formatStepLines(safeDraft.reconditioningSteps),
    optionsJson: options.length ? JSON.stringify(options, null, 2) : '',
    metaTitle: getTrimmedString(safeDraft.metaTitle),
    metaDescription: getTrimmedString(safeDraft.metaDescription),
    warnings: Array.isArray(safeDraft.warnings) ? safeDraft.warnings.filter(Boolean) : [],
  };
}

function normalizeMetaText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function truncateText(value, max) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return '';
  if (!Number.isFinite(max) || max <= 0) return input;
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function stripMarkdown(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+[).]\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function countWords(value) {
  const plain = stripMarkdown(stripHtml(value));
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

function buildProductSeoAssistant({ form, mode, productId } = {}) {
  const siteName = 'CarParts France';
  const baseUrl = getSiteUrlFromEnv();

  const name = getTrimmedString(form && form.name);
  const brand = getTrimmedString(form && form.brand);
  const sku = getTrimmedString(form && form.sku);
  const category = getTrimmedString(form && form.category);

  const metaTitle = normalizeMetaText(getTrimmedString(form && form.metaTitle));
  const metaDescription = normalizeMetaText(getTrimmedString(form && form.metaDescription));

  const imageUrl = getTrimmedString(form && form.imageUrl);
  const galleryUrlsText = typeof (form && form.galleryUrls) === 'string' ? form.galleryUrls : '';
  const galleryCount = parseLinesToArray(galleryUrlsText).length + (imageUrl ? 1 : 0);

  const shortDescription = getTrimmedString(form && form.shortDescription);
  const description = getTrimmedString(form && form.description);
  const contentText = shortDescription || description;
  const words = countWords(description || shortDescription);

  const faqsText = typeof (form && form.faqs) === 'string' ? form.faqs : '';
  const faqCount = parseLinesToArray(faqsText)
    .filter((l) => l.includes('|'))
    .length;

  const compatibilityText = typeof (form && form.compatibility) === 'string' ? form.compatibility : '';
  const compatCount = parseLinesToArray(compatibilityText)
    .filter((l) => l.includes('|'))
    .length;

  const slugInput = getTrimmedString(form && form.slug);
  const urlStubSlug = slugify(slugInput || name) || 'produit';
  const urlPath = `/product/${encodeURIComponent(urlStubSlug)}/`;
  const url = baseUrl ? `${baseUrl}${urlPath}` : urlPath;

  const autoTitle = `${name || siteName}${brand ? ` - ${brand}` : ''}${sku ? ` (Réf ${sku})` : ''} | ${siteName}`.trim();
  const finalTitle = metaTitle || autoTitle;

  const fallbackDesc = truncateText(stripMarkdown(stripHtml(contentText)), 160);
  const finalDescription = metaDescription || fallbackDesc;

  const metaTitleLen = finalTitle.length;
  const metaDescLen = finalDescription.length;

  const hasRef = Boolean(sku) || /\b[A-Z0-9]{5,}\b/.test(String(name || ''));

  const checks = [];
  checks.push({
    key: 'name',
    label: 'Nom du produit',
    ok: Boolean(name),
    detail: name ? '' : 'Ajoutez un nom clair (idéalement avec la référence OEM).',
    weight: 20,
  });
  checks.push({
    key: 'brand',
    label: 'Marque',
    ok: Boolean(brand),
    detail: brand ? '' : 'Ajoutez la marque (Volkswagen, Audi…).',
    weight: 5,
  });
  checks.push({
    key: 'category',
    label: 'Catégorie',
    ok: Boolean(category),
    detail: category ? '' : 'Choisissez une catégorie.',
    weight: 5,
  });
  checks.push({
    key: 'ref',
    label: 'Référence (SKU / OEM) présente',
    ok: hasRef,
    detail: hasRef ? '' : 'Ajoutez un SKU ou une référence OEM dans le nom.',
    weight: 8,
  });
  checks.push({
    key: 'metaTitle',
    label: 'Meta title (50–60 caractères)',
    ok: metaTitleLen >= 45 && metaTitleLen <= 65,
    detail: metaTitle ? `Longueur actuelle : ${metaTitleLen}` : `Auto : ${metaTitleLen} (vous pouvez optimiser)`,
    weight: 10,
  });
  checks.push({
    key: 'metaDescription',
    label: 'Meta description (120–160 caractères)',
    ok: metaDescLen >= 110 && metaDescLen <= 170,
    detail: metaDescription ? `Longueur actuelle : ${metaDescLen}` : `Auto : ${metaDescLen} (vous pouvez optimiser)`,
    weight: 10,
  });
  checks.push({
    key: 'image',
    label: 'Image principale',
    ok: Boolean(imageUrl),
    detail: imageUrl ? '' : 'Ajoutez une image principale (important pour le clic).',
    weight: 10,
  });
  checks.push({
    key: 'gallery',
    label: 'Plusieurs images (2+)',
    ok: galleryCount >= 2,
    detail: `Images détectées : ${galleryCount}`,
    weight: 4,
  });
  checks.push({
    key: 'content',
    label: 'Description suffisante (200+ mots)',
    ok: words >= 200,
    detail: `Mots : ${words}`,
    weight: 12,
  });
  checks.push({
    key: 'faq',
    label: 'FAQ (4+ questions)',
    ok: faqCount >= 4,
    detail: `FAQ : ${faqCount}`,
    weight: 10,
  });
  checks.push({
    key: 'compat',
    label: 'Compatibilité (3+ lignes)',
    ok: compatCount >= 3,
    detail: `Compatibilités : ${compatCount}`,
    weight: 8,
  });

  let score = 100;
  for (const c of checks) {
    if (!c.ok) score -= (Number.isFinite(c.weight) ? c.weight : 10);
  }
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return {
    mode,
    score,
    preview: {
      title: finalTitle,
      url,
      description: finalDescription,
    },
    computed: {
      baseUrl,
      urlPath,
      metaTitle: finalTitle,
      metaDescription: finalDescription,
    },
    checks,
  };
}

function parseLinesToArray(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getAdminUserIdFromRequest(req) {
  const value = req && req.session && req.session.admin && typeof req.session.admin.adminUserId === 'string'
    ? req.session.admin.adminUserId.trim()
    : '';
  return value && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function wantsJsonResponse(req) {
  const a = req && req.headers && typeof req.headers.accept === 'string' ? req.headers.accept : '';
  return a.includes('application/json');
}

function getSafeAdminReturnTo(value, fallback = '/admin/catalogue') {
  const raw = typeof value === 'string' ? value : '';
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (!trimmed.startsWith('/admin')) return fallback;
  if (trimmed.startsWith('//')) return fallback;
  return trimmed;
}

function parseAdminSelectedIds(rawIds) {
  const ids = Array.isArray(rawIds)
    ? rawIds
    : typeof rawIds === 'string'
      ? [rawIds]
      : [];

  return Array.from(
    new Set(
      ids
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
    )
  );
}

function buildProductDraftPayloadFromProduct(product, { sourceNotes = '', profile = '' } = {}) {
  const compatibleReferences = Array.isArray(product && product.compatibleReferences)
    ? Array.from(
        new Set(
          product.compatibleReferences
            .map((value) => getTrimmedString(value))
            .filter(Boolean)
        )
      )
    : [];

  return {
    name: getTrimmedString(product && product.name),
    sku: getTrimmedString(product && product.sku),
    brand: getTrimmedString(product && product.brand),
    category: getTrimmedString(product && product.category),
    compatibleReferences,
    sourceNotes: getTrimmedString(sourceNotes),
    profile: getTrimmedString(profile),
  };
}

function hasProductDraftPayloadContent(payload) {
  return Boolean(
    getTrimmedString(payload && payload.name)
    || getTrimmedString(payload && payload.sku)
    || getTrimmedString(payload && payload.sourceNotes)
    || (Array.isArray(payload && payload.compatibleReferences) && payload.compatibleReferences.length)
  );
}

function buildProductDraftJobView(job, { includeDraft = false } = {}) {
  if (!job) return null;

  const hasDraft = job.hasDraft === true || Boolean(job.resultDraft);
  const requestedProfile = getTrimmedString(job && job.profile ? job.profile : (job.requestPayload && job.requestPayload.profile));
  const profileScope = requestedProfile.startsWith('batch_') ? 'batch' : 'single';
  const normalizedProfile = requestedProfile
    ? openaiProductGenerator.normalizeAiGenerationProfile(requestedProfile, { scope: profileScope })
    : '';
  const profileMeta = normalizedProfile
    ? openaiProductGenerator.getAiGenerationProfileMeta(normalizedProfile, { scope: profileScope })
    : null;

  return {
    jobId: String(job._id || job.jobId || ''),
    status: getTrimmedString(job.status),
    model: getTrimmedString(job.model),
    profile: profileMeta ? profileMeta.key : '',
    profileLabel: profileMeta ? profileMeta.label : '',
    errorMessage: getTrimmedString(job.errorMessage || job.error),
    createdAtLabel: job.createdAt ? formatDateTimeFR(job.createdAt) : '',
    completedAtLabel: job.completedAt ? formatDateTimeFR(job.completedAt) : '',
    hasDraft,
    draft: includeDraft && hasDraft ? buildGeneratedProductDraftResponse(job.resultDraft) : null,
  };
}

function scheduleProductDraftQueue() {
  if (productDraftQueueScheduled) return;
  productDraftQueueScheduled = true;

  setImmediate(() => {
    productDraftQueueScheduled = false;
    processProductDraftQueue().catch(() => {});
  });
}

async function claimProductDraftGenerationJob(jobId) {
  const startedAt = new Date();
  const filter = { status: 'queued' };
  if (jobId && mongoose.Types.ObjectId.isValid(jobId)) {
    filter._id = new mongoose.Types.ObjectId(jobId);
  }

  return ProductDraftGeneration.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'processing',
        startedAt,
        completedAt: null,
        errorMessage: '',
      },
    },
    {
      new: true,
      sort: { createdAt: 1 },
    }
  );
}

async function processProductDraftQueue() {
  while (activeProductDraftQueueWorkers < PRODUCT_DRAFT_QUEUE_CONCURRENCY) {
    const claimedJob = await claimProductDraftGenerationJob();
    if (!claimedJob) return;

    activeProductDraftQueueWorkers += 1;

    runProductDraftGenerationJob(claimedJob)
      .catch(() => {})
      .finally(() => {
        activeProductDraftQueueWorkers = Math.max(0, activeProductDraftQueueWorkers - 1);
        scheduleProductDraftQueue();
      });
  }
}

async function runProductDraftGenerationJob(jobOrId) {
  const job = jobOrId && typeof jobOrId === 'object' && jobOrId.requestPayload
    ? jobOrId
    : await claimProductDraftGenerationJob(typeof jobOrId === 'string' ? jobOrId : '');

  if (!job) return;

  const jobId = String(job._id);
  const abortController = new AbortController();
  activeProductDraftAbortControllers.set(jobId, abortController);

  try {
    const requestedProfile = getTrimmedString(job && job.requestPayload && job.requestPayload.profile);
    const profileScope = requestedProfile.startsWith('batch_') ? 'batch' : 'single';
    const normalizedProfile = openaiProductGenerator.normalizeAiGenerationProfile(requestedProfile, { scope: profileScope });
    const generated = await openaiProductGenerator.generateProductSheet(job.requestPayload || {}, {
      profile: normalizedProfile,
      scope: profileScope,
      abortSignal: abortController.signal,
    });
    await ProductDraftGeneration.updateOne(
      { _id: job._id, status: 'processing' },
      {
        $set: {
          status: 'completed',
          model: generated && generated.model ? String(generated.model) : '',
          resultDraft: generated && generated.draft ? generated.draft : null,
          errorMessage: '',
          completedAt: new Date(),
        },
      }
    );
  } catch (err) {
    const isCanceled = err && err.code === 'OPENAI_ABORTED';
    await ProductDraftGeneration.updateOne(
      { _id: job._id, status: 'processing' },
      {
        $set: {
          status: isCanceled ? 'canceled' : 'failed',
          errorMessage: isCanceled
            ? 'Génération IA arrêtée à la demande.'
            : (err && err.message ? String(err.message) : 'Erreur pendant la génération IA.'),
          completedAt: new Date(),
        },
      }
    );
  } finally {
    activeProductDraftAbortControllers.delete(jobId);
  }
}

async function postAdminGenerateProductDraft(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      return res.status(503).json({
        ok: false,
        error: 'La base de données n’est pas disponible. Réessayez dans quelques instants.',
      });
    }

    const rate = consumeRateLimit(ADMIN_AI_PRODUCT_BUCKETS, getClientIp(req), {
      limit: ADMIN_AI_PRODUCT_LIMIT,
      windowMs: ADMIN_AI_PRODUCT_WINDOW_MS,
      units: 1,
    });

    if (rate.limited) {
      return res.status(429).json({
        ok: false,
        error: 'Trop de demandes IA en peu de temps. Merci de patienter quelques minutes puis de réessayer.',
      });
    }

    const aiProfile = openaiProductGenerator.normalizeAiGenerationProfile(req.body && req.body.aiProfile, { scope: 'single' });
    const aiProfileMeta = openaiProductGenerator.getAiGenerationProfileMeta(aiProfile, { scope: 'single' });

    const payload = {
      name: getTrimmedString(req.body && req.body.name),
      sku: getTrimmedString(req.body && req.body.sku),
      brand: getTrimmedString(req.body && req.body.brand),
      category: getTrimmedString(req.body && req.body.category),
      compatibleReferences: parseLinesToArray(getTrimmedString(req.body && req.body.compatibleReferences)),
      sourceNotes: getTrimmedString(req.body && req.body.sourceNotes),
      profile: aiProfile,
    };
    const productId = req.body && typeof req.body.productId === 'string' && mongoose.Types.ObjectId.isValid(req.body.productId)
      ? new mongoose.Types.ObjectId(req.body.productId)
      : null;
    const adminUserId = getAdminUserIdFromRequest(req);

    if (!payload.name && !payload.sku && !payload.compatibleReferences.length && !payload.sourceNotes) {
      return res.status(400).json({
        ok: false,
        error: 'Renseignez au moins un nom de produit, une référence ou quelques notes avant de lancer l’IA.',
      });
    }

    if (productId) {
      const activeFilter = {
        productId,
        status: { $in: ['queued', 'processing'] },
        adminUserId: adminUserId || null,
      };
      const existingActiveJob = await ProductDraftGeneration.findOne(activeFilter)
        .sort({ createdAt: -1 })
        .lean();

      if (existingActiveJob) {
        const existingProfile = openaiProductGenerator.normalizeAiGenerationProfile(
          existingActiveJob && existingActiveJob.requestPayload ? existingActiveJob.requestPayload.profile : '',
          { scope: 'single' }
        );

        if (existingProfile && existingProfile !== aiProfile) {
          const existingProfileMeta = openaiProductGenerator.getAiGenerationProfileMeta(existingProfile, { scope: 'single' });
          return res.status(409).json({
            ok: false,
            error: `Une génération IA est déjà en cours pour cette fiche en mode ${existingProfileMeta.label}. Merci d’attendre sa fin avant d’en lancer une autre avec un mode différent.`,
          });
        }

        return res.status(202).json({
          ok: true,
          jobId: String(existingActiveJob._id),
          status: existingActiveJob.status,
          profile: existingProfile || aiProfile,
        });
      }
    }

    const job = await ProductDraftGeneration.create({
      productId,
      adminUserId,
      status: 'queued',
      requestPayload: payload,
    });

    scheduleProductDraftQueue();

    return res.status(202).json({
      ok: true,
      jobId: String(job._id),
      status: 'queued',
      profile: aiProfile,
      profileLabel: aiProfileMeta.label,
    });
  } catch (err) {
    if (err && err.code === 'OPENAI_API_KEY_MISSING') {
      return res.status(400).json({
        ok: false,
        error: 'La clé OPENAI_API_KEY est absente dans l’environnement du projet.',
      });
    }

    if (err && (err.code === 'OPENAI_API_ERROR' || err.code === 'OPENAI_INVALID_RESPONSE')) {
      return res.status(502).json({
        ok: false,
        error: err.message || 'Erreur lors de la génération IA.',
      });
    }

    if (err && err.code === 'OPENAI_NETWORK_ERROR') {
      return res.status(502).json({
        ok: false,
        error: err.message || 'Impossible de contacter OpenAI depuis le serveur.',
      });
    }

    return next(err);
  }
}

function parseObjectIdListFromLines(value) {
  const lines = parseLinesToArray(value);
  const ids = [];
  for (const line of lines) {
    if (mongoose.Types.ObjectId.isValid(line)) {
      ids.push(new mongoose.Types.ObjectId(line));
    }
  }
  return ids;
}

function parsePairsFromLines(value) {
  const lines = parseLinesToArray(value);
  const pairs = [];

  for (const line of lines) {
    const sepIndex =
      line.indexOf(':') >= 0
        ? line.indexOf(':')
        : line.indexOf('=') >= 0
          ? line.indexOf('=')
          : line.indexOf('|');

    if (sepIndex <= 0) continue;

    const label = line.slice(0, sepIndex).trim();
    const rawValue = line.slice(sepIndex + 1).trim();
    if (!label || !rawValue) continue;

    pairs.push({ label, value: rawValue });
  }

  return pairs;
}

function upsertSpecPair(specs, key, displayLabel, value) {
  if (!Array.isArray(specs)) return;

  const target = String(key || '').trim().toLowerCase();
  if (!target) return;

  const v = typeof value === 'string' ? value.trim() : '';
  const idx = specs.findIndex((p) => p && p.label && String(p.label).trim().toLowerCase() === target);

  if (!v) {
    if (idx >= 0) specs.splice(idx, 1);
    return;
  }

  if (idx >= 0) specs[idx].value = v;
  else specs.push({ label: displayLabel, value: v });
}

function parseStepsFromLines(value) {
  const lines = parseLinesToArray(value);
  const steps = [];

  for (const line of lines) {
    const sepIndex = line.indexOf(':') >= 0 ? line.indexOf(':') : line.indexOf('|');
    if (sepIndex <= 0) continue;

    const title = line.slice(0, sepIndex).trim();
    const description = line.slice(sepIndex + 1).trim();
    if (!title || !description) continue;

    steps.push({ title, description });
  }

  return steps;
}

function splitParts(line) {
  if (line.includes('|')) return line.split('|').map((p) => p.trim());
  if (line.includes(';')) return line.split(';').map((p) => p.trim());
  return line.split(',').map((p) => p.trim());
}

function parseCompatibilityFromLines(value) {
  const lines = parseLinesToArray(value);
  const items = [];

  for (const line of lines) {
    const parts = splitParts(line);
    const make = (parts[0] || '').trim();
    const model = (parts[1] || '').trim();
    const years = (parts[2] || '').trim();
    const engine = (parts[3] || '').trim();

    if (!make && !model && !years && !engine) continue;

    items.push({ make, model, years, engine });
  }

  return items;
}

function parseFaqsFromLines(value) {
  const lines = parseLinesToArray(value);
  const items = [];

  for (const line of lines) {
    const sepIndex = line.indexOf('|') >= 0 ? line.indexOf('|') : line.indexOf(':');
    if (sepIndex <= 0) continue;

    const question = line.slice(0, sepIndex).trim();
    const answer = line.slice(sepIndex + 1).trim();
    if (!question || !answer) continue;

    items.push({ question, answer });
  }

  return items;
}

async function getCompatibilityIndex() {
  const byMake = new Map();

  const makeDocs = await VehicleMake.find({})
    .select('_id name models')
    .sort({ nameLower: 1 })
    .limit(2000)
    .lean();

  for (const m of makeDocs) {
    const make = m && m.name ? String(m.name).trim() : '';
    if (!make) continue;
    if (!byMake.has(make)) byMake.set(make, new Set());
    const models = m && Array.isArray(m.models) ? m.models : [];
    for (const mod of models) {
      const model = mod && mod.name ? String(mod.name).trim() : '';
      if (model) byMake.get(make).add(model);
    }
  }

  const docs = await Product.find({ compatibility: { $exists: true, $ne: [] } })
    .select('compatibility.make compatibility.model')
    .limit(2000)
    .lean();

  for (const d of docs) {
    const list = d && Array.isArray(d.compatibility) ? d.compatibility : [];
    for (const it of list) {
      const make = it && it.make ? String(it.make).trim() : '';
      const model = it && it.model ? String(it.model).trim() : '';
      if (!make) continue;
      if (!byMake.has(make)) byMake.set(make, new Set());
      if (model) byMake.get(make).add(model);
    }
  }

  const makes = Array.from(byMake.keys()).sort((a, b) => String(a).localeCompare(String(b), 'fr'));
  const modelsByMake = {};
  for (const make of makes) {
    const models = byMake.get(make) ? Array.from(byMake.get(make)) : [];
    modelsByMake[make] = models.sort((a, b) => String(a).localeCompare(String(b), 'fr'));
  }

  return { makes, modelsByMake };
}

function normalizeVehicleName(value) {
  const name = getTrimmedString(value);
  return {
    name,
    nameLower: name ? name.trim().toLowerCase() : '',
  };
}

function cleanupVehicleModelName(value) {
  let s = typeof value === 'string' ? value : '';
  s = s.trim();
  if (!s) return '';

  s = s.replace(/\(\s*((?:19|20)\d{2})(?:\s*[-–\/\s]+\s*((?:19|20)\d{2}))?\s*\)\s*$/g, '').trim();
  s = s.replace(/(?:^|\s)((?:19|20)\d{2})(?:\s*[-–\/\s]+\s*((?:19|20)\d{2}))?\s*$/g, '').trim();
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/[-–\/\s]+$/g, '').trim();

  return s;
}

function getAdminVehiclesReturnTo(req) {
  const raw = req && req.body && typeof req.body.returnTo === 'string' ? req.body.returnTo : '';
  const value = raw.trim();
  if (value && value.startsWith('/admin/vehicules')) return value;
  return '/admin/vehicules';
}

async function seedVehicleMakesIfEmpty() {
  const existingCount = await VehicleMake.countDocuments({});
  if (existingCount > 0) return;

  const defaults = [
    'Audi',
    'BMW',
    'Citroën',
    'Dacia',
    'Fiat',
    'Ford',
    'Hyundai',
    'Kia',
    'Mercedes',
    'Nissan',
    'Opel',
    'Peugeot',
    'Renault',
    'Seat',
    'Skoda',
    'Toyota',
    'Volkswagen',
    'Volvo',
  ];

  await VehicleMake.insertMany(
    defaults.map((name) => {
      const n = normalizeVehicleName(name);
      return { name: n.name, nameLower: n.nameLower, models: [] };
    })
  );
}

async function getAdminVehicleMakesPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    if (!dbConnected) {
      return res.status(503).render('admin/vehicle-makes', {
        title: 'Admin - Marques & modèles',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible.",
        selectedMakeId: '',
        makes: [],
      });
    }

    const errorMessage = req.session.adminVehicleMakeError || null;
    delete req.session.adminVehicleMakeError;

    await seedVehicleMakesIfEmpty();

    const makes = await VehicleMake.find({})
      .sort({ nameLower: 1 })
      .limit(2000)
      .lean();

    const requestedMakeId =
      req && req.query && typeof req.query.makeId === 'string' ? req.query.makeId.trim() : '';

    const mappedMakes = makes.map((m) => ({
      id: String(m._id),
      name: m.name || '',
      models: Array.isArray(m.models)
        ? m.models.filter((x) => x && x.name).map((x) => ({ id: String(x._id), name: x.name }))
        : [],
    }));

    const selectedMakeId =
      requestedMakeId &&
      mongoose.Types.ObjectId.isValid(requestedMakeId) &&
      mappedMakes.some((m) => m && m.id === requestedMakeId)
        ? requestedMakeId
        : mappedMakes[0]
          ? mappedMakes[0].id
          : '';

    return res.render('admin/vehicle-makes', {
      title: 'Admin - Marques & modèles',
      dbConnected,
      errorMessage,
      selectedMakeId,
      makes: mappedMakes,
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminCreateVehicleMake(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.redirect('/admin/vehicules');

    const normalized = normalizeVehicleName(req.body.name);
    if (!normalized.name) {
      req.session.adminVehicleMakeError = 'Merci de renseigner un nom de marque.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }

    await VehicleMake.create({
      name: normalized.name,
      nameLower: normalized.nameLower,
      models: [],
    });

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Marque créée.' });
    return res.redirect(getAdminVehiclesReturnTo(req));
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminVehicleMakeError = 'Cette marque existe déjà.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }
    return next(err);
  }
}

async function postAdminUpdateVehicleMake(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.redirect('/admin/vehicules');

    const { makeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(makeId)) return res.redirect('/admin/vehicules');

    const normalized = normalizeVehicleName(req.body.name);
    if (!normalized.name) {
      req.session.adminVehicleMakeError = 'Nom de marque invalide.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }

    await VehicleMake.findByIdAndUpdate(makeId, {
      $set: { name: normalized.name, nameLower: normalized.nameLower },
    });

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Marque mise à jour.' });
    return res.redirect(getAdminVehiclesReturnTo(req));
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminVehicleMakeError = 'Cette marque existe déjà.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }
    return next(err);
  }
}

async function postAdminDeleteVehicleMake(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.redirect('/admin/vehicules');

    const { makeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(makeId)) return res.redirect('/admin/vehicules');

    await VehicleMake.findByIdAndDelete(makeId);
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Marque supprimée.', data: { deletedIds: [makeId] } });
    return res.redirect(getAdminVehiclesReturnTo(req));
  } catch (err) {
    return next(err);
  }
}

async function postAdminAddVehicleModel(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.redirect('/admin/vehicules');

    const { makeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(makeId)) return res.redirect('/admin/vehicules');

    const normalized = normalizeVehicleName(cleanupVehicleModelName(req.body.modelName));
    if (!normalized.name) {
      req.session.adminVehicleMakeError = 'Merci de renseigner un nom de modèle.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }

    const make = await VehicleMake.findById(makeId);
    if (!make) return res.redirect('/admin/vehicules');

    const exists = Array.isArray(make.models)
      ? make.models.some((m) => m && m.nameLower === normalized.nameLower)
      : false;
    if (exists) {
      req.session.adminVehicleMakeError = 'Ce modèle existe déjà pour cette marque.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }

    make.models.push({ name: normalized.name, nameLower: normalized.nameLower });
    await make.save();
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Modèle ajouté.' });
    return res.redirect(getAdminVehiclesReturnTo(req));
  } catch (err) {
    return next(err);
  }
}

async function postAdminUpdateVehicleModel(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.redirect('/admin/vehicules');

    const { makeId, modelId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(makeId)) return res.redirect('/admin/vehicules');
    if (!mongoose.Types.ObjectId.isValid(modelId)) return res.redirect(getAdminVehiclesReturnTo(req));

    const normalized = normalizeVehicleName(cleanupVehicleModelName(req.body.modelName));
    if (!normalized.name) {
      req.session.adminVehicleMakeError = 'Nom de modèle invalide.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }

    const make = await VehicleMake.findById(makeId);
    if (!make) return res.redirect('/admin/vehicules');

    const models = Array.isArray(make.models) ? make.models : [];
    const idx = models.findIndex((m) => m && String(m._id) === String(modelId));
    if (idx < 0) return res.redirect(getAdminVehiclesReturnTo(req));

    const exists = models.some(
      (m, i) => i !== idx && m && m.nameLower === normalized.nameLower
    );
    if (exists) {
      req.session.adminVehicleMakeError = 'Ce modèle existe déjà pour cette marque.';
      return res.redirect(getAdminVehiclesReturnTo(req));
    }

    make.models[idx].name = normalized.name;
    make.models[idx].nameLower = normalized.nameLower;
    await make.save();

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Modèle mis à jour.' });
    return res.redirect(getAdminVehiclesReturnTo(req));
  } catch (err) {
    return next(err);
  }
}

async function postAdminDeleteVehicleModel(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.redirect('/admin/vehicules');

    const { makeId, modelId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(makeId)) return res.redirect('/admin/vehicules');
    if (!mongoose.Types.ObjectId.isValid(modelId)) return res.redirect(getAdminVehiclesReturnTo(req));

    const make = await VehicleMake.findById(makeId);
    if (!make) return res.redirect('/admin/vehicules');

    const before = Array.isArray(make.models) ? make.models.length : 0;
    make.models = Array.isArray(make.models)
      ? make.models.filter((m) => m && String(m._id) !== String(modelId))
      : [];

    if ((Array.isArray(make.models) ? make.models.length : 0) !== before) {
      await make.save();
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Modèle supprimé.', data: { deletedIds: [modelId] } });
    return res.redirect(getAdminVehiclesReturnTo(req));
  } catch (err) {
    return next(err);
  }
}

async function getAdminCatalogPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    scheduleProductDraftQueue();

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const stock = typeof req.query.stock === 'string' ? req.query.stock.trim() : '';
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';
    const allowedSortKeys = new Set(['updated_desc', 'updated_asc', 'category_asc', 'category_desc', 'seo_desc', 'seo_asc', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'stock_asc', 'stock_desc']);
    const sortKey = allowedSortKeys.has(sortRaw) ? sortRaw : 'updated_desc';
    const requiresMemorySort = sortKey === 'seo_desc' || sortKey === 'seo_asc';

    const pageRaw = typeof req.query.page === 'string' ? req.query.page.trim() : '';
    const requestedPage = Math.max(1, Number.parseInt(pageRaw || '1', 10) || 1);
    const limitRaw = typeof req.query.limit === 'string' ? req.query.limit.trim() : '';
    const requestedLimit = Math.max(1, Number.parseInt(limitRaw || '20', 10) || 20);
    const allowedLimits = new Set([20, 50, 100, 200]);
    const perPage = allowedLimits.has(requestedLimit) ? requestedLimit : 20;

    if (!dbConnected) {
      return res.render('admin/catalog', {
        title: 'Admin - Catalogue',
        dbConnected,
        products: [],
        filters: { q, stock, sort: sortKey },
        successMessage: null,
        errorMessage: "La base de données n'est pas disponible.",
        activeAiDraftJobsCount: 0,
        pagination: {
          page: 1,
          perPage,
          totalItems: 0,
          totalPages: 1,
          from: 0,
          to: 0,
          hasPrev: false,
          hasNext: false,
          prevPage: 1,
          nextPage: 1,
        },
        ...buildAiProfileViewData(),
      });
    }

    const successMessage = req.session.adminCatalogSuccess || null;
    const errorMessage = req.session.adminCatalogError || null;
    delete req.session.adminCatalogSuccess;
    delete req.session.adminCatalogError;

    const productQuery = {};

    Object.assign(productQuery, buildStockQuery(stock));

    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      productQuery.$or = [
        { name: rx },
        { sku: rx },
        { brand: rx },
        { category: rx },
        { slug: rx },
        { 'seo.metaTitle': rx },
        { 'seo.metaDescription': rx },
        { 'compatibility.make': rx },
        { 'compatibility.model': rx },
        { 'compatibility.years': rx },
        { 'compatibility.engine': rx },
        { 'faqs.question': rx },
        { 'faqs.answer': rx },
      ];
    }

    const totalItems = await Product.countDocuments(productQuery);
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const page = Math.min(requestedPage, totalPages);
    const skip = (page - 1) * perPage;
    const adminUserId = getAdminUserIdFromRequest(req);
    const activeAiDraftJobsCount = await ProductDraftGeneration.countDocuments({
      adminUserId: adminUserId || null,
      status: { $in: ['queued', 'processing'] },
    });

    const seoScoresByProductId = new Map();
    let products;

    if (requiresMemorySort) {
      const rawProducts = await Product.find(productQuery)
        .sort({ updatedAt: -1 })
        .lean();

      rawProducts.forEach((product) => {
        const score = computeCatalogSeoScore(product);
        seoScoresByProductId.set(String(product._id), score);
      });

      rawProducts.sort((a, b) => {
        const scoreA = seoScoresByProductId.get(String(a._id)) || 0;
        const scoreB = seoScoresByProductId.get(String(b._id)) || 0;
        if (scoreA !== scoreB) {
          return sortKey === 'seo_desc' ? scoreB - scoreA : scoreA - scoreB;
        }
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      });

      products = rawProducts.slice(skip, skip + perPage);
    } else {
      const mongoSort = resolveAdminCatalogMongoSort(sortKey);
      products = await Product.find(productQuery)
        .sort(mongoSort)
        .skip(skip)
        .limit(perPage)
        .lean();
    }

    const productObjectIds = products
      .map((p) => (p && p._id ? p._id : null))
      .filter(Boolean);
    const latestJobsByProductId = new Map();

    if (productObjectIds.length) {
      const latestJobs = await ProductDraftGeneration.aggregate([
        {
          $match: {
            productId: { $in: productObjectIds },
            adminUserId: adminUserId || null,
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$productId',
            jobId: { $first: '$_id' },
            status: { $first: '$status' },
            model: { $first: '$model' },
            profile: { $first: '$requestPayload.profile' },
            errorMessage: { $first: '$errorMessage' },
            createdAt: { $first: '$createdAt' },
            completedAt: { $first: '$completedAt' },
            hasDraft: {
              $first: {
                $cond: [
                  { $ifNull: ['$resultDraft', false] },
                  true,
                  false
                ]
              }
            },
          },
        },
      ]);

      for (const job of latestJobs) {
        latestJobsByProductId.set(String(job._id), buildProductDraftJobView(job));
      }
    }

    const viewProducts = products.map((p) => ({
      seoScore: seoScoresByProductId.has(String(p._id))
        ? seoScoresByProductId.get(String(p._id))
        : computeCatalogSeoScore(p),
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      category: p.category,
      brand: p.brand,
      price: formatEuro(p.priceCents),
      inStock: p.inStock,
      stockQty: Number.isFinite(p.stockQty) ? p.stockQty : null,
      aiDraft: latestJobsByProductId.get(String(p._id)) || null,
    }));

    return res.render('admin/catalog', {
      title: 'Admin - Catalogue',
      dbConnected,
      products: viewProducts,
      filters: { q, stock, sort: sortKey },
      successMessage,
      errorMessage,
      activeAiDraftJobsCount,
      pagination: {
        page,
        perPage,
        totalItems,
        totalPages,
        from: totalItems ? skip + 1 : 0,
        to: totalItems ? Math.min(skip + perPage, totalItems) : 0,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevPage: Math.max(1, page - 1),
        nextPage: Math.min(totalPages, page + 1),
      },
      ...buildAiProfileViewData(),
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminBulkDeleteProducts(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    const uniqueIds = parseAdminSelectedIds(req.body && (req.body.productIds || req.body.productId || req.body.ids));
    const safeReturnTo = getSafeAdminReturnTo(req.body && req.body.returnTo, '/admin/catalogue');

    if (!uniqueIds.length) {
      req.session.adminCatalogError = 'Aucun produit sélectionné.';
      return res.redirect(safeReturnTo);
    }

    const validIds = uniqueIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validIds.length) {
      req.session.adminCatalogError = 'Sélection invalide.';
      return res.redirect(safeReturnTo);
    }

    const selected = await Product.find({ _id: { $in: validIds } })
      .select('_id imageUrl galleryUrls')
      .lean();

    if (!selected.length) {
      req.session.adminCatalogError = 'Aucun produit trouvé.';
      return res.redirect(safeReturnTo);
    }

    const selectedObjectIds = selected
      .map((p) => (p && p._id ? p._id : null))
      .filter(Boolean);

    const usedItemIds = await Order.distinct('items.productId', {
      'items.productId': { $in: selectedObjectIds },
    });
    const usedConsigneIds = await Order.distinct('consigne.lines.productId', {
      'consigne.lines.productId': { $in: selectedObjectIds },
    });
    const usedSet = new Set(
      ([]
        .concat(Array.isArray(usedItemIds) ? usedItemIds : [])
        .concat(Array.isArray(usedConsigneIds) ? usedConsigneIds : []))
        .map((id) => String(id))
    );

    const deletable = selected.filter((p) => p && p._id && !usedSet.has(String(p._id)));
    const blockedCount = selected.length - deletable.length;

    if (!deletable.length) {
      if (wantsJsonResponse(req)) return res.status(409).json({ ok: false, error: 'Impossible de supprimer : les produits sélectionnés sont présents dans une ou plusieurs commandes.' });
      req.session.adminCatalogError =
        'Impossible de supprimer : les produits sélectionnés sont présents dans une ou plusieurs commandes.';
      return res.redirect(safeReturnTo);
    }

    for (const p of deletable) {
      if (!p) continue;
      if (p.imageUrl) {
        await mediaStorage.deleteFromUrl(p.imageUrl);
      }
      const galleries = Array.isArray(p.galleryUrls) ? p.galleryUrls : [];
      for (const url of galleries) {
        if (!url) continue;
        await mediaStorage.deleteFromUrl(url);
      }
    }

    const selectedIds = deletable.map((p) => p && p._id).filter(Boolean);
    const result = await Product.deleteMany({ _id: { $in: selectedIds } });
    const deletedCount = Number.isFinite(result && result.deletedCount) ? result.deletedCount : 0;

    if (!deletedCount) {
      req.session.adminCatalogError = 'Aucun produit supprimé.';
      return res.redirect(safeReturnTo);
    }

    req.session.adminCatalogSuccess = blockedCount
      ? `${deletedCount} produit(s) supprimé(s). ${blockedCount} ignoré(s) (présents dans des commandes).`
      : `${deletedCount} produit(s) supprimé(s).`;

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: deletedCount + ' produit(s) supprimé(s).', data: { deletedIds: selectedIds.map(String), deletedCount, blockedCount } });
    return res.redirect(safeReturnTo);
  } catch (err) {
    return next(err);
  }
}

async function getAdminShippingClassesPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const errorMessage = req.session.adminShippingClassError || null;
    const form = req.session.adminShippingClassForm || {
      name: '',
      sortOrder: '',
      domicilePrice: '',
      isActive: true,
      isDefault: false,
    };
    delete req.session.adminShippingClassError;
    delete req.session.adminShippingClassForm;

    if (!dbConnected) {
      return res.render('admin/shipping-classes', {
        title: 'Admin - Expédition',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible.",
        form,
        shippingClasses: [],
      });
    }

    const classes = await ShippingClass.find({})
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    const usedCounts = await Product.aggregate([
      { $match: { shippingClassId: { $ne: null } } },
      { $group: { _id: '$shippingClassId', count: { $sum: 1 } } },
    ]);

    const usedById = new Map();
    for (const row of usedCounts) {
      if (!row || !row._id) continue;
      usedById.set(String(row._id), Number.isFinite(row.count) ? row.count : 0);
    }

    const shippingClasses = classes.map((c) => {
      const id = String(c._id);
      const usedCount = usedById.get(id) || 0;
      const isDefault = c.isDefault === true;
      const canDelete = usedCount === 0 && !isDefault;
      return {
        id,
        name: c.name || '',
        slug: c.slug || '',
        sortOrder: Number.isFinite(c.sortOrder) ? c.sortOrder : 0,
        isActive: c.isActive !== false,
        isDefault,
        domicilePrice: formatEuro(c.domicilePriceCents),
        domicilePriceInput: formatPriceForInput(c.domicilePriceCents),
        usedCount,
        canDelete,
      };
    });

    return res.render('admin/shipping-classes', {
      title: 'Admin - Expédition',
      dbConnected,
      errorMessage,
      form,
      shippingClasses,
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminCreateShippingClass(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.redirect('/admin/expedition');

    const name = getTrimmedString(req.body.name);
    const sortOrderRaw = typeof req.body.sortOrder === 'string' ? req.body.sortOrder.trim() : '';
    const sortOrderNum = sortOrderRaw ? Number(sortOrderRaw) : 0;
    const sortOrder = Number.isFinite(sortOrderNum) ? Math.floor(sortOrderNum) : 0;
    const domicilePriceRaw = getTrimmedString(req.body.domicilePrice);
    const domicilePriceCents = domicilePriceRaw ? parsePriceToCents(domicilePriceRaw) : 0;
    const isActive = req.body.isActive === 'on' || req.body.isActive === 'true';
    const isDefault = req.body.isDefault === 'on' || req.body.isDefault === 'true';

    req.session.adminShippingClassForm = {
      name,
      sortOrder: sortOrderRaw,
      domicilePrice: domicilePriceRaw,
      isActive,
      isDefault,
    };

    if (!name) {
      req.session.adminShippingClassError = 'Merci de renseigner un nom.';
      return res.redirect('/admin/expedition');
    }

    const slug = slugify(name);
    if (!slug) {
      req.session.adminShippingClassError = 'Nom invalide.';
      return res.redirect('/admin/expedition');
    }

    if (domicilePriceCents === null) {
      req.session.adminShippingClassError = 'Prix domicile invalide.';
      return res.redirect('/admin/expedition');
    }

    const created = await ShippingClass.create({
      name,
      slug,
      sortOrder,
      isActive,
      isDefault,
      domicilePriceCents,
    });

    delete req.session.adminShippingClassForm;
    delete req.session.adminShippingClassError;

    if (isDefault) {
      await ShippingClass.updateMany(
        { _id: { $ne: created._id } },
        { $set: { isDefault: false } }
      );
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Classe d\'expédition créée.' });
    return res.redirect('/admin/expedition');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminShippingClassError = 'Cette classe existe déjà (slug en double).';
      return res.redirect('/admin/expedition');
    }
    return next(err);
  }
}

async function postAdminUpdateShippingClass(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { classId } = req.params;
    if (!dbConnected) return res.redirect('/admin/expedition');
    if (!mongoose.Types.ObjectId.isValid(classId)) return res.redirect('/admin/expedition');

    const existing = await ShippingClass.findById(classId).lean();
    if (!existing) return res.redirect('/admin/expedition');

    const name = getTrimmedString(req.body.name);
    const sortOrderRaw = typeof req.body.sortOrder === 'string' ? req.body.sortOrder.trim() : '';
    const sortOrderNum = sortOrderRaw ? Number(sortOrderRaw) : 0;
    const sortOrder = Number.isFinite(sortOrderNum) ? Math.floor(sortOrderNum) : 0;
    const domicilePriceRaw = getTrimmedString(req.body.domicilePrice);
    const domicilePriceCents = domicilePriceRaw ? parsePriceToCents(domicilePriceRaw) : 0;
    const isActive = req.body.isActive === 'on' || req.body.isActive === 'true';
    const wantsDefault = req.body.isDefault === 'on' || req.body.isDefault === 'true';

    if (!name) {
      req.session.adminShippingClassError = 'Nom invalide.';
      return res.redirect('/admin/expedition');
    }

    const slug = slugify(name);
    if (!slug) {
      req.session.adminShippingClassError = 'Nom invalide.';
      return res.redirect('/admin/expedition');
    }

    if (domicilePriceCents === null) {
      req.session.adminShippingClassError = 'Prix domicile invalide.';
      return res.redirect('/admin/expedition');
    }

    const isDefault = existing.isDefault === true ? true : wantsDefault;

    await ShippingClass.findByIdAndUpdate(classId, {
      $set: {
        name,
        slug,
        sortOrder,
        isActive,
        isDefault,
        domicilePriceCents,
      },
    });

    if (isDefault) {
      await ShippingClass.updateMany(
        { _id: { $ne: new mongoose.Types.ObjectId(classId) } },
        { $set: { isDefault: false } }
      );
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Classe d\'expédition mise à jour.' });
    return res.redirect('/admin/expedition');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminShippingClassError = 'Cette classe existe déjà (slug en double).';
      return res.redirect('/admin/expedition');
    }
    return next(err);
  }
}

async function postAdminDeleteShippingClass(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { classId } = req.params;
    if (!dbConnected) return res.redirect('/admin/expedition');
    if (!mongoose.Types.ObjectId.isValid(classId)) return res.redirect('/admin/expedition');

    const existing = await ShippingClass.findById(classId).lean();
    if (!existing) return res.redirect('/admin/expedition');
    if (existing.isDefault === true) {
      if (wantsJsonResponse(req)) return res.status(409).json({ ok: false, error: 'Impossible de supprimer : classe par défaut.' });
      req.session.adminShippingClassError = 'Impossible de supprimer : classe par défaut.';
      return res.redirect('/admin/expedition');
    }

    const usedCount = await Product.countDocuments({ shippingClassId: new mongoose.Types.ObjectId(classId) });
    if (usedCount > 0) {
      if (wantsJsonResponse(req)) return res.status(409).json({ ok: false, error: 'Impossible de supprimer : classe utilisée par des produits.' });
      req.session.adminShippingClassError = 'Impossible de supprimer : classe utilisée par des produits.';
      return res.redirect('/admin/expedition');
    }

    await ShippingClass.findByIdAndDelete(classId);
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Classe d\'expédition supprimée.', data: { deletedIds: [classId] } });
    return res.redirect('/admin/expedition');
  } catch (err) {
    return next(err);
  }
}

async function getAdminProductOptionTemplatesPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const successMessage = req.session.adminProductOptionTemplateSuccess || null;
    const errorMessage = req.session.adminProductOptionTemplateError || null;

    delete req.session.adminProductOptionTemplateSuccess;
    delete req.session.adminProductOptionTemplateError;

    if (!dbConnected) {
      return res.render('admin/product-options', {
        title: 'Admin - Options produit',
        dbConnected,
        successMessage: null,
        errorMessage: "La base de données n'est pas disponible.",
        templates: [],
      });
    }

    const templates = await listProductOptionTemplates({ includeInactive: true });
    return res.render('admin/product-options', {
      title: 'Admin - Options produit',
      dbConnected,
      successMessage,
      errorMessage,
      templates,
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminCreateProductOptionTemplate(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminProductOptionTemplateError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/catalogue/options');
    }

    const parsed = parseProductOptionTemplatePayload(req.body);
    if (!parsed.ok) {
      req.session.adminProductOptionTemplateError = parsed.error || 'Option invalide.';
      return res.redirect('/admin/catalogue/options');
    }

    const count = await ProductOptionTemplate.countDocuments({});
    await ProductOptionTemplate.create({
      ...parsed.templateData,
      isActive: true,
      sortOrder: count,
    });

    req.session.adminProductOptionTemplateSuccess = 'Option réutilisable créée.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Option réutilisable créée.' });
    return res.redirect('/admin/catalogue/options');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminProductOptionTemplateError = 'Une option réutilisable existe déjà avec cette clé.';
      return res.redirect('/admin/catalogue/options');
    }
    return next(err);
  }
}

async function postAdminUpdateProductOptionTemplate(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { templateId } = req.params;

    if (!dbConnected) {
      req.session.adminProductOptionTemplateError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/catalogue/options');
    }

    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      req.session.adminProductOptionTemplateError = 'Option réutilisable introuvable.';
      return res.redirect('/admin/catalogue/options');
    }

    const parsed = parseProductOptionTemplatePayload(req.body);
    if (!parsed.ok) {
      req.session.adminProductOptionTemplateError = parsed.error || 'Option invalide.';
      return res.redirect('/admin/catalogue/options');
    }

    await ProductOptionTemplate.findByIdAndUpdate(templateId, {
      $set: parsed.templateData,
    });

    req.session.adminProductOptionTemplateSuccess = 'Option réutilisable mise à jour.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Option réutilisable mise à jour.' });
    return res.redirect('/admin/catalogue/options');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminProductOptionTemplateError = 'Une option réutilisable existe déjà avec cette clé.';
      return res.redirect('/admin/catalogue/options');
    }
    return next(err);
  }
}

async function postAdminToggleProductOptionTemplate(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { templateId } = req.params;

    if (!dbConnected) {
      req.session.adminProductOptionTemplateError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/catalogue/options');
    }

    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      req.session.adminProductOptionTemplateError = 'Option réutilisable introuvable.';
      return res.redirect('/admin/catalogue/options');
    }

    const existing = await ProductOptionTemplate.findById(templateId);
    if (!existing) {
      req.session.adminProductOptionTemplateError = 'Option réutilisable introuvable.';
      return res.redirect('/admin/catalogue/options');
    }

    existing.isActive = existing.isActive === false;
    await existing.save();

    req.session.adminProductOptionTemplateSuccess = existing.isActive
      ? 'Option réutilisable réactivée.'
      : 'Option réutilisable désactivée.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Statut modifié.', data: { id: templateId, isActive: existing.isActive } });
    return res.redirect('/admin/catalogue/options');
  } catch (err) {
    return next(err);
  }
}

async function getAdminNewProductPage(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;

  const errorMessage = req.session.adminShippingClassError || null;
  delete req.session.adminShippingClassError;

  const categories = dbConnected
    ? await Category.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name')
        .lean()
    : [];

  const compatIndex = dbConnected
    ? await getCompatibilityIndex()
    : { makes: [], modelsByMake: {} };

  const shippingClasses = dbConnected
    ? await ShippingClass.find({})
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name isActive isDefault')
        .lean()
    : [];

  const productOptionTemplates = dbConnected
    ? await listProductOptionTemplates({ includeInactive: true })
    : [];

  return res.render('admin/product', {
    title: 'Admin - Nouveau produit',
    dbConnected,
    mode: 'new',
    errorMessage,
    form: {
      name: '',
      slug: '',
      sku: '',
      brand: '',
      category: '',
      shippingClassId: '',
      shippingDelayText: '',
      compatibleReferences: '',
      price: '',
      compareAtPrice: '',
      inStock: true,
      stockQty: '',
      imageUrl: '',
      badgeTopLeft: '',
      badgeCondition: '',
      galleryUrls: '',
      shortDescription: '',
      description: '',
      keyPoints: '',
      specs: '',
      optionsJson: '',
      reconditioningSteps: '',
      compatibility: '',
      faqs: '',
      relatedBlogPostIds: '',
      videoUrl: '',
      metaTitle: '',
      metaDescription: '',
      consigneEnabled: false,
      consigneAmount: '',
      consigneDelayDays: '30',
      showKeyPoints: true,
      showSpecs: true,
      showReconditioning: true,
      showCompatibility: true,
      showFaq: true,
      showVideo: true,
      showSupportBox: true,
      showRelatedProducts: true,
    },
    seoAssistant: buildProductSeoAssistant({
      form: {
        name: '',
        sku: '',
        brand: '',
        category: '',
        imageUrl: '',
        galleryUrls: '',
        shortDescription: '',
        description: '',
        faqs: '',
        compatibility: '',
        metaTitle: '',
        metaDescription: '',
      },
      mode: 'new',
      productId: null,
    }),
    categories,
    shippingClasses: shippingClasses.map((c) => ({
      id: String(c._id),
      name: c.name || '',
      isActive: c.isActive !== false,
      isDefault: c.isDefault === true,
    })),
    productOptionTemplates,
    compatIndex,
    productId: null,
    latestAiDraftJob: null,
    ...buildAiProfileViewData(),
  });
}

async function postAdminCreateProduct(req, res, next) {
  let savedUploads = [];

  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const compatIndex = dbConnected
      ? await getCompatibilityIndex()
      : { makes: [], modelsByMake: {} };

    const productOptionTemplates = dbConnected
      ? await listProductOptionTemplates({ includeInactive: true })
      : [];

    const form = {
      name: getTrimmedString(req.body.name),
      slug: getTrimmedString(req.body.slug),
      sku: getTrimmedString(req.body.sku),
      brand: getTrimmedString(req.body.brand),
      category: getTrimmedString(req.body.category),
      shippingClassId: getTrimmedString(req.body.shippingClassId),
      shippingDelayText: getTrimmedString(req.body.shippingDelayText),
      compatibleReferences: getTrimmedString(req.body.compatibleReferences),
      price: getTrimmedString(req.body.price),
      compareAtPrice: getTrimmedString(req.body.compareAtPrice),
      inStock: req.body.inStock === 'on' || req.body.inStock === 'true',
      stockQty: getTrimmedString(req.body.stockQty),
      imageUrl: getTrimmedString(req.body.imageUrl),
      badgeTopLeft: getTrimmedString(req.body.badgeTopLeft),
      badgeCondition: getTrimmedString(req.body.badgeCondition),
      galleryUrls: getTrimmedString(req.body.galleryUrls),
      shortDescription: getTrimmedString(req.body.shortDescription),
      description: getTrimmedString(req.body.description),
      keyPoints: getTrimmedString(req.body.keyPoints),
      specs: getTrimmedString(req.body.specs),
      specType: getTrimmedString(req.body.specType),
      specProgrammation: getTrimmedString(req.body.specProgrammation),
      optionsJson: getTrimmedString(req.body.optionsJson),
      reconditioningSteps: getTrimmedString(req.body.reconditioningSteps),
      compatibility: getTrimmedString(req.body.compatibility),
      faqs: getTrimmedString(req.body.faqs),
      relatedBlogPostIds: getTrimmedString(req.body.relatedBlogPostIds),
      videoUrl: getTrimmedString(req.body.videoUrl),
      metaTitle: getTrimmedString(req.body.metaTitle),
      metaDescription: getTrimmedString(req.body.metaDescription),
      consigneEnabled: req.body.consigneEnabled === 'on' || req.body.consigneEnabled === 'true',
      consigneAmount: getTrimmedString(req.body.consigneAmount),
      consigneDelayDays: getTrimmedString(req.body.consigneDelayDays),
      showKeyPoints: req.body.showKeyPoints === 'on' || req.body.showKeyPoints === 'true',
      showSpecs: req.body.showSpecs === 'on' || req.body.showSpecs === 'true',
      showReconditioning: req.body.showReconditioning === 'on' || req.body.showReconditioning === 'true',
      showCompatibility: req.body.showCompatibility === 'on' || req.body.showCompatibility === 'true',
      showFaq: req.body.showFaq === 'on' || req.body.showFaq === 'true',
      showVideo: req.body.showVideo === 'on' || req.body.showVideo === 'true',
      showSupportBox: req.body.showSupportBox === 'on' || req.body.showSupportBox === 'true',
      showRelatedProducts: req.body.showRelatedProducts === 'on' || req.body.showRelatedProducts === 'true',
    };

    const hasSectionsInputs =
      Object.prototype.hasOwnProperty.call(req.body, 'showKeyPoints') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showSpecs') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showReconditioning') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showCompatibility') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showFaq') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showVideo') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showSupportBox') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showRelatedProducts');

    if (req.uploadError) {
      cleanupUploadedFiles(req);

      const shippingClasses = dbConnected
        ? await ShippingClass.find({})
            .sort({ sortOrder: 1, name: 1 })
            .select('_id name isActive isDefault')
            .lean()
        : [];

      return res.status(400).render('admin/product', {
        title: 'Admin - Nouveau produit',
        dbConnected,
        mode: 'new',
        errorMessage: req.uploadError,
        form,
        seoAssistant: buildProductSeoAssistant({ form, mode: 'new', productId: null }),
        categories: dbConnected
          ? await Category.find({ isActive: true })
              .sort({ sortOrder: 1, name: 1 })
              .select('_id name')
              .lean()
          : [],
        shippingClasses: shippingClasses.map((c) => ({
          id: String(c._id),
          name: c.name || '',
          isActive: c.isActive !== false,
          isDefault: c.isDefault === true,
        })),
        productOptionTemplates,
        compatIndex,
        productId: null,
      });
    }

    if (!dbConnected) {
      cleanupUploadedFiles(req);

      return res.status(503).render('admin/product', {
        title: 'Admin - Nouveau produit',
        dbConnected,
        mode: 'new',
        errorMessage: "La base de données n'est pas disponible.",
        form,
        seoAssistant: buildProductSeoAssistant({ form, mode: 'new', productId: null }),
        categories: [],
        shippingClasses: [],
        productOptionTemplates,
        compatIndex,
        productId: null,
      });
    }

    let shippingClassId = null;
    if (form.shippingClassId) {
      if (!mongoose.Types.ObjectId.isValid(form.shippingClassId)) {
        cleanupUploadedFiles(req);
        req.session.adminShippingClassError = 'Classe d’expédition invalide.';
        return res.redirect('/admin/catalogue/nouveau');
      }
      const exists = await ShippingClass.findById(form.shippingClassId).select('_id').lean();
      if (!exists) {
        cleanupUploadedFiles(req);
        req.session.adminShippingClassError = 'Classe d’expédition introuvable.';
        return res.redirect('/admin/catalogue/nouveau');
      }
      shippingClassId = new mongoose.Types.ObjectId(form.shippingClassId);
    }

    const priceCents = parsePriceToCents(form.price);
    const compareAtPriceCents = form.compareAtPrice ? parsePriceToCents(form.compareAtPrice) : null;
    const consigneAmountCentsRaw = form.consigneAmount ? parsePriceToCents(form.consigneAmount) : 0;
    const consigneAmountCents = consigneAmountCentsRaw === null ? null : consigneAmountCentsRaw;
    const consigneDelayDays = clampInt(form.consigneDelayDays || '30', { min: 0, max: 3650, fallback: 30 });
    const parsedStock = parseStockQty(form.stockQty);
    const parsedOptions = productOptions.parseProductOptionsJson(form.optionsJson);
    const hasMainImage = !!(getTrimmedString(form.imageUrl) || (Array.isArray(req.files) && req.files.length) || req.file);
    const requiredContentError = getRequiredProductContentError({ form, hasMainImage });

    if (!form.name || priceCents === null || (form.compareAtPrice && compareAtPriceCents === null) || consigneAmountCents === null || !parsedStock.ok || !parsedOptions.ok || requiredContentError) {
      cleanupUploadedFiles(req);

      const shippingClasses = await ShippingClass.find({})
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name isActive isDefault')
        .lean();

      return res.status(400).render('admin/product', {
        title: 'Admin - Nouveau produit',
        dbConnected,
        mode: 'new',
        errorMessage: !parsedStock.ok
          ? 'Merci de renseigner une quantité de stock valide (0 ou plus), ou laisse vide.'
          : !parsedOptions.ok
            ? (parsedOptions.error || 'Options invalides.')
          : requiredContentError
            ? requiredContentError
          : form.compareAtPrice && compareAtPriceCents === null
            ? 'Le prix barré est invalide.'
            : consigneAmountCents === null
              ? 'Le montant de consigne est invalide.'
              : 'Merci de renseigner au minimum un nom et un prix valide.',
        form,
        seoAssistant: buildProductSeoAssistant({ form, mode: 'new', productId: null }),
        categories: dbConnected
          ? await Category.find({ isActive: true })
              .sort({ sortOrder: 1, name: 1 })
              .select('_id name')
              .lean()
          : [],
        shippingClasses: shippingClasses.map((c) => ({
          id: String(c._id),
          name: c.name || '',
          isActive: c.isActive !== false,
          isDefault: c.isDefault === true,
        })),
        productOptionTemplates,
        compatIndex,
        productId: null,
      });
    }

    const stockQty = parsedStock.qty;
    const inStock = stockQty !== null ? stockQty > 0 : form.inStock;

    const galleryUrlsFromForm = parseLinesToArray(form.galleryUrls);
    const keyPoints = parseLinesToArray(form.keyPoints);
    const specs = parsePairsFromLines(form.specs);
    if (Object.prototype.hasOwnProperty.call(req.body, 'specType')) {
      upsertSpecPair(specs, 'type', 'Type', form.specType);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'specProgrammation')) {
      upsertSpecPair(specs, 'programmation', 'Programmation', form.specProgrammation);
    }
    const reconditioningSteps = parseStepsFromLines(form.reconditioningSteps);
    const compatibility = parseCompatibilityFromLines(form.compatibility);
    const faqs = parseFaqsFromLines(form.faqs);
    const relatedBlogPostIds = parseObjectIdListFromLines(form.relatedBlogPostIds);
    const compatibleReferences = parseLinesToArray(form.compatibleReferences);

    const baseSlug = slugify(form.slug || form.name) || 'produit';

    const slugCollision = await Product.findOne({ slug: baseSlug }).select('_id').lean();
    if (slugCollision) {
      cleanupUploadedFiles(req);

      const shippingClasses = await ShippingClass.find({})
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name isActive isDefault')
        .lean();

      return res.status(400).render('admin/product', {
        title: 'Admin - Nouveau produit',
        dbConnected,
        mode: 'new',
        errorMessage: 'Ce slug est déjà utilisé par un autre produit. Merci de choisir un slug unique.',
        form,
        seoAssistant: buildProductSeoAssistant({ form, mode: 'new', productId: null }),
        categories: dbConnected
          ? await Category.find({ isActive: true })
              .sort({ sortOrder: 1, name: 1 })
              .select('_id name')
              .lean()
          : [],
        shippingClasses: shippingClasses.map((c) => ({
          id: String(c._id),
          name: c.name || '',
          isActive: c.isActive !== false,
          isDefault: c.isDefault === true,
        })),
        productOptionTemplates,
        compatIndex,
        productId: null,
      });
    }

    const uploadedFiles = Array.isArray(req.files)
      ? req.files
      : req.file
        ? [req.file]
        : [];

    savedUploads = [];
    for (const f of uploadedFiles) {
      if (!f || !f.buffer) continue;
      const saved = await mediaStorage.saveMulterFile(f, {
        metadata: { scope: 'product' },
        fallbackPrefix: 'product',
      });
      savedUploads.push(saved);
    }

    const uploadedImageUrl = savedUploads.length ? savedUploads[0].url : '';
    const imageUrl = uploadedImageUrl || form.imageUrl;

    const extraGalleryUrls = savedUploads.slice(1).map((s) => s.url);
    const galleryUrls = [...galleryUrlsFromForm, ...extraGalleryUrls];

    const createData = {
      name: form.name,
      sku: form.sku,
      brand: form.brand,
      slug: baseSlug,
      category: form.category || 'Autre',
      shippingClassId,
      shippingDelayText: form.shippingDelayText,
      compatibleReferences,
      priceCents,
      compareAtPriceCents,
      options: parsedOptions.ok ? parsedOptions.options : [],
      optionTemplateIds: extractProductOptionTemplateObjectIds(parsedOptions.ok ? parsedOptions.options : []),
      consigne: {
        enabled: form.consigneEnabled === true && (Number.isFinite(consigneAmountCents) ? consigneAmountCents : 0) > 0,
        amountCents: Number.isFinite(consigneAmountCents) ? consigneAmountCents : 0,
        delayDays: consigneDelayDays,
      },
      inStock,
      stockQty,
      imageUrl,
      badges: {
        topLeft: form.badgeTopLeft,
        condition: form.badgeCondition,
      },
      galleryUrls,
      shortDescription: form.shortDescription,
      description: form.description,
      keyPoints,
      specs,
      reconditioningSteps,
      compatibility,
      faqs,
      relatedBlogPostIds,
      media: {
        videoUrl: form.videoUrl,
      },
      seo: {
        metaTitle: form.metaTitle,
        metaDescription: form.metaDescription,
      },
    };

    createData.sections = hasSectionsInputs
      ? {
          showKeyPoints: form.showKeyPoints,
          showSpecs: form.showSpecs,
          showReconditioning: form.showReconditioning,
          showCompatibility: form.showCompatibility,
          showFaq: form.showFaq,
          showVideo: form.showVideo,
          showSupportBox: form.showSupportBox,
          showRelatedProducts: form.showRelatedProducts,
        }
      : {
          showKeyPoints: true,
          showSpecs: true,
          showReconditioning: true,
          showCompatibility: true,
          showFaq: true,
          showVideo: true,
          showSupportBox: true,
          showRelatedProducts: true,
        };

    await Product.create(createData);

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Produit créé.' });
    return res.redirect('/admin/catalogue');
  } catch (err) {
    for (const saved of Array.isArray(savedUploads) ? savedUploads : []) {
      if (!saved || !saved.url) continue;
      await mediaStorage.deleteFromUrl(saved.url);
    }
    return next(err);
  }
}

async function getAdminEditProductPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { productId } = req.params;
    scheduleProductDraftQueue();

    if (!dbConnected) {
      return res.status(503).render('admin/product', {
        title: 'Admin - Produit',
        dbConnected,
        mode: 'edit',
        errorMessage: "La base de données n'est pas disponible.",
        form: null,
        seoAssistant: null,
        categories: [],
        shippingClasses: [],
        productOptionTemplates: [],
        compatIndex: { makes: [], modelsByMake: {} },
        productId: null,
        latestAiDraftJob: null,
        ...buildAiProfileViewData(),
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const product = await Product.findById(productId).lean();

    if (!product) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const categories = dbConnected
      ? await Category.find({ isActive: true })
          .sort({ sortOrder: 1, name: 1 })
          .select('_id name')
          .lean()
      : [];

    const shippingClassId = product && product.shippingClassId ? String(product.shippingClassId) : '';
    const shippingClasses = dbConnected
      ? await ShippingClass.find(shippingClassId ? { $or: [{ isActive: true }, { _id: product.shippingClassId }] } : { isActive: true })
          .sort({ sortOrder: 1, name: 1 })
          .select('_id name isActive isDefault')
          .lean()
      : [];

    const productOptionTemplates = dbConnected
      ? await listProductOptionTemplates({ includeInactive: true })
      : [];

    const compatIndex = dbConnected
      ? await getCompatibilityIndex()
      : { makes: [], modelsByMake: {} };
    const adminUserId = getAdminUserIdFromRequest(req);
    const latestAiDraftJobDoc = await ProductDraftGeneration.findOne({
      productId: product._id,
      adminUserId: adminUserId || null,
    })
      .sort({ createdAt: -1 })
      .lean();

    const errorMessage = req.session.adminShippingClassError || null;
    delete req.session.adminShippingClassError;

    return res.render('admin/product', {
      title: `Admin - ${product.name}`,
      dbConnected,
      mode: 'edit',
      errorMessage,
      form: {
        name: product.name || '',
        slug: product.slug || '',
        sku: product.sku || '',
        brand: product.brand || '',
        category: product.category || '',
        shippingClassId,
        shippingDelayText: product.shippingDelayText || '',
        compatibleReferences: Array.isArray(product.compatibleReferences) ? product.compatibleReferences.filter(Boolean).join('\n') : '',
        price: formatPriceForInput(product.priceCents),
        compareAtPrice: formatPriceForInput(product.compareAtPriceCents),
        inStock: product.inStock !== false,
        stockQty: Number.isFinite(product.stockQty) ? String(product.stockQty) : '',
        imageUrl: product.imageUrl || '',
        badgeTopLeft: product.badges && product.badges.topLeft ? product.badges.topLeft : '',
        badgeCondition: product.badges && product.badges.condition ? product.badges.condition : '',
        galleryUrls: Array.isArray(product.galleryUrls) ? product.galleryUrls.filter(Boolean).join('\n') : '',
        shortDescription: product.shortDescription || '',
        description: product.description || '',
        keyPoints: Array.isArray(product.keyPoints) ? product.keyPoints.filter(Boolean).join('\n') : '',
        specs: Array.isArray(product.specs)
          ? product.specs
              .filter((s) => s && (s.label || s.value))
              .map((s) => `${s.label || ''}: ${s.value || ''}`.trim())
              .join('\n')
          : '',
        optionsJson: Array.isArray(product.options) ? JSON.stringify(product.options, null, 2) : '',
        reconditioningSteps: Array.isArray(product.reconditioningSteps)
          ? product.reconditioningSteps
              .filter((s) => s && (s.title || s.description))
              .map((s) => `${s.title || ''}: ${s.description || ''}`.trim())
              .join('\n')
          : '',
        compatibility: Array.isArray(product.compatibility)
          ? product.compatibility
              .filter((c) => c && (c.make || c.model || c.years || c.engine))
              .map((c) => `${c.make || ''} | ${c.model || ''} | ${c.years || ''} | ${c.engine || ''}`.trim())
              .join('\n')
          : '',
        faqs: Array.isArray(product.faqs)
          ? product.faqs
              .filter((f) => f && (f.question || f.answer))
              .map((f) => `${f.question || ''} | ${f.answer || ''}`.trim())
              .join('\n')
          : '',
        relatedBlogPostIds: Array.isArray(product.relatedBlogPostIds)
          ? product.relatedBlogPostIds.map((id) => String(id)).join('\n')
          : '',
        videoUrl: product.media && product.media.videoUrl ? product.media.videoUrl : '',
        metaTitle: product.seo && product.seo.metaTitle ? product.seo.metaTitle : '',
        metaDescription: product.seo && product.seo.metaDescription ? product.seo.metaDescription : '',
        consigneEnabled: !!(product.consigne && product.consigne.enabled),
        consigneAmount: formatPriceForInput(product.consigne && Number.isFinite(product.consigne.amountCents) ? product.consigne.amountCents : 0),
        consigneDelayDays: String(product.consigne && Number.isFinite(product.consigne.delayDays) ? product.consigne.delayDays : 30),
        showKeyPoints: !product.sections || product.sections.showKeyPoints !== false,
        showSpecs: !product.sections || product.sections.showSpecs !== false,
        showReconditioning: !product.sections || product.sections.showReconditioning !== false,
        showCompatibility: !product.sections || product.sections.showCompatibility !== false,
        showFaq: !product.sections || product.sections.showFaq !== false,
        showVideo: !product.sections || product.sections.showVideo !== false,
        showSupportBox: !product.sections || product.sections.showSupportBox !== false,
        showRelatedProducts: !product.sections || product.sections.showRelatedProducts !== false,
      },
      seoAssistant: buildProductSeoAssistant({
        form: {
          name: product.name || '',
          sku: product.sku || '',
          brand: product.brand || '',
          category: product.category || '',
          imageUrl: product.imageUrl || '',
          galleryUrls: Array.isArray(product.galleryUrls) ? product.galleryUrls.filter(Boolean).join('\n') : '',
          shortDescription: product.shortDescription || '',
          description: product.description || '',
          faqs: Array.isArray(product.faqs)
            ? product.faqs
                .filter((f) => f && (f.question || f.answer))
                .map((f) => `${f.question || ''} | ${f.answer || ''}`.trim())
                .join('\n')
            : '',
          compatibility: Array.isArray(product.compatibility)
            ? product.compatibility
                .filter((c) => c && (c.make || c.model || c.years || c.engine))
                .map((c) => `${c.make || ''} | ${c.model || ''} | ${c.years || ''} | ${c.engine || ''}`.trim())
                .join('\n')
            : '',
          metaTitle: product.seo && product.seo.metaTitle ? product.seo.metaTitle : '',
          metaDescription: product.seo && product.seo.metaDescription ? product.seo.metaDescription : '',
        },
        mode: 'edit',
        productId: String(product._id),
      }),
      categories,
      shippingClasses: shippingClasses.map((c) => ({
        id: String(c._id),
        name: c.name || '',
        isActive: c.isActive !== false,
        isDefault: c.isDefault === true,
      })),
      productOptionTemplates,
      compatIndex,
      productId: String(product._id),
      latestAiDraftJob: buildProductDraftJobView(latestAiDraftJobDoc, { includeDraft: true }),
      ...buildAiProfileViewData(),
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminUpdateProduct(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { productId } = req.params;

    const compatIndex = dbConnected
      ? await getCompatibilityIndex()
      : { makes: [], modelsByMake: {} };

    const productOptionTemplates = dbConnected
      ? await listProductOptionTemplates({ includeInactive: true })
      : [];

    const removeMainImage = req.body.removeMainImage === 'true' || req.body.removeMainImage === 'on';

    const form = {
      name: getTrimmedString(req.body.name),
      slug: getTrimmedString(req.body.slug),
      sku: getTrimmedString(req.body.sku),
      brand: getTrimmedString(req.body.brand),
      category: getTrimmedString(req.body.category),
      shippingClassId: getTrimmedString(req.body.shippingClassId),
      shippingDelayText: getTrimmedString(req.body.shippingDelayText),
      compatibleReferences: getTrimmedString(req.body.compatibleReferences),
      price: getTrimmedString(req.body.price),
      compareAtPrice: getTrimmedString(req.body.compareAtPrice),
      inStock: req.body.inStock === 'on' || req.body.inStock === 'true',
      stockQty: getTrimmedString(req.body.stockQty),
      imageUrl: getTrimmedString(req.body.imageUrl),
      badgeTopLeft: getTrimmedString(req.body.badgeTopLeft),
      badgeCondition: getTrimmedString(req.body.badgeCondition),
      galleryUrls: getTrimmedString(req.body.galleryUrls),
      shortDescription: getTrimmedString(req.body.shortDescription),
      description: getTrimmedString(req.body.description),
      keyPoints: getTrimmedString(req.body.keyPoints),
      specs: getTrimmedString(req.body.specs),
      specType: getTrimmedString(req.body.specType),
      specProgrammation: getTrimmedString(req.body.specProgrammation),
      optionsJson: getTrimmedString(req.body.optionsJson),
      reconditioningSteps: getTrimmedString(req.body.reconditioningSteps),
      compatibility: getTrimmedString(req.body.compatibility),
      faqs: getTrimmedString(req.body.faqs),
      relatedBlogPostIds: getTrimmedString(req.body.relatedBlogPostIds),
      videoUrl: getTrimmedString(req.body.videoUrl),
      metaTitle: getTrimmedString(req.body.metaTitle),
      metaDescription: getTrimmedString(req.body.metaDescription),
      consigneEnabled: req.body.consigneEnabled === 'on' || req.body.consigneEnabled === 'true',
      consigneAmount: getTrimmedString(req.body.consigneAmount),
      consigneDelayDays: getTrimmedString(req.body.consigneDelayDays),
      showKeyPoints: req.body.showKeyPoints === 'on' || req.body.showKeyPoints === 'true',
      showSpecs: req.body.showSpecs === 'on' || req.body.showSpecs === 'true',
      showReconditioning: req.body.showReconditioning === 'on' || req.body.showReconditioning === 'true',
      showCompatibility: req.body.showCompatibility === 'on' || req.body.showCompatibility === 'true',
      showFaq: req.body.showFaq === 'on' || req.body.showFaq === 'true',
      showVideo: req.body.showVideo === 'on' || req.body.showVideo === 'true',
      showSupportBox: req.body.showSupportBox === 'on' || req.body.showSupportBox === 'true',
      showRelatedProducts: req.body.showRelatedProducts === 'on' || req.body.showRelatedProducts === 'true',
    };

    const hasKeyPoints = Object.prototype.hasOwnProperty.call(req.body, 'keyPoints');
    const hasSpecs = Object.prototype.hasOwnProperty.call(req.body, 'specs');
    const hasSectionsInputs =
      Object.prototype.hasOwnProperty.call(req.body, 'showKeyPoints') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showSpecs') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showReconditioning') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showCompatibility') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showFaq') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showVideo') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showSupportBox') ||
      Object.prototype.hasOwnProperty.call(req.body, 'showRelatedProducts');

    if (!dbConnected) {
      cleanupUploadedFiles(req);

      return res.status(503).render('admin/product', {
        title: 'Admin - Produit',
        dbConnected,
        mode: 'edit',
        errorMessage: "La base de données n'est pas disponible.",
        form,
        seoAssistant: buildProductSeoAssistant({ form, mode: 'edit', productId }),
        shippingClasses: [],
        productOptionTemplates,
        compatIndex,
        productId: null,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      cleanupUploadedFiles(req);

      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const existing = await Product.findById(productId).select('_id imageUrl slug galleryUrls').lean();
    if (!existing) {
      cleanupUploadedFiles(req);

      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    if (req.uploadError) {
      cleanupUploadedFiles(req);

      const shippingClasses = await ShippingClass.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name isActive isDefault')
        .lean();

      return res.status(400).render('admin/product', {
        title: 'Admin - Produit',
        dbConnected,
        mode: 'edit',
        errorMessage: req.uploadError,
        form: {
          ...form,
          imageUrl: existing.imageUrl || form.imageUrl,
        },
        seoAssistant: buildProductSeoAssistant({
          form: { ...form, imageUrl: existing.imageUrl || form.imageUrl },
          mode: 'edit',
          productId,
        }),
        categories: dbConnected
          ? await Category.find({ isActive: true })
              .sort({ sortOrder: 1, name: 1 })
              .select('_id name')
              .lean()
          : [],
        shippingClasses: shippingClasses.map((c) => ({
          id: String(c._id),
          name: c.name || '',
          isActive: c.isActive !== false,
          isDefault: c.isDefault === true,
        })),
        productOptionTemplates,
        compatIndex,
        productId,
      });
    }

    const priceCents = parsePriceToCents(form.price);
    const compareAtPriceCents = form.compareAtPrice ? parsePriceToCents(form.compareAtPrice) : null;
    const consigneAmountCentsRaw = form.consigneAmount ? parsePriceToCents(form.consigneAmount) : 0;
    const consigneAmountCents = consigneAmountCentsRaw === null ? null : consigneAmountCentsRaw;
    const consigneDelayDays = clampInt(form.consigneDelayDays || '30', { min: 0, max: 3650, fallback: 30 });
    const parsedStock = parseStockQty(form.stockQty);
    const parsedOptions = productOptions.parseProductOptionsJson(form.optionsJson);
    const hasMainImage = !!(
      (removeMainImage ? '' : (getTrimmedString(form.imageUrl) || getTrimmedString(existing && existing.imageUrl)))
      || (Array.isArray(req.files) && req.files.length)
      || req.file
    );
    const requiredContentError = getRequiredProductContentError({ form, hasMainImage });

    if (!form.name || priceCents === null || (form.compareAtPrice && compareAtPriceCents === null) || consigneAmountCents === null || !parsedStock.ok || !parsedOptions.ok || requiredContentError) {
      cleanupUploadedFiles(req);

      const shippingClasses = await ShippingClass.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name isActive isDefault')
        .lean();

      return res.status(400).render('admin/product', {
        title: 'Admin - Produit',
        dbConnected,
        mode: 'edit',
        errorMessage: !parsedStock.ok
          ? 'Merci de renseigner une quantité de stock valide (0 ou plus), ou laisse vide.'
          : !parsedOptions.ok
            ? (parsedOptions.error || 'Options invalides.')
          : requiredContentError
            ? requiredContentError
          : form.compareAtPrice && compareAtPriceCents === null
            ? 'Le prix barré est invalide.'
            : consigneAmountCents === null
              ? 'Le montant de consigne est invalide.'
              : 'Merci de renseigner au minimum un nom et un prix valide.',
        form: {
          ...form,
          imageUrl: existing.imageUrl || form.imageUrl,
        },
        categories: dbConnected
          ? await Category.find({ isActive: true })
              .sort({ sortOrder: 1, name: 1 })
              .select('_id name')
              .lean()
          : [],
        shippingClasses: shippingClasses.map((c) => ({
          id: String(c._id),
          name: c.name || '',
          isActive: c.isActive !== false,
          isDefault: c.isDefault === true,
        })),
        productOptionTemplates,
        compatIndex,
        productId,
      });
    }

    let shippingClassId = null;
    if (form.shippingClassId) {
      if (!mongoose.Types.ObjectId.isValid(form.shippingClassId)) {
        req.session.adminShippingClassError = 'Classe d’expédition invalide.';
        return res.redirect(`/admin/catalogue/${encodeURIComponent(String(productId))}`);
      }
      const exists = await ShippingClass.findById(form.shippingClassId).select('_id').lean();
      if (!exists) {
        req.session.adminShippingClassError = 'Classe d’expédition introuvable.';
        return res.redirect(`/admin/catalogue/${encodeURIComponent(String(productId))}`);
      }
      shippingClassId = new mongoose.Types.ObjectId(form.shippingClassId);
    }

    const uploadedFiles = Array.isArray(req.files)
      ? req.files
      : req.file
        ? [req.file]
        : [];

    const savedUploads = [];
    for (const f of uploadedFiles) {
      if (!f || !f.buffer) continue;
      const saved = await mediaStorage.saveMulterFile(f, {
        metadata: { scope: 'product' },
        fallbackPrefix: 'product',
      });
      savedUploads.push(saved);
    }

    const uploadedImageUrl = savedUploads.length ? savedUploads[0].url : '';
    const shouldRemoveMain = removeMainImage && !uploadedImageUrl;
    const nextImageUrl = uploadedImageUrl || (shouldRemoveMain ? '' : (form.imageUrl || existing.imageUrl || ''));

    const stockQty = parsedStock.qty;
    const inStock = stockQty !== null ? stockQty > 0 : form.inStock;

    const galleryUrlsFromForm = parseLinesToArray(form.galleryUrls);
    const extraGalleryUrls = savedUploads.slice(1).map((s) => s.url);
    const galleryUrls = [...galleryUrlsFromForm, ...extraGalleryUrls];
    const keyPoints = hasKeyPoints ? parseLinesToArray(form.keyPoints) : null;
    const specs = hasSpecs ? parsePairsFromLines(form.specs) : null;
    if (hasSpecs && specs) {
      if (Object.prototype.hasOwnProperty.call(req.body, 'specType')) {
        upsertSpecPair(specs, 'type', 'Type', form.specType);
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'specProgrammation')) {
        upsertSpecPair(specs, 'programmation', 'Programmation', form.specProgrammation);
      }
    }
    const reconditioningSteps = parseStepsFromLines(form.reconditioningSteps);
    const compatibility = parseCompatibilityFromLines(form.compatibility);
    const faqs = parseFaqsFromLines(form.faqs);
    const relatedBlogPostIds = parseObjectIdListFromLines(form.relatedBlogPostIds);
    const compatibleReferences = parseLinesToArray(form.compatibleReferences);

    const desiredSlug = slugify(form.slug);
    const stableSlug = desiredSlug
      || ((existing && typeof existing.slug === 'string' && existing.slug.trim()) ? existing.slug.trim() : '')
      || (slugify(form.name) || 'produit');

    if (desiredSlug && desiredSlug !== (existing && typeof existing.slug === 'string' ? existing.slug.trim() : '')) {
      const collision = await Product.findOne({ slug: desiredSlug, _id: { $ne: new mongoose.Types.ObjectId(productId) } })
        .select('_id')
        .lean();

      if (collision) {
        cleanupUploadedFiles(req);

        const shippingClasses = await ShippingClass.find({ isActive: true })
          .sort({ sortOrder: 1, name: 1 })
          .select('_id name isActive isDefault')
          .lean();

        return res.status(400).render('admin/product', {
          title: 'Admin - Produit',
          dbConnected,
          mode: 'edit',
          errorMessage: 'Ce slug est déjà utilisé par un autre produit. Merci de choisir un slug unique.',
          form: {
            ...form,
            imageUrl: existing.imageUrl || form.imageUrl,
          },
          categories: dbConnected
            ? await Category.find({ isActive: true })
                .sort({ sortOrder: 1, name: 1 })
                .select('_id name')
                .lean()
            : [],
          shippingClasses: shippingClasses.map((c) => ({
            id: String(c._id),
            name: c.name || '',
            isActive: c.isActive !== false,
            isDefault: c.isDefault === true,
          })),
          productOptionTemplates,
          compatIndex,
          productId,
        });
      }
    }

    if (uploadedImageUrl || shouldRemoveMain) {
      await mediaStorage.deleteFromUrl(existing.imageUrl);
    }

    const existingGalleryUrls = Array.isArray(existing.galleryUrls) ? existing.galleryUrls.filter(Boolean) : [];
    const nextGallerySet = new Set(galleryUrls.filter(Boolean));
    const removedGalleryUrls = existingGalleryUrls.filter((u) => !nextGallerySet.has(u));
    for (const url of removedGalleryUrls) {
      await mediaStorage.deleteFromUrl(url);
    }

    const updated = await Product.findByIdAndUpdate(
      productId,
      {
        $set: {
          name: form.name,
          sku: form.sku,
          brand: form.brand,
          slug: stableSlug,
          category: form.category || 'Autre',
          shippingClassId,
          shippingDelayText: form.shippingDelayText,
          compatibleReferences,
          priceCents,
          compareAtPriceCents,
          options: parsedOptions.ok ? parsedOptions.options : [],
          optionTemplateIds: extractProductOptionTemplateObjectIds(parsedOptions.ok ? parsedOptions.options : []),
          consigne: {
            enabled: form.consigneEnabled === true && (Number.isFinite(consigneAmountCents) ? consigneAmountCents : 0) > 0,
            amountCents: Number.isFinite(consigneAmountCents) ? consigneAmountCents : 0,
            delayDays: consigneDelayDays,
          },
          inStock,
          stockQty,
          imageUrl: nextImageUrl,
          badges: {
            topLeft: form.badgeTopLeft,
            condition: form.badgeCondition,
          },
          galleryUrls,
          shortDescription: form.shortDescription,
          description: form.description,
          reconditioningSteps,
          compatibility,
          faqs,
          relatedBlogPostIds,
          media: {
            videoUrl: form.videoUrl,
          },
          seo: {
            metaTitle: form.metaTitle,
            metaDescription: form.metaDescription,
          },
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const setPatch = {};
    if (hasKeyPoints) setPatch.keyPoints = keyPoints;
    if (hasSpecs) setPatch.specs = specs;
    if (hasSectionsInputs) {
      setPatch.sections = {
        showKeyPoints: form.showKeyPoints,
        showSpecs: form.showSpecs,
        showReconditioning: form.showReconditioning,
        showCompatibility: form.showCompatibility,
        showFaq: form.showFaq,
        showVideo: form.showVideo,
        showSupportBox: form.showSupportBox,
        showRelatedProducts: form.showRelatedProducts,
      };
    }

    if (Object.keys(setPatch).length) {
      await Product.updateOne({ _id: productId }, { $set: setPatch });
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Produit enregistré.' });
    return res.redirect(`/admin/catalogue/${encodeURIComponent(String(updated._id))}`);
  } catch (err) {
    return next(err);
  }
}

async function postAdminDeleteProduct(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { productId } = req.params;

    const safeReturnTo = (() => {
      const value = req.body && typeof req.body.returnTo === 'string' ? req.body.returnTo : '';
      const trimmed = value.trim();
      if (!trimmed) return '/admin/catalogue';
      if (!trimmed.startsWith('/admin')) return '/admin/catalogue';
      if (trimmed.startsWith('//')) return '/admin/catalogue';
      return trimmed;
    })();

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const existing = await Product.findById(productId).select('_id imageUrl galleryUrls').lean();
    if (existing) {
      if (existing.imageUrl) {
        await mediaStorage.deleteFromUrl(existing.imageUrl);
      }
      const galleries = Array.isArray(existing.galleryUrls) ? existing.galleryUrls : [];
      for (const url of galleries) {
        if (!url) continue;
        await mediaStorage.deleteFromUrl(url);
      }
    }

    await Product.findByIdAndDelete(productId);
    req.session.adminCatalogSuccess = 'Produit supprimé.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Produit supprimé.', data: { deletedIds: [productId] } });
    return res.redirect(safeReturnTo);
  } catch (err) {
    return next(err);
  }
}

async function getAdminClientsPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const q = getTrimmedString(req.query.q);
    const type = getTrimmedString(req.query.type);
    const period = getTrimmedString(req.query.period);
    const clientSortFieldRaw = getTrimmedString(req.query.sort);
    const clientSortOrderRaw = getTrimmedString(req.query.order);
    const allowedClientSortFields = new Set(['name', 'type', 'created']);
    const activeClientSortField = allowedClientSortFields.has(clientSortFieldRaw) ? clientSortFieldRaw : 'created';
    const activeClientSortDir = clientSortOrderRaw === 'asc' ? 1 : -1;
    const clientSortFieldMap = { name: 'firstName', type: 'accountType', created: 'createdAt' };
    const mongoClientSort = { [clientSortFieldMap[activeClientSortField]]: activeClientSortDir };

    const perPage = 20;
    const rawPage = typeof req.query.page !== 'undefined' ? String(req.query.page) : '';
    const page = Math.max(1, Number.parseInt(rawPage, 10) || 1);

    if (!dbConnected) {
      return res.render('admin/clients', {
        title: 'Admin - Clients',
        dbConnected,
        clients: [],
        filters: { q, type, period },
        pagination: {
          page: 1,
          perPage,
          totalItems: 0,
          totalPages: 1,
          from: 0,
          to: 0,
          hasPrev: false,
          hasNext: false,
          prevPage: 1,
          nextPage: 1,
        },
      });
    }

    const userQuery = {};

    if (type === 'pro' || type === 'particulier') {
      userQuery.accountType = type;
    }

    if (period) {
      const today = new Date();
      const start = new Date(today);
      if (period === '7d') start.setDate(start.getDate() - 7);
      if (period === '30d') start.setDate(start.getDate() - 30);
      if (period === '90d') start.setDate(start.getDate() - 90);
      if (period === '365d') start.setDate(start.getDate() - 365);

      if (['7d', '30d', '90d', '365d'].includes(period)) {
        userQuery.createdAt = { $gte: start };
      }
    }

    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      userQuery.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }, { companyName: rx }];
    }

    const totalItems = await User.countDocuments(userQuery);
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    const currentPage = Math.min(page, totalPages);
    const skip = (currentPage - 1) * perPage;

    const users = await User.find(userQuery)
      .sort(mongoClientSort)
      .skip(skip)
      .limit(perPage)
      .select('_id firstName lastName email accountType companyName createdAt')
      .lean();

    const viewClients = users.map((u) => ({
      id: String(u._id),
      name: u.accountType === 'pro' ? u.companyName || `${u.firstName} ${u.lastName}` : `${u.firstName} ${u.lastName}`,
      email: u.email,
      accountType: u.accountType,
      createdAt: formatDateTimeFR(u.createdAt),
    }));

    const pagination = {
      page: currentPage,
      perPage,
      totalItems,
      totalPages,
      from: totalItems ? skip + 1 : 0,
      to: totalItems ? skip + users.length : 0,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
      prevPage: Math.max(1, currentPage - 1),
      nextPage: Math.min(totalPages, currentPage + 1),
    };

    return res.render('admin/clients', {
      title: 'Admin - Clients',
      dbConnected,
      clients: viewClients,
      filters: { q, type, period, sort: activeClientSortField, order: activeClientSortDir === 1 ? 'asc' : 'desc' },
      pagination,
    });
  } catch (err) {
    return next(err);
  }
}

async function getAdminClientDetailPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { userId } = req.params;

    const perPage = 10;
    const rawPage = typeof req.query.page !== 'undefined' ? String(req.query.page) : '';
    const page = Math.max(1, Number.parseInt(rawPage, 10) || 1);

    const rawOrderQ = typeof req.query.q !== 'undefined' ? String(req.query.q) : '';
    const orderQ = rawOrderQ.trim();
    const rawStatus = typeof req.query.status !== 'undefined' ? String(req.query.status) : '';
    const orderStatus = rawStatus.trim();
    const rawPeriod = typeof req.query.period !== 'undefined' ? String(req.query.period) : '';
    const orderPeriod = rawPeriod.trim();

    const errorMessage = req.session.adminClientError || null;
    delete req.session.adminClientError;

    if (!dbConnected) {
      return res.status(503).render('admin/client', {
        title: 'Admin - Client',
        dbConnected,
        errorMessage: errorMessage || "La base de données n'est pas disponible.",
        customer: null,
        orders: [],
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const user = await User.findById(userId)
      .select('_id firstName lastName email accountType companyName siret discountPercent addresses createdAt')
      .lean();

    if (!user) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const baseOrderQuery = { userId: user._id };
    const ordersCountAll = await Order.countDocuments(baseOrderQuery);

    const filteredOrderQuery = { ...baseOrderQuery };

    if (['en_attente', 'validee', 'expediee', 'livree', 'annulee'].includes(orderStatus)) {
      filteredOrderQuery.status = orderStatus;
    }

    if (['7d', '30d', '90d', '365d'].includes(orderPeriod)) {
      const today = new Date();
      const start = new Date(today);
      if (orderPeriod === '7d') start.setDate(start.getDate() - 7);
      if (orderPeriod === '30d') start.setDate(start.getDate() - 30);
      if (orderPeriod === '90d') start.setDate(start.getDate() - 90);
      if (orderPeriod === '365d') start.setDate(start.getDate() - 365);
      filteredOrderQuery.createdAt = { $gte: start };
    }

    if (orderQ) {
      const rx = new RegExp(escapeRegExp(orderQ), 'i');
      filteredOrderQuery.$or = [{ number: rx }, { 'items.name': rx }, { 'items.sku': rx }];
    }

    const ordersCount = await Order.countDocuments(filteredOrderQuery);
    const totalPages = Math.max(1, Math.ceil(ordersCount / perPage));
    const currentPage = Math.min(page, totalPages);
    const skip = (currentPage - 1) * perPage;

    const orders = await Order.find(filteredOrderQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(perPage)
      .select('_id number createdAt totalCents status items.quantity')
      .lean();

    const latestOrder = await Order.findOne(baseOrderQuery)
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();

    const viewOrders = orders.map((o) => {
      const formatted = formatDateTimeFR(o.createdAt);
      const parts = String(formatted).split(' • ');

      return {
      id: String(o._id),
      number: o.number,
      numberDisplay: o.number ? `#${o.number}` : '—',
      date: parts[0] || formatted,
      time: parts[1] || '',
      total: formatEuro(o.totalCents),
      statusBadge: getOrderStatusBadge(o.status),
      itemCount: Array.isArray(o.items)
        ? o.items.reduce((sum, it) => {
            if (!it || !Number.isFinite(it.quantity)) return sum;
            return sum + it.quantity;
          }, 0)
        : 0,
      };
    });

    function formatRelativeFR(value) {
      if (!value) return '—';
      const d = new Date(value);
      const ts = d.getTime();
      if (Number.isNaN(ts)) return '—';

      const diffMs = Date.now() - ts;
      if (diffMs < 0) return '—';

      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      if (diffDays >= 2) return `il y a ${diffDays} jours`;
      if (diffDays === 1) return 'il y a 1 jour';

      const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
      if (diffHours >= 2) return `il y a ${diffHours} heures`;
      if (diffHours === 1) return 'il y a 1 heure';

      const diffMinutes = Math.floor(diffMs / (60 * 1000));
      if (diffMinutes >= 2) return `il y a ${diffMinutes} minutes`;
      if (diffMinutes === 1) return 'il y a 1 minute';
      return "à l'instant";
    }

    const name = user.accountType === 'pro'
      ? user.companyName || `${user.firstName} ${user.lastName}`
      : `${user.firstName} ${user.lastName}`;

    const addresses = Array.isArray(user.addresses) ? user.addresses : [];
    const defaultAddress = addresses.find((a) => a && a.isDefault) || addresses[0] || null;

    const phone = defaultAddress && defaultAddress.phone ? String(defaultAddress.phone) : '';
    const city = defaultAddress && defaultAddress.city ? String(defaultAddress.city) : '';
    const country = defaultAddress && defaultAddress.country ? String(defaultAddress.country) : '';
    const location = city && country ? `${country}, ${city}` : city || country || '';

    const pagination = {
      page: currentPage,
      perPage,
      totalItems: ordersCount,
      totalPages,
      from: ordersCount ? skip + 1 : 0,
      to: ordersCount ? skip + orders.length : 0,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
      prevPage: Math.max(1, currentPage - 1),
      nextPage: Math.min(totalPages, currentPage + 1),
    };

    const orderFilters = {
      q: orderQ,
      status: ['en_attente', 'validee', 'expediee', 'livree', 'annulee'].includes(orderStatus) ? orderStatus : '',
      period: ['7d', '30d', '90d', '365d'].includes(orderPeriod) ? orderPeriod : '',
    };

    return res.render('admin/client', {
      title: `Admin - ${name}`,
      dbConnected,
      errorMessage,
      customer: {
        id: String(user._id),
        name,
        email: user.email,
        accountType: user.accountType,
        companyName: user.companyName || '',
        siret: user.siret || '',
        discountPercent: Number(user.discountPercent) || 0,
        createdAt: formatDateTimeFR(user.createdAt),
        phone,
        location,
        ordersCount: ordersCountAll,
        lastOrderRelative: latestOrder && latestOrder.createdAt ? formatRelativeFR(latestOrder.createdAt) : '—',
      },
      orders: viewOrders,
      pagination,
      orderFilters,
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminUpdateClientDiscount(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { userId } = req.params;

    if (!dbConnected) {
      req.session.adminClientError = "La base de données n'est pas disponible.";
      return res.redirect(`/admin/clients/${encodeURIComponent(String(userId || ''))}`);
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const user = await User.findById(userId).select('_id').lean();
    if (!user) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const discountPercent = parsePercentAllowZero(getTrimmedString(req.body.discountPercent));
    if (discountPercent === null) {
      req.session.adminClientError = 'Remise invalide (entre 0 et 90).';
      return res.redirect(`/admin/clients/${encodeURIComponent(String(userId))}`);
    }

    await User.findByIdAndUpdate(userId, {
      $set: {
        discountPercent,
      },
    });

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Remise client mise à jour.' });
    return res.redirect(`/admin/clients/${encodeURIComponent(String(userId))}`);
  } catch (err) {
    return next(err);
  }
}

async function getAdminPromoCodesPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    if (!dbConnected) {
      return res.render('admin/promo-codes', {
        title: 'Admin - Codes promo',
        dbConnected,
        errorMessage: null,
        promoCodes: [],
      });
    }

    const errorMessage = req.session.adminPromoCodeError || null;
    delete req.session.adminPromoCodeError;

    const promoDocs = await PromoCode.find({})
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    const promoIds = promoDocs
      .map((p) => (p && p._id ? p._id : null))
      .filter(Boolean);

    const usageAgg = promoIds.length
      ? await PromoRedemption.aggregate([
          { $match: { promoCodeId: { $in: promoIds }, state: 'redeemed' } },
          { $group: { _id: '$promoCodeId', count: { $sum: 1 } } },
        ])
      : [];

    const usedCountById = new Map(
      usageAgg.map((row) => [String(row._id), Number(row.count) || 0])
    );

    const promoCodes = promoDocs.map((p) => {
      const usedCount = usedCountById.get(String(p._id)) || 0;
      return {
        id: String(p._id),
        code: p.code,
        label: p.label || '',
        isActive: p.isActive !== false,
        discountType: p.discountType === 'fixed' ? 'fixed' : 'percent',
        discountPercent: Number(p.discountPercent) || 0,
        discountAmountCents: Number(p.discountAmountCents) || 0,
        minSubtotalCents: Number(p.minSubtotalCents) || 0,
        startsAt: p.startsAt ? formatDateTimeLocal(p.startsAt) : '',
        endsAt: p.endsAt ? formatDateTimeLocal(p.endsAt) : '',
        maxTotalUses: Number.isFinite(p.maxTotalUses) ? p.maxTotalUses : null,
        maxUsesPerUser: Number.isFinite(p.maxUsesPerUser) ? p.maxUsesPerUser : null,
        createdAt: formatDateTimeFR(p.createdAt),
        usedCount,
      };
    });

    return res.render('admin/promo-codes', {
      title: 'Admin - Codes promo',
      dbConnected,
      errorMessage,
      promoCodes,
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminCreatePromoCode(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminPromoCodeError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/codes-promo');
    }

    const codeRaw = getTrimmedString(req.body.code);
    const code = normalizePromoCode(codeRaw);
    const label = getTrimmedString(req.body.label);
    const isActive = req.body.isActive === 'on' || req.body.isActive === 'true';

    const discountType = req.body.discountType === 'fixed' ? 'fixed' : 'percent';
    const discountPercent = parsePercent(getTrimmedString(req.body.discountPercent));
    const discountAmountCents = req.body.discountAmount
      ? parsePriceToCents(getTrimmedString(req.body.discountAmount))
      : 0;

    const minSubtotalCents = req.body.minSubtotal
      ? parsePriceToCents(getTrimmedString(req.body.minSubtotal))
      : 0;

    const startsAt = parseDateTimeLocal(getTrimmedString(req.body.startsAt));
    const endsAt = parseDateTimeLocal(getTrimmedString(req.body.endsAt));

    const maxTotalUses = parseOptionalInt(getTrimmedString(req.body.maxTotalUses));
    const maxUsesPerUser = parseOptionalInt(getTrimmedString(req.body.maxUsesPerUser));

    if (!code || !isValidPromoCode(code)) {
      req.session.adminPromoCodeError = 'Code invalide (3 à 30 caractères, lettres/chiffres, - ou _).';
      return res.redirect('/admin/codes-promo');
    }

    if (discountType === 'percent') {
      if (discountPercent === null) {
        req.session.adminPromoCodeError = 'Pourcentage invalide.';
        return res.redirect('/admin/codes-promo');
      }
    } else {
      if (discountAmountCents === null || discountAmountCents <= 0) {
        req.session.adminPromoCodeError = 'Montant de remise invalide.';
        return res.redirect('/admin/codes-promo');
      }
    }

    if (minSubtotalCents === null || minSubtotalCents < 0) {
      req.session.adminPromoCodeError = 'Minimum commande invalide.';
      return res.redirect('/admin/codes-promo');
    }

    if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
      req.session.adminPromoCodeError = 'La date de fin doit être après la date de début.';
      return res.redirect('/admin/codes-promo');
    }

    await PromoCode.create({
      code,
      label,
      isActive,
      discountType,
      discountPercent: discountType === 'percent' ? discountPercent : 0,
      discountAmountCents: discountType === 'fixed' ? discountAmountCents : 0,
      minSubtotalCents,
      startsAt,
      endsAt,
      maxTotalUses,
      maxUsesPerUser,
    });

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Code promo créé.' });
    return res.redirect('/admin/codes-promo');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminPromoCodeError = 'Ce code promo existe déjà.';
      return res.redirect('/admin/codes-promo');
    }
    return next(err);
  }
}

async function postAdminUpdatePromoCode(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { promoId } = req.params;

    if (!dbConnected) {
      req.session.adminPromoCodeError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/codes-promo');
    }

    if (!mongoose.Types.ObjectId.isValid(promoId)) {
      req.session.adminPromoCodeError = 'Code promo introuvable.';
      return res.redirect('/admin/codes-promo');
    }

    const existing = await PromoCode.findById(promoId).select('_id').lean();
    if (!existing) {
      req.session.adminPromoCodeError = 'Code promo introuvable.';
      return res.redirect('/admin/codes-promo');
    }

    const codeRaw = getTrimmedString(req.body.code);
    const code = normalizePromoCode(codeRaw);
    const label = getTrimmedString(req.body.label);
    const isActive = req.body.isActive === 'on' || req.body.isActive === 'true';

    const discountType = req.body.discountType === 'fixed' ? 'fixed' : 'percent';
    const discountPercent = parsePercent(getTrimmedString(req.body.discountPercent));
    const discountAmountCents = req.body.discountAmount
      ? parsePriceToCents(getTrimmedString(req.body.discountAmount))
      : 0;

    const minSubtotalCents = req.body.minSubtotal
      ? parsePriceToCents(getTrimmedString(req.body.minSubtotal))
      : 0;

    const startsAt = parseDateTimeLocal(getTrimmedString(req.body.startsAt));
    const endsAt = parseDateTimeLocal(getTrimmedString(req.body.endsAt));

    const maxTotalUses = parseOptionalInt(getTrimmedString(req.body.maxTotalUses));
    const maxUsesPerUser = parseOptionalInt(getTrimmedString(req.body.maxUsesPerUser));

    if (!code || !isValidPromoCode(code)) {
      req.session.adminPromoCodeError = 'Code invalide (3 à 30 caractères, lettres/chiffres, - ou _).';
      return res.redirect('/admin/codes-promo');
    }

    if (discountType === 'percent') {
      if (discountPercent === null) {
        req.session.adminPromoCodeError = 'Pourcentage invalide.';
        return res.redirect('/admin/codes-promo');
      }
    } else {
      if (discountAmountCents === null || discountAmountCents <= 0) {
        req.session.adminPromoCodeError = 'Montant de remise invalide.';
        return res.redirect('/admin/codes-promo');
      }
    }

    if (minSubtotalCents === null || minSubtotalCents < 0) {
      req.session.adminPromoCodeError = 'Minimum commande invalide.';
      return res.redirect('/admin/codes-promo');
    }

    if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
      req.session.adminPromoCodeError = 'La date de fin doit être après la date de début.';
      return res.redirect('/admin/codes-promo');
    }

    await PromoCode.findByIdAndUpdate(promoId, {
      $set: {
        code,
        label,
        isActive,
        discountType,
        discountPercent: discountType === 'percent' ? discountPercent : 0,
        discountAmountCents: discountType === 'fixed' ? discountAmountCents : 0,
        minSubtotalCents,
        startsAt,
        endsAt,
        maxTotalUses,
        maxUsesPerUser,
      },
    });

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Code promo mis à jour.' });
    return res.redirect('/admin/codes-promo');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminPromoCodeError = 'Ce code promo existe déjà.';
      return res.redirect('/admin/codes-promo');
    }
    return next(err);
  }
}

async function postAdminDeletePromoCode(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { promoId } = req.params;

    if (!dbConnected) {
      req.session.adminPromoCodeError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/codes-promo');
    }

    if (!mongoose.Types.ObjectId.isValid(promoId)) {
      req.session.adminPromoCodeError = 'Code promo introuvable.';
      return res.redirect('/admin/codes-promo');
    }

    const existing = await PromoCode.findById(promoId).select('_id').lean();
    if (!existing) {
      req.session.adminPromoCodeError = 'Code promo introuvable.';
      return res.redirect('/admin/codes-promo');
    }

    await PromoRedemption.deleteMany({ promoCodeId: existing._id });
    await PromoCode.findByIdAndDelete(existing._id);

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Code promo supprimé.', data: { deletedIds: [promoId] } });
    return res.redirect('/admin/codes-promo');
  } catch (err) {
    return next(err);
  }
}

async function getAdminReturnsPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const period = typeof req.query.period === 'string' ? req.query.period.trim() : '';

    if (!dbConnected) {
      return res.render('admin/returns', {
        title: 'Admin - Consignes & retours',
        dbConnected,
        returns: [],
        filters: { q, status, type, period },
      });
    }

    const query = {};

    const allowedStatus = new Set(getReturnStatusOptions().map((o) => o.key));
    if (status && allowedStatus.has(status)) {
      query.status = status;
    }

    if (type === 'pro' || type === 'particulier') {
      query.accountType = type;
    }

    if (period) {
      const today = new Date();
      const start = new Date(today);
      if (period === '7d') start.setDate(start.getDate() - 7);
      if (period === '30d') start.setDate(start.getDate() - 30);
      if (period === '90d') start.setDate(start.getDate() - 90);
      if (period === '365d') start.setDate(start.getDate() - 365);

      if (['7d', '30d', '90d', '365d'].includes(period)) {
        query.createdAt = { $gte: start };
      }
    }

    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      const userMatches = await User.find({
        $or: [{ email: rx }, { firstName: rx }, { lastName: rx }, { companyName: rx }],
      })
        .select('_id')
        .limit(50)
        .lean();

      const userIds = userMatches
        .map((u) => (u && u._id ? u._id : null))
        .filter(Boolean);

      const or = [{ number: rx }, { orderNumber: rx }];
      if (userIds.length) {
        or.push({ userId: { $in: userIds } });
      }

      query.$or = or;
    }

    const returns = await ReturnRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const userIds = returns
      .map((r) => (r && r.userId ? String(r.userId) : null))
      .filter(Boolean)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const users = await User.find({ _id: { $in: userIds } })
      .select('_id accountType firstName lastName email companyName')
      .lean();

    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const viewReturns = returns.map((r) => {
      const u = r.userId ? userMap.get(String(r.userId)) : null;
      const customer = u
        ? u.accountType === 'pro'
          ? u.companyName || `${u.firstName} ${u.lastName}`
          : `${u.firstName} ${u.lastName}`
        : r.accountType === 'pro'
          ? 'Client Pro'
          : 'Client';

      return {
        id: String(r._id),
        number: r.number,
        orderNumber: r.orderNumber,
        date: formatDateTimeFR(r.createdAt),
        customer,
        customerEmail: u && u.email ? u.email : '',
        accountType: r.accountType,
        statusBadge: getReturnStatusBadge(r.status),
      };
    });

    return res.render('admin/returns', {
      title: 'Admin - Consignes & retours',
      dbConnected,
      returns: viewReturns,
      filters: { q, status, type, period },
    });
  } catch (err) {
    return next(err);
  }
}

async function getAdminReturnDetailPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { returnId } = req.params;

    if (!dbConnected) {
      return res.status(503).render('admin/return', {
        title: 'Admin - Retour',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible.",
        successMessage: null,
        returnRequest: null,
        statusOptions: getReturnStatusOptions(),
      });
    }

    if (!mongoose.Types.ObjectId.isValid(returnId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const rr = await ReturnRequest.findById(returnId).lean();
    if (!rr) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const user = rr.userId
      ? await User.findById(rr.userId)
          .select('_id accountType firstName lastName email companyName')
          .lean()
      : null;

    const customer = user
      ? user.accountType === 'pro'
        ? user.companyName || `${user.firstName} ${user.lastName}`
        : `${user.firstName} ${user.lastName}`
      : rr.accountType === 'pro'
        ? 'Client Pro'
        : 'Client';

    const viewReturn = {
      id: String(rr._id),
      number: rr.number,
      createdAt: formatDateTimeFR(rr.createdAt),
      accountType: rr.accountType,
      customer,
      customerEmail: user && user.email ? user.email : '',
      orderId: rr.orderId ? String(rr.orderId) : '',
      orderNumber: rr.orderNumber || '',
      reason: rr.reason || '',
      message: rr.message || '',
      adminNote: rr.adminNote || '',
      statusKey: rr.status,
      statusBadge: getReturnStatusBadge(rr.status),
      statusHistory: Array.isArray(rr.statusHistory)
        ? rr.statusHistory
            .slice()
            .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
            .map((h) => ({
              statusKey: h.status,
              statusBadge: getReturnStatusBadge(h.status),
              changedAt: formatDateTimeFR(h.changedAt),
              changedBy: h.changedBy || '—',
            }))
        : [],
    };

    return res.render('admin/return', {
      title: `Admin - ${rr.number}`,
      dbConnected,
      errorMessage: null,
      successMessage: null,
      returnRequest: viewReturn,
      statusOptions: getReturnStatusOptions(),
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminUpdateReturnStatus(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { returnId } = req.params;
    const status = typeof req.body.status === 'string' ? req.body.status : '';

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(returnId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const allowed = new Set(getReturnStatusOptions().map((o) => o.key));
    if (!allowed.has(status)) {
      return res.redirect(`/admin/retours/${encodeURIComponent(returnId)}`);
    }

    const existing = await ReturnRequest.findById(returnId)
      .select('_id status')
      .lean();

    if (!existing) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    if (existing.status !== status) {
      const changedBy = req.session && req.session.admin && req.session.admin.email
        ? String(req.session.admin.email)
        : 'admin';

      await ReturnRequest.findByIdAndUpdate(returnId, {
        $set: { status },
        $push: {
          statusHistory: {
            status,
            changedAt: new Date(),
            changedBy,
          },
        },
      });
    }

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Statut du retour mis à jour.', data: { id: returnId, status } });
    return res.redirect(`/admin/retours/${encodeURIComponent(returnId)}`);
  } catch (err) {
    return next(err);
  }
}

async function postAdminUpdateReturnNote(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { returnId } = req.params;
    const adminNote = typeof req.body.adminNote === 'string' ? req.body.adminNote.trim() : '';

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(returnId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    await ReturnRequest.findByIdAndUpdate(returnId, {
      $set: { adminNote },
    });

    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Note de retour mise à jour.' });
    return res.redirect(`/admin/retours/${encodeURIComponent(returnId)}`);
  } catch (err) {
    return next(err);
  }
}

async function getAdminSettingsPage(req, res, next) {
  try {
    const creds = getAdminCredentials();
    const dbConnected = mongoose.connection.readyState === 1;
    const teamSuccessMessage = req.session.adminTeamSuccess || null;
    const teamErrorMessage = req.session.adminTeamError || null;
    const passwordSuccessMessage = req.session.adminPasswordSuccess || null;
    const passwordErrorMessage = req.session.adminPasswordError || null;

    delete req.session.adminTeamSuccess;
    delete req.session.adminTeamError;
    delete req.session.adminPasswordSuccess;
    delete req.session.adminPasswordError;

    let backofficeUsers = [];
    if (dbConnected) {
      await ensureAdminUserStoreReady();
      const users = await adminUsers.listAdminUsers();
      backofficeUsers = users.map((user) => ({
        ...user,
        roleLabel: getAdminRoleLabel(user.role),
        createdAtLabel: formatDateTimeFR(user.createdAt),
        updatedAtLabel: formatDateTimeFR(user.updatedAt),
        lastLoginAtLabel: user.lastLoginAt ? formatDateTimeFR(user.lastLoginAt) : 'Jamais',
        canToggle: user.role !== 'owner',
      }));
    }

    return res.render('admin/settings', {
      title: 'Admin - Paramètres',
      dbConnected,
      isDevFallback: !dbConnected && creds.isDevFallback,
      canManageAdminUsers: canManageAdminUsers(req),
      currentAdminSession: getCurrentAdminSession(req),
      teamSuccessMessage,
      teamErrorMessage,
      passwordSuccessMessage,
      passwordErrorMessage,
      backofficeUsers,
    });
  } catch (err) {
    return next(err);
  }
}

async function postAdminCreateBackofficeUser(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminTeamError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/parametres');
    }

    if (!canManageAdminUsers(req)) {
      req.session.adminTeamError = 'Seul le compte principal peut gérer les membres du back-office.';
      return res.redirect('/admin/parametres');
    }

    const firstName = getTrimmedString(req.body && req.body.firstName);
    const lastName = getTrimmedString(req.body && req.body.lastName);
    const email = normalizeEmail(req.body && req.body.email);
    const password = normalizeEnvString(req.body && req.body.password);
    const passwordConfirm = normalizeEnvString(req.body && req.body.passwordConfirm);

    if (!firstName || !lastName || !email) {
      req.session.adminTeamError = 'Merci de renseigner le prénom, le nom et l’email.';
      return res.redirect('/admin/parametres');
    }

    if (!password || password.length < 8) {
      req.session.adminTeamError = 'Le mot de passe du nouvel utilisateur doit faire au moins 8 caractères.';
      return res.redirect('/admin/parametres');
    }

    if (password !== passwordConfirm) {
      req.session.adminTeamError = 'Les deux mots de passe du nouvel utilisateur ne correspondent pas.';
      return res.redirect('/admin/parametres');
    }

    const createdBy = getCurrentAdminSession(req);
    await adminUsers.createStaffAdminUser({
      firstName,
      lastName,
      email,
      password,
      createdByAdminUserId: createdBy && createdBy.adminUserId ? createdBy.adminUserId : null,
    });

    req.session.adminTeamSuccess = 'Compte back-office créé.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Compte back-office créé.' });
    return res.redirect('/admin/parametres');
  } catch (err) {
    if (err && err.code === 11000) {
      req.session.adminTeamError = 'Un compte back-office existe déjà avec cet email.';
      return res.redirect('/admin/parametres');
    }
    return next(err);
  }
}

async function postAdminToggleBackofficeUser(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminTeamError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/parametres');
    }

    if (!canManageAdminUsers(req)) {
      req.session.adminTeamError = 'Seul le compte principal peut gérer les membres du back-office.';
      return res.redirect('/admin/parametres');
    }

    const { adminUserId } = req.params;
    const shouldEnable = getTrimmedString(req.body && req.body.isActive) === 'true';
    const result = await adminUsers.toggleAdminUserActive({ adminUserId, isActive: shouldEnable });

    if (!result || !result.ok) {
      req.session.adminTeamError = result && result.reason === 'owner_locked'
        ? 'Le compte administrateur principal ne peut pas être désactivé.'
        : 'Impossible de modifier ce compte back-office.';
      return res.redirect('/admin/parametres');
    }

    req.session.adminTeamSuccess = shouldEnable
      ? 'Compte back-office réactivé.'
      : 'Compte back-office désactivé.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Statut modifié.', data: { id: adminUserId, isActive: shouldEnable } });
    return res.redirect('/admin/parametres');
  } catch (err) {
    return next(err);
  }
}

async function postAdminResetBackofficeUserPassword(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminTeamError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/parametres');
    }

    if (!canManageAdminUsers(req)) {
      req.session.adminTeamError = 'Seul le compte principal peut gérer les membres du back-office.';
      return res.redirect('/admin/parametres');
    }

    const { adminUserId } = req.params;
    const nextPassword = normalizeEnvString(req.body && req.body.nextPassword);
    const nextPasswordConfirm = normalizeEnvString(req.body && req.body.nextPasswordConfirm);

    if (!nextPassword || nextPassword.length < 8) {
      req.session.adminTeamError = 'Le nouveau mot de passe employé doit faire au moins 8 caractères.';
      return res.redirect('/admin/parametres');
    }

    if (nextPassword !== nextPasswordConfirm) {
      req.session.adminTeamError = 'Les deux mots de passe employés ne correspondent pas.';
      return res.redirect('/admin/parametres');
    }

    const result = await adminUsers.updateAdminUserPasswordByOwner({
      adminUserId,
      nextPassword,
    });

    if (!result || !result.ok) {
      req.session.adminTeamError = result && result.reason === 'owner_locked'
        ? 'Le mot de passe du compte principal doit être changé depuis la zone de mot de passe du compte connecté.'
        : 'Impossible de réinitialiser ce mot de passe employé.';
      return res.redirect('/admin/parametres');
    }

    req.session.adminTeamSuccess = 'Mot de passe employé mis à jour.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Mot de passe employé mis à jour.' });
    return res.redirect('/admin/parametres');
  } catch (err) {
    return next(err);
  }
}

async function postAdminChangeOwnPassword(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminPasswordError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/parametres');
    }

    const currentAdmin = getCurrentAdminSession(req);
    if (!currentAdmin || !currentAdmin.adminUserId) {
      req.session.adminPasswordError = 'Session admin invalide. Merci de te reconnecter.';
      return res.redirect('/admin/parametres');
    }

    const currentPassword = normalizeEnvString(req.body && req.body.currentPassword);
    const nextPassword = normalizeEnvString(req.body && req.body.nextPassword);
    const nextPasswordConfirm = normalizeEnvString(req.body && req.body.nextPasswordConfirm);

    if (!currentPassword || !nextPassword || !nextPasswordConfirm) {
      req.session.adminPasswordError = 'Merci de renseigner tous les champs du mot de passe.';
      return res.redirect('/admin/parametres');
    }

    if (nextPassword.length < 8) {
      req.session.adminPasswordError = 'Le nouveau mot de passe doit faire au moins 8 caractères.';
      return res.redirect('/admin/parametres');
    }

    if (nextPassword !== nextPasswordConfirm) {
      req.session.adminPasswordError = 'Les deux nouveaux mots de passe ne correspondent pas.';
      return res.redirect('/admin/parametres');
    }

    const updated = await adminUsers.updateOwnPassword({
      adminUserId: currentAdmin.adminUserId,
      currentPassword,
      nextPassword,
    });

    if (!updated || !updated.ok) {
      req.session.adminPasswordError = updated && updated.reason === 'invalid_current_password'
        ? 'Le mot de passe actuel est incorrect.'
        : 'Impossible de mettre à jour le mot de passe pour le moment.';
      return res.redirect('/admin/parametres');
    }

    req.session.adminPasswordSuccess = 'Mot de passe mis à jour.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Mot de passe mis à jour.' });
    return res.redirect('/admin/parametres');
  } catch (err) {
    return next(err);
  }
}

async function getAdminInvoiceSettingsPage(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;
  const fallback = invoiceSettings.buildEnvFallback();

  if (!dbConnected) {
    return res.status(503).render('admin/invoice-settings', {
      title: 'Admin - Facturation',
      dbConnected,
      form: fallback,
      successMessage: null,
      errorMessage: "La base de données n'est pas disponible.",
    });
  }

  const successMessage = req.session.adminInvoiceSettingsSuccess || null;
  const errorMessage = req.session.adminInvoiceSettingsError || null;
  delete req.session.adminInvoiceSettingsSuccess;
  delete req.session.adminInvoiceSettingsError;

  const merged = await invoiceSettings.getInvoiceSettingsMergedWithFallback();

  return res.render('admin/invoice-settings', {
    title: 'Admin - Facturation',
    dbConnected,
    form: merged,
    successMessage,
    errorMessage,
  });
}

async function postAdminInvoiceSettings(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) {
      req.session.adminInvoiceSettingsError = "La base de données n'est pas disponible.";
      return res.redirect('/admin/parametres/facturation');
    }

    if (req.uploadError) {
      req.session.adminInvoiceSettingsError = req.uploadError;
      return res.redirect('/admin/parametres/facturation');
    }

    if (req.file && req.file.buffer) {
      const previous = await invoiceSettings.getInvoiceSettingsMergedWithFallback();
      const saved = await mediaStorage.saveMulterFile(req.file, {
        metadata: { scope: 'invoice-logo' },
        fallbackPrefix: 'invoice-logo',
      });

      req.body.logoUrl = saved && saved.url ? saved.url : '';

      if (previous && previous.logoUrl) {
        await mediaStorage.deleteFromUrl(previous.logoUrl);
      }
    }

    await invoiceSettings.updateInvoiceSettingsFromForm(req.body);
    req.session.adminInvoiceSettingsSuccess = 'Paramètres de facturation enregistrés.';
    if (wantsJsonResponse(req)) return res.json({ ok: true, message: 'Paramètres de facturation enregistrés.' });
    return res.redirect('/admin/parametres/facturation');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getAdminLogin,
  postAdminLogin,
  postAdminLogout,
  getAdminResetPassword,
  postAdminResetPassword,
  postAdminGenerateProductDraft,
  postAdminBulkGenerateProductDrafts,
  getAdminGenerateProductDraftStatus,
  postAdminCancelProductDraft,
  postAdminCancelAllProductDrafts,
  getAdminDashboard,
  getAdminOrdersPage,
  getAdminOrderDetailPage,
  postAdminUpdateOrderStatus,
  postAdminMarkOrderConsigneReceived,
  postAdminAddOrderShipment,
  postAdminDeleteOrderShipment,
  postAdminCreateReturnFromOrder,
  getAdminCatalogPage,
  getAdminCategoriesPage,
  postAdminCreateCategory,
  postAdminBulkDeleteCategories,
  postAdminUpdateCategory,
  postAdminToggleCategory,
  postAdminDeleteCategory,
  getAdminShippingClassesPage,
  postAdminCreateShippingClass,
  postAdminUpdateShippingClass,
  postAdminDeleteShippingClass,
  getAdminProductOptionTemplatesPage,
  postAdminCreateProductOptionTemplate,
  postAdminUpdateProductOptionTemplate,
  postAdminToggleProductOptionTemplate,
  getAdminNewProductPage,
  postAdminCreateProduct,
  getAdminEditProductPage,
  postAdminUpdateProduct,
  postAdminDeleteProduct,
  postAdminBulkDeleteProducts,
  getAdminClientsPage,
  getAdminClientDetailPage,
  postAdminUpdateClientDiscount,
  getAdminPromoCodesPage,
  postAdminCreatePromoCode,
  postAdminUpdatePromoCode,
  postAdminDeletePromoCode,
  getAdminReturnsPage,
  getAdminReturnDetailPage,
  postAdminUpdateReturnStatus,
  postAdminUpdateReturnNote,
  getAdminVehicleMakesPage,
  postAdminCreateVehicleMake,
  postAdminUpdateVehicleMake,
  postAdminDeleteVehicleMake,
  postAdminAddVehicleModel,
  postAdminUpdateVehicleModel,
  postAdminDeleteVehicleModel,
  getAdminSettingsPage,
  postAdminCreateBackofficeUser,
  postAdminToggleBackofficeUser,
  postAdminResetBackofficeUserPassword,
  postAdminChangeOwnPassword,
  getAdminInvoiceSettingsPage,
  postAdminInvoiceSettings,
  getAdminSiteSettingsPage,
  postAdminSiteSettings,
};
