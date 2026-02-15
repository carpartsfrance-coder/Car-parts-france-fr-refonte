const mongoose = require('mongoose');

const Product = require('../models/Product');
const demoProducts = require('../demoProducts');
const { buildProductPublicPath, getPublicBaseUrlFromReq } = require('../services/productPublic');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toSuggestItem(p) {
  if (!p) return null;
  const id = p && p._id ? String(p._id) : '';
  const name = getTrimmedString(p.name);
  const sku = getTrimmedString(p.sku);
  const brand = getTrimmedString(p.brand);
  const imageUrl = getTrimmedString(p.imageUrl) || (Array.isArray(p.galleryUrls) && p.galleryUrls[0] ? getTrimmedString(p.galleryUrls[0]) : '');
  const publicPath = buildProductPublicPath(p);
  const priceCents = Number.isFinite(p.priceCents) ? p.priceCents : 0;

  return {
    id,
    name,
    sku,
    brand,
    imageUrl,
    publicPath,
    priceCents,
  };
}

function formatMoney(cents) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round((Number(cents) || 0)) / 100);
}

async function getSearchPage(req, res, next) {
  try {
    const title = 'Rechercher - CarParts France';
    const metaDescription = 'Recherche rapide de pièces auto par nom, référence (SKU) ou marque.';
    const baseUrl = getPublicBaseUrlFromReq(req);
    const canonicalUrl = baseUrl ? `${baseUrl}/rechercher` : '/rechercher';

    return res.render('search/index', {
      title,
      metaDescription,
      canonicalUrl,
      ogTitle: title,
      ogDescription: metaDescription,
      ogUrl: canonicalUrl,
      ogType: 'website',
    });
  } catch (err) {
    return next(err);
  }
}

async function getSuggest(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const q = getTrimmedString(req.query.q);

    if (!q || q.length < 2) {
      return res.json({ results: [] });
    }

    const safe = escapeRegExp(q);
    const rx = new RegExp(safe, 'i');

    let results = [];

    if (dbConnected) {
      const products = await Product.find({
        $or: [{ name: rx }, { sku: rx }, { brand: rx }],
      })
        .select('_id name sku brand priceCents imageUrl galleryUrls slug')
        .limit(8)
        .lean();

      results = (products || []).map(toSuggestItem).filter(Boolean);
    } else {
      const filtered = (demoProducts || []).filter((p) => {
        if (!p) return false;
        const name = getTrimmedString(p.name);
        const sku = getTrimmedString(p.sku);
        const brand = getTrimmedString(p.brand);
        return rx.test(name) || rx.test(sku) || rx.test(brand);
      });

      results = filtered.slice(0, 8).map((p) => toSuggestItem({ ...p, _id: p._id || p.id || p.sku || p.name }));
    }

    const formatted = results.map((r) => ({
      ...r,
      price: `${formatMoney(r.priceCents)} €`,
    }));

    return res.json({ results: formatted });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getSearchPage,
  getSuggest,
};
