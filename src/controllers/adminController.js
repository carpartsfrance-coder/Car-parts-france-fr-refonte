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

const track17 = require('../services/track17');
const emailService = require('../services/emailService');

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
    return res.redirect(`/admin/commandes/${encodeURIComponent(orderId)}`);
  } catch (err) {
    return next(err);
  }
}

function tryDeleteFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    return;
  }
}

function getLocalProductImagePath(imageUrl) {
  if (typeof imageUrl !== 'string') return '';
  const normalized = imageUrl.trim();
  if (!normalized.startsWith('/uploads/products/')) return '';
  const rel = normalized.replace(/^\//, '');
  return path.join(__dirname, '..', '..', 'public', rel);
}

function cleanupUploadedFiles(req) {
  const files = Array.isArray(req && req.files)
    ? req.files
    : req && req.file
      ? [req.file]
      : [];

  for (const f of files) {
    if (!f || !f.filename) continue;
    const filePath = path.join(__dirname, '..', '..', 'public', 'uploads', 'products', f.filename);
    tryDeleteFile(filePath);
  }
}

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
      password: 'admin',
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
        sortOrder: Number.isFinite(c.sortOrder) ? c.sortOrder : 0,
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
              sortOrder: 0,
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
      sortOrder,
    });

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

    const existing = await Category.findById(categoryId).select('_id name sortOrder').lean();
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
      const affectedCats = await Category.find({ name: { $regex: catRx } }).select('_id name sortOrder').lean();

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
          $set: { name: updatedName, slug: updatedSlug, sortOrder: updatedSortOrder },
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
      if (nextName !== oldName || sortOrder !== (Number.isFinite(existing.sortOrder) ? existing.sortOrder : 0)) {
        await Category.findByIdAndUpdate(categoryId, {
          $set: { name: nextName, slug: nextSlug, sortOrder },
        });
      }

      if (nextName !== oldName) {
        await Product.updateMany({ category: oldName }, { $set: { category: nextName } });
      }
    }

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
        req.session.adminCategoryError = 'Impossible de supprimer : cette catégorie principale possède des sous-catégories.';
        return res.redirect('/admin/categories');
      }

      const usedRx = new RegExp(`^${escapeRegExp(parts.main)}(\\s*>|$)`);
      const usedCount = await Product.countDocuments({ category: { $regex: usedRx } });
      if (usedCount > 0) {
        req.session.adminCategoryError = 'Impossible de supprimer : cette catégorie est utilisée par des produits.';
        return res.redirect('/admin/categories');
      }
    } else {
      const usedCount = await Product.countDocuments({ category: existing.name });
      if (usedCount > 0) {
        req.session.adminCategoryError = 'Impossible de supprimer : cette catégorie est utilisée par des produits.';
        return res.redirect('/admin/categories');
      }
    }

    await Category.findByIdAndDelete(categoryId);
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
      req.session.adminCategoryError = blocked.length
        ? `Aucune suppression possible. Bloqué : ${blocked.slice(0, 5).join(', ')}${blocked.length > 5 ? '…' : ''}`
        : 'Aucune suppression possible.';
      return res.redirect('/admin/categories');
    }

    await Category.deleteMany({ _id: { $in: deletableIds } });

    if (blocked.length) {
      req.session.adminCategoryError = `Suppression partielle : ${deletableIds.length} supprimée(s). Bloqué : ${blocked.slice(0, 5).join(', ')}${blocked.length > 5 ? '…' : ''}`;
    }

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
      return { label: 'Expédiée', className: 'bg-blue-50 text-blue-700' };
    case 'livree':
      return { label: 'Livrée', className: 'bg-green-50 text-green-700' };
    case 'annulee':
      return { label: 'Annulée', className: 'bg-red-50 text-red-700' };
    case 'validee':
      return { label: 'En préparation', className: 'bg-amber-50 text-amber-800' };
    case 'en_attente':
    default:
      return { label: 'En attente', className: 'bg-amber-50 text-amber-800' };
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

function getAdminLogin(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;
  const creds = getAdminCredentials();
  const returnTo = getSafeReturnTo(req.query.returnTo) || '/admin';
  const errorMessage = req.session.adminAuthError || null;
  const successMessage = req.session.adminAuthSuccess || null;
  const email = req.session.adminAuthEmail || '';

  delete req.session.adminAuthError;
  delete req.session.adminAuthSuccess;
  delete req.session.adminAuthEmail;

  return res.render('admin/login', {
    title: 'Admin - Connexion',
    dbConnected,
    errorMessage,
    successMessage,
    email,
    returnTo,
    isDevFallback: creds.isDevFallback,
    devFallbackEmail: creds.isDevFallback ? creds.email : '',
    devFallbackPassword: creds.isDevFallback ? creds.password : '',
  });
}

