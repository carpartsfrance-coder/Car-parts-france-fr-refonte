const mongoose = require('mongoose');

const Product = require('../models/Product');
const Category = require('../models/Category');
const LegalPage = require('../models/LegalPage');
const BlogPost = require('../models/BlogPost');
const demoProducts = require('../demoProducts');
const { buildProductPublicUrl, getPublicBaseUrlFromReq } = require('../services/productPublic');
const { buildCategoryPublicUrl } = require('../services/categoryPublic');
const { DEFAULT_LEGAL_PAGES } = require('../services/legalPages');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(value) {
  try {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch (err) {
    return '';
  }
}

async function getSitemapXml(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const baseUrl = getPublicBaseUrlFromReq(req);

    let products = [];
    let categories = [];
    let legalPages = [];
    let blogPosts = [];
    if (dbConnected) {
      products = await Product.find({})
        .select('_id slug name updatedAt')
        .sort({ updatedAt: -1 })
        .lean();

      categories = await Category.find({ isActive: true })
        .select('_id slug updatedAt')
        .sort({ sortOrder: 1, name: 1 })
        .lean();

      legalPages = await LegalPage.find({ isPublished: { $ne: false } })
        .select('_id slug updatedAt')
        .sort({ sortOrder: 1, title: 1 })
        .lean();

      blogPosts = await BlogPost.find({ isPublished: true })
        .select('_id slug updatedAt publishedAt')
        .sort({ publishedAt: -1, updatedAt: -1 })
        .lean();
    } else {
      products = (demoProducts || []).slice();

      const bySlug = new Map();
      for (const p of demoProducts || []) {
        const raw = p && typeof p.category === 'string' ? p.category.trim() : '';
        if (!raw) continue;
        const main = raw.includes('>') ? raw.split('>')[0].trim() : raw;
        const slug = main
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (!slug) continue;
        if (!bySlug.has(slug)) bySlug.set(slug, { slug, updatedAt: null });
      }
      categories = Array.from(bySlug.values());

      legalPages = (DEFAULT_LEGAL_PAGES || []).map((p) => ({ slug: p.slug, updatedAt: null }));
      blogPosts = [];
    }

    const urls = [];

    if (baseUrl) {
      urls.push({ loc: `${baseUrl}/`, lastmod: '' });
      urls.push({ loc: `${baseUrl}/produits`, lastmod: '' });
      urls.push({ loc: `${baseUrl}/categorie`, lastmod: '' });
      urls.push({ loc: `${baseUrl}/blog`, lastmod: '' });
      urls.push({ loc: `${baseUrl}/legal`, lastmod: '' });
    } else {
      urls.push({ loc: '/', lastmod: '' });
      urls.push({ loc: '/produits', lastmod: '' });
      urls.push({ loc: '/categorie', lastmod: '' });
      urls.push({ loc: '/blog', lastmod: '' });
      urls.push({ loc: '/legal', lastmod: '' });
    }

    for (const lp of legalPages || []) {
      if (!lp || !lp.slug) continue;
      const loc = baseUrl ? `${baseUrl}/legal/${encodeURIComponent(lp.slug)}` : `/legal/${encodeURIComponent(lp.slug)}`;
      urls.push({ loc, lastmod: toIsoDate(lp.updatedAt) });
    }

    for (const c of categories || []) {
      if (!c || !c.slug) continue;
      const loc = buildCategoryPublicUrl(c, { req });
      if (!loc) continue;
      urls.push({ loc, lastmod: toIsoDate(c.updatedAt) });
    }

    for (const p of products) {
      if (!p || !p._id) continue;
      const loc = buildProductPublicUrl(p, { req });
      if (!loc) continue;
      urls.push({ loc, lastmod: toIsoDate(p.updatedAt) });
    }

    for (const bp of blogPosts || []) {
      if (!bp || !bp.slug) continue;
      const path = `/blog/${encodeURIComponent(String(bp.slug))}`;
      const loc = baseUrl ? `${baseUrl}${path}` : path;
      const last = bp.updatedAt || bp.publishedAt || null;
      urls.push({ loc, lastmod: toIsoDate(last) });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map((u) => {
          const lastmod = u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : '';
          return `  <url>\n    <loc>${escapeXml(u.loc)}</loc>${lastmod}\n  </url>`;
        })
        .join('\n') +
      `\n</urlset>\n`;

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600');
    return res.status(200).send(xml);
  } catch (err) {
    return next(err);
  }
}

function getRobotsTxt(req, res) {
  const baseUrl = getPublicBaseUrlFromReq(req);
  const sitemapUrl = baseUrl ? `${baseUrl}/sitemap.xml` : '/sitemap.xml';

  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /panier',
    'Disallow: /commande',
    'Disallow: /compte',
    '',
    `Sitemap: ${sitemapUrl}`,
    '',
  ].join('\n');

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=600');
  return res.status(200).send(body);
}

module.exports = {
  getSitemapXml,
  getRobotsTxt,
};
