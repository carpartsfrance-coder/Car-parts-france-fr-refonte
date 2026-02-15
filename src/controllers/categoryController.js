const mongoose = require('mongoose');

const Category = require('../models/Category');
const Product = require('../models/Product');
const demoProducts = require('../demoProducts');
const { buildProductPublicPath, slugify: slugifyGeneric } = require('../services/productPublic');
const {
  buildCategoryPublicPath,
  buildCategoryPublicUrl,
  getPublicBaseUrlFromReq,
} = require('../services/categoryPublic');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value, max) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return '';
  if (!Number.isFinite(max) || max <= 0) return input;
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function normalizeMetaText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function parsePage(value) {
  if (typeof value !== 'string') return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function normalizeProductForList(product) {
  if (!product) return product;
  const p = { ...product };

  const stockQty = Number.isFinite(p.stockQty) ? p.stockQty : null;
  const inStock = stockQty !== null ? stockQty > 0 : p.inStock !== false;

  return {
    ...p,
    inStock,
    publicPath: buildProductPublicPath(p),
  };
}

function buildProductFilterFromCategoryName(categoryName) {
  const name = getTrimmedString(categoryName);
  if (!name) return {};

  if (name.includes('>')) {
    return { category: name };
  }

  const rx = `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*>|$)`;
  return { category: { $regex: new RegExp(rx) } };
}

async function listCategories(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    let categories = [];

    if (dbConnected) {
      categories = await Category.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name slug')
        .lean();

      categories = (categories || []).map((c) => ({
        id: String(c._id),
        name: c.name || '',
        slug: c.slug || '',
        publicPath: buildCategoryPublicPath(c),
      }));
    } else {
      const used = new Set();
      const derived = [];
      for (const p of demoProducts || []) {
        const cat = getTrimmedString(p && p.category ? p.category : '');
        if (!cat) continue;
        if (used.has(cat)) continue;
        used.add(cat);
        derived.push({
          id: cat,
          name: cat,
          slug: slugifyGeneric(cat) || 'categorie',
        });
      }

      categories = derived
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .map((c) => ({
          ...c,
          publicPath: buildCategoryPublicPath(c),
        }));
    }

    const title = 'Catégories - CarParts France';
    const metaDescription = 'Découvre toutes nos catégories de pièces auto : moteur, freinage, carrosserie, électricité, entretien et plus.';
    const baseUrl = getPublicBaseUrlFromReq(req);
    const canonicalUrl = baseUrl ? `${baseUrl}/categorie` : '/categorie';

    return res.render('categories/index', {
      title,
      metaDescription,
      canonicalUrl,
      ogTitle: title,
      ogDescription: metaDescription,
      ogUrl: canonicalUrl,
      ogType: 'website',
      dbConnected,
      categories,
    });
  } catch (err) {
    return next(err);
  }
}

async function getCategory(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const slug = getTrimmedString(req.params.slug);
    if (!slug) {
      return res.status(404).render('errors/404', { title: 'Page introuvable - CarParts France' });
    }

    let category = null;

    if (dbConnected) {
      category = await Category.findOne({ slug, isActive: { $ne: false } })
        .select('_id name slug updatedAt')
        .lean();
    } else {
      const all = new Map();
      for (const p of demoProducts || []) {
        const cat = getTrimmedString(p && p.category ? p.category : '');
        if (!cat) continue;
        const s = slugifyGeneric(cat) || '';
        if (!s) continue;
        if (!all.has(s)) all.set(s, { id: s, slug: s, name: cat, updatedAt: null });
      }
      category = all.get(slug) || null;
    }

    if (!category) {
      return res.status(404).render('errors/404', { title: 'Page introuvable - CarParts France' });
    }

    const perPage = 24;
    const page = parsePage(req.query.page);

    const filter = buildProductFilterFromCategoryName(category.name);

    let products = [];
    let totalCount = 0;

    if (dbConnected) {
      totalCount = await Product.countDocuments(filter);
      const totalPagesRaw = Math.max(1, Math.ceil(totalCount / perPage));
      const safePage = Math.min(page, totalPagesRaw);

      products = await Product.find(filter)
        .sort({ updatedAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      products = (products || []).map(normalizeProductForList);

      return renderCategoryPage({ req, res, category, products, totalCount, page: safePage, perPage, totalPages: totalPagesRaw, dbConnected });
    }

    products = (demoProducts || [])
      .filter((p) => {
        if (!p) return false;
        if (!filter.category) return true;
        const cat = getTrimmedString(p.category);
        if (!cat) return false;
        if (typeof filter.category === 'string') return cat === filter.category;
        if (filter.category && filter.category.$regex) {
          return filter.category.$regex.test(cat);
        }
        return false;
      })
      .map(normalizeProductForList);

    totalCount = products.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
    const safePage = Math.min(page, totalPages);
    products = products.slice((safePage - 1) * perPage, safePage * perPage);

    return renderCategoryPage({ req, res, category, products, totalCount, page: safePage, perPage, totalPages, dbConnected });
  } catch (err) {
    return next(err);
  }
}

function renderCategoryPage({ req, res, category, products, totalCount, page, perPage, totalPages, dbConnected }) {
  const name = getTrimmedString(category && category.name ? category.name : 'Catégorie');
  const title = `${name} - Pièces auto | CarParts France`;
  const descBase = `Découvre nos pièces auto catégorie ${name}. Trouve la bonne pièce par référence ou par véhicule. Livraison rapide.`;
  const metaDescription = truncateText(normalizeMetaText(descBase), 160);

  const canonicalBase = buildCategoryPublicUrl(category, { req });
  const canonicalUrl = page > 1 ? `${canonicalBase}?page=${encodeURIComponent(String(page))}` : canonicalBase;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url: canonicalUrl,
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return res.render('categories/show', {
    title,
    metaDescription,
    canonicalUrl,
    ogTitle: title,
    ogDescription: metaDescription,
    ogUrl: canonicalUrl,
    ogType: 'website',
    jsonLd,
    dbConnected,
    category: {
      name,
      slug: category.slug,
      publicPath: buildCategoryPublicPath(category),
    },
    products,
    page,
    perPage,
    totalCount,
    totalPages,
  });
}

module.exports = {
  listCategories,
  getCategory,
};