function postAdminLogin(req, res) {
  const creds = getAdminCredentials();
  const email = normalizeEmail(req.body.email);
  const password = normalizeEnvString(req.body.password);
  const returnTo = getSafeReturnTo(req.body.returnTo) || '/admin';

  if (!email || !password) {
    return res.status(400).render('admin/login', {
      title: 'Admin - Connexion',
      dbConnected: mongoose.connection.readyState === 1,
      errorMessage: 'Merci de renseigner ton email et ton mot de passe.',
      email,
      returnTo,
      isDevFallback: creds.isDevFallback,
      devFallbackEmail: creds.isDevFallback ? creds.email : '',
      devFallbackPassword: creds.isDevFallback ? creds.password : '',
    });
  }

  const passwordOk = creds.usesOverride
    ? verifyPassword({ password, salt: creds.passwordSalt, hash: creds.passwordHash })
    : password === normalizeEnvString(creds.password);

  if (email !== creds.email || !passwordOk) {
    return res.status(401).render('admin/login', {
      title: 'Admin - Connexion',
      dbConnected: mongoose.connection.readyState === 1,
      errorMessage: 'Identifiants incorrects.',
      successMessage: null,
      email,
      returnTo,
      isDevFallback: creds.isDevFallback,
      devFallbackEmail: creds.isDevFallback ? creds.email : '',
      devFallbackPassword: creds.isDevFallback ? creds.password : '',
    });
  }

  req.session.admin = {
    email,
  };

  if (!req.session || typeof req.session.save !== 'function') {
    return res.redirect(returnTo);
  }

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

function postAdminResetPassword(req, res) {
  const expected = getAdminResetTokenFromEnv();
  if (!expected) {
    req.session.adminResetError = 'Réinitialisation désactivée (ADMIN_RESET_TOKEN manquant).';
    return res.redirect('/admin/reinitialiser');
  }

  const providedToken = normalizeEnvString(req.body && req.body.token);
  const password = normalizeEnvString(req.body && req.body.password);
  const passwordConfirm = normalizeEnvString(req.body && req.body.passwordConfirm);

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

  req.session.adminAuthSuccess = 'Mot de passe admin mis à jour. Tu peux te connecter.';
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
        sales: { values: [35, 48, 42, 55, 70, 82, 65], labels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] },
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

    const latestOrders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('_id number userId accountType totalCents createdAt')
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
      },
      sales: { values: [35, 48, 42, 55, 70, 82, 65], labels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] },
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

    if (!dbConnected) {
      return res.render('admin/orders', {
        title: 'Admin - Commandes',
        dbConnected,
        orders: [],
        filters: { q, status, type, period },
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

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
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

    return res.render('admin/orders', {
      title: 'Admin - Commandes',
      dbConnected,
      orders: viewOrders,
      filters: { q, status, type, period },
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

function getPublicBaseUrlFromEnv() {
  const base = getTrimmedString(process.env.PUBLIC_BASE_URL) || getTrimmedString(process.env.COMPANY_WEBSITE_URL);
  return base ? base.replace(/\/$/, '') : '';
}

function buildProductSeoAssistant({ form, mode, productId } = {}) {
  const siteName = 'CarParts France';
  const baseUrl = getPublicBaseUrlFromEnv();

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

  const urlStubSlug = slugify(name) || 'produit';
  const urlStubId = productId ? String(productId) : 'ID';
  const urlPath = `/produits/${encodeURIComponent(urlStubSlug)}-${encodeURIComponent(urlStubId)}`;
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
    detail: name ? '' : 'Ajoute un nom clair (idéalement avec la référence OEM).',
    weight: 20,
  });
  checks.push({
    key: 'brand',
    label: 'Marque',
    ok: Boolean(brand),
    detail: brand ? '' : 'Ajoute la marque (Volkswagen, Audi…).',
    weight: 5,
  });
  checks.push({
    key: 'category',
    label: 'Catégorie',
    ok: Boolean(category),
    detail: category ? '' : 'Choisis une catégorie.',
    weight: 5,
  });
  checks.push({
    key: 'ref',
    label: 'Référence (SKU / OEM) présente',
    ok: hasRef,
    detail: hasRef ? '' : 'Ajoute un SKU ou une référence OEM dans le nom.',
    weight: 8,
  });
  checks.push({
    key: 'metaTitle',
    label: 'Meta title (50–60 caractères)',
    ok: metaTitleLen >= 45 && metaTitleLen <= 65,
    detail: metaTitle ? `Longueur actuelle : ${metaTitleLen}` : `Auto : ${metaTitleLen} (tu peux optimiser)`,
    weight: 10,
  });
  checks.push({
    key: 'metaDescription',
    label: 'Meta description (120–160 caractères)',
    ok: metaDescLen >= 110 && metaDescLen <= 170,
    detail: metaDescription ? `Longueur actuelle : ${metaDescLen}` : `Auto : ${metaDescLen} (tu peux optimiser)`,
    weight: 10,
  });
  checks.push({
    key: 'image',
    label: 'Image principale',
    ok: Boolean(imageUrl),
    detail: imageUrl ? '' : 'Ajoute une image principale (important pour le clic).',
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

    return res.redirect(getAdminVehiclesReturnTo(req));
  } catch (err) {
    return next(err);
  }
}

async function getAdminCatalogPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const stock = typeof req.query.stock === 'string' ? req.query.stock.trim() : '';

    if (!dbConnected) {
      return res.render('admin/catalog', {
        title: 'Admin - Catalogue',
        dbConnected,
        products: [],
        filters: { q, stock },
      });
    }

    const productQuery = {};

    Object.assign(productQuery, buildStockQuery(stock));

    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      productQuery.$or = [{ name: rx }, { sku: rx }, { brand: rx }, { category: rx }];
    }

    const products = await Product.find(productQuery)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    const viewProducts = products.map((p) => ({
      seoScore: buildProductSeoAssistant({
        form: {
          name: p.name || '',
          sku: p.sku || '',
          brand: p.brand || '',
          category: p.category || '',
          imageUrl: p.imageUrl || '',
          galleryUrls: Array.isArray(p.galleryUrls) ? p.galleryUrls.filter(Boolean).join('\n') : '',
          shortDescription: p.shortDescription || '',
          description: p.description || '',
          faqs: Array.isArray(p.faqs) ? p.faqs.filter((f) => f && (f.question || f.answer)).map((f) => `${f.question || ''} | ${f.answer || ''}`.trim()).join('\n') : '',
          compatibility: Array.isArray(p.compatibility) ? p.compatibility.filter((c) => c && (c.make || c.model || c.years || c.engine)).map((c) => `${c.make || ''} | ${c.model || ''} | ${c.years || ''} | ${c.engine || ''}`.trim()).join('\n') : '',
          metaTitle: p.seo && p.seo.metaTitle ? p.seo.metaTitle : '',
          metaDescription: p.seo && p.seo.metaDescription ? p.seo.metaDescription : '',
        },
        mode: 'catalog',
        productId: String(p._id),
      }).score,
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      category: p.category,
      brand: p.brand,
      price: formatEuro(p.priceCents),
      inStock: p.inStock,
      stockQty: Number.isFinite(p.stockQty) ? p.stockQty : null,
    }));

    return res.render('admin/catalog', {
      title: 'Admin - Catalogue',
      dbConnected,
      products: viewProducts,
      filters: { q, stock },
    });
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
      req.session.adminShippingClassError = 'Impossible de supprimer : classe par défaut.';
      return res.redirect('/admin/expedition');
    }

    const usedCount = await Product.countDocuments({ shippingClassId: new mongoose.Types.ObjectId(classId) });
    if (usedCount > 0) {
      req.session.adminShippingClassError = 'Impossible de supprimer : classe utilisée par des produits.';
      return res.redirect('/admin/expedition');
    }

    await ShippingClass.findByIdAndDelete(classId);
    return res.redirect('/admin/expedition');
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

  return res.render('admin/product', {
    title: 'Admin - Nouveau produit',
    dbConnected,
    mode: 'new',
    errorMessage,
    form: {
      name: '',
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
    compatIndex,
    productId: null,
  });
}

async function postAdminCreateProduct(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const compatIndex = dbConnected
      ? await getCompatibilityIndex()
      : { makes: [], modelsByMake: {} };

    const form = {
      name: getTrimmedString(req.body.name),
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

    if (!form.name || priceCents === null || (form.compareAtPrice && compareAtPriceCents === null) || consigneAmountCents === null || !parsedStock.ok) {
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
        compatIndex,
        productId: null,
      });
    }

    const uploadedFiles = Array.isArray(req.files)
      ? req.files
      : req.file && req.file.filename
        ? [req.file]
        : [];

    const uploadedImageUrl = uploadedFiles.length && uploadedFiles[0].filename
      ? `/uploads/products/${uploadedFiles[0].filename}`
      : '';
    const imageUrl = uploadedImageUrl || form.imageUrl;

    const stockQty = parsedStock.qty;
    const inStock = stockQty !== null ? stockQty > 0 : form.inStock;

    const galleryUrlsFromForm = parseLinesToArray(form.galleryUrls);
    const extraGalleryUrls = uploadedFiles
      .slice(1)
      .filter((f) => f && f.filename)
      .map((f) => `/uploads/products/${f.filename}`);
    const galleryUrls = [...galleryUrlsFromForm, ...extraGalleryUrls];
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

    const baseSlug = slugify(form.name) || 'produit';
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

    return res.redirect('/admin/catalogue');
  } catch (err) {
    return next(err);
  }
}

