const mongoose = require('mongoose');

const BlogPost = require('../models/BlogPost');
const Product = require('../models/Product');
const demoProducts = require('../demoProducts');
const { buildProductPublicPath } = require('../services/productPublic');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function truncateText(value, max) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return '';
  if (!Number.isFinite(max) || max <= 0) return input;
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function estimateReadingTimeMinutes(text) {
  const plain = stripHtml(text);
  if (!plain) return 0;
  const words = plain.split(/\s+/).filter(Boolean).length;
  const minutes = words / 190;
  const floored = Math.max(1, Math.round(minutes));
  return Math.min(120, floored);
}

function formatDateFR(value) {
  try {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(d);
  } catch (e) {
    return '';
  }
}

async function getHome(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    let featuredProducts = [];
    if (dbConnected) {
      featuredProducts = await Product.find({})
        .sort({ updatedAt: -1 })
        .limit(8)
        .lean();
    } else {
      featuredProducts = Array.isArray(demoProducts) ? demoProducts.slice(0, 8) : [];
    }

    const featuredProductsView = (featuredProducts || []).map((p) => ({
      ...p,
      publicPath: buildProductPublicPath(p),
    }));

    let homeBlogPosts = [];
    if (dbConnected) {
      const pinned = await BlogPost.find({ isPublished: true, isHomeFeatured: true })
        .sort({ publishedAt: -1, createdAt: -1 })
        .limit(3)
        .lean();

      const pinnedSlugs = new Set((pinned || []).map((p) => String(p && p.slug ? p.slug : '')).filter(Boolean));

      const fill = pinnedSlugs.size < 3
        ? await BlogPost.find({
            isPublished: true,
            ...(pinnedSlugs.size ? { slug: { $nin: Array.from(pinnedSlugs) } } : {}),
          })
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(Math.max(0, 3 - pinnedSlugs.size))
            .lean()
        : [];

      const combined = ([]
        .concat(pinned || [])
        .concat(fill || []))
        .slice(0, 3);

      homeBlogPosts = combined.map((d) => {
        const publishedAt = d && d.publishedAt ? d.publishedAt : d && d.createdAt ? d.createdAt : null;
        const minutes = Number.isFinite(d && d.readingTimeMinutes) && d.readingTimeMinutes > 0
          ? d.readingTimeMinutes
          : estimateReadingTimeMinutes(getTrimmedString(d && d.contentHtml));

        const excerpt = getTrimmedString(d && d.excerpt)
          || truncateText(stripHtml(getTrimmedString(d && d.contentHtml)), 140);

        const categoryLabel = d && d.category && d.category.label
          ? getTrimmedString(d.category.label)
          : (d && d.category && d.category.slug ? getTrimmedString(d.category.slug) : 'Blog');

        return {
          slug: getTrimmedString(d && d.slug),
          title: getTrimmedString(d && d.title),
          excerpt,
          imageUrl: getTrimmedString(d && d.coverImageUrl),
          categoryLabel,
          dateLabel: formatDateFR(publishedAt),
          readTimeLabel: `${minutes} min de lecture`,
          url: `/blog/${encodeURIComponent(getTrimmedString(d && d.slug))}`,
        };
      });
    }

    return res.render('home', {
      title: 'CarParts France - Pièces Détachées de Qualité',
      dbConnected,
      featuredProducts: featuredProductsView,
      homeBlogPosts,
    });
  } catch (err) {
    return next(err);
  }
}

async function redirectLegacyBlogSlug(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return next();

    const slug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
    if (!slug) return next();

    const reserved = new Set([
      'produits',
      'categorie',
      'blog',
      'rechercher',
      'panier',
      'commande',
      'compte',
      'admin',
      'legal',
      'sitemap.xml',
      'robots.txt',
      'favicon.ico',
    ]);
    if (reserved.has(slug)) return next();

    const exists = await BlogPost.findOne({ slug, isPublished: true })
      .select('_id slug')
      .lean();

    if (!exists) return next();

    return res.redirect(301, `/blog/${encodeURIComponent(slug)}`);
  } catch (err) {
    return next();
  }
}

module.exports = {
  getHome,
  redirectLegacyBlogSlug,
};