async function getAdminEditProductPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { productId } = req.params;

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
        compatIndex: { makes: [], modelsByMake: {} },
        productId: null,
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

    const compatIndex = dbConnected
      ? await getCompatibilityIndex()
      : { makes: [], modelsByMake: {} };

    const errorMessage = req.session.adminShippingClassError || null;
    delete req.session.adminShippingClassError;

    return res.render('admin/product', {
      title: `Admin - ${product.name}`,
      dbConnected,
      mode: 'edit',
      errorMessage,
      form: {
        name: product.name || '',
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
      compatIndex,
      productId: String(product._id),
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

    const removeMainImage = req.body.removeMainImage === 'true' || req.body.removeMainImage === 'on';

    const form = {
      name: getTrimmedString(req.body.name),
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

    const existing = await Product.findById(productId).select('_id imageUrl slug').lean();
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

    if (!form.name || priceCents === null || (form.compareAtPrice && compareAtPriceCents === null) || consigneAmountCents === null || !parsedStock.ok) {
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
      : req.file && req.file.filename
        ? [req.file]
        : [];

    const uploadedImageUrl = uploadedFiles.length && uploadedFiles[0].filename
      ? `/uploads/products/${uploadedFiles[0].filename}`
      : '';
    const shouldRemoveMain = removeMainImage && !uploadedImageUrl;
    const nextImageUrl = uploadedImageUrl || (shouldRemoveMain ? '' : (form.imageUrl || existing.imageUrl || ''));

    const stockQty = parsedStock.qty;
    const inStock = stockQty !== null ? stockQty > 0 : form.inStock;

    const galleryUrlsFromForm = parseLinesToArray(form.galleryUrls);
    const extraGalleryUrls = uploadedFiles
      .slice(1)
      .filter((f) => f && f.filename)
      .map((f) => `/uploads/products/${f.filename}`);
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

    const stableSlug = (existing && typeof existing.slug === 'string' && existing.slug.trim())
      ? existing.slug.trim()
      : (slugify(form.name) || 'produit');

    if (uploadedImageUrl || shouldRemoveMain) {
      const oldPath = getLocalProductImagePath(existing.imageUrl);
      tryDeleteFile(oldPath);
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

    return res.redirect(`/admin/catalogue/${encodeURIComponent(String(updated._id))}`);
  } catch (err) {
    return next(err);
  }
}

async function postAdminDeleteProduct(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { productId } = req.params;

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

    const existing = await Product.findById(productId).select('_id imageUrl').lean();
    if (existing && existing.imageUrl) {
      const absolutePath = getLocalProductImagePath(existing.imageUrl);
      tryDeleteFile(absolutePath);
    }

    await Product.findByIdAndDelete(productId);
    return res.redirect('/admin/catalogue');
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
      .sort({ createdAt: -1 })
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
      filters: { q, type, period },
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

    return res.redirect(`/admin/retours/${encodeURIComponent(returnId)}`);
  } catch (err) {
    return next(err);
  }
}

async function getAdminSettingsPage(req, res) {
  const creds = getAdminCredentials();

  return res.render('admin/settings', {
    title: 'Admin - Paramètres',
    dbConnected: mongoose.connection.readyState === 1,
    isDevFallback: creds.isDevFallback,
  });
}

module.exports = {
  getAdminLogin,
  postAdminLogin,
  postAdminLogout,
  getAdminResetPassword,
  postAdminResetPassword,
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
  getAdminNewProductPage,
  postAdminCreateProduct,
  getAdminEditProductPage,
  postAdminUpdateProduct,
  postAdminDeleteProduct,
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
};
