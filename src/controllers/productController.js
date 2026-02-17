const mongoose = require('mongoose');

const Product = require('../models/Product');
const Category = require('../models/Category');
const BlogPost = require('../models/BlogPost');
const demoProducts = require('../demoProducts');
const sanitizeHtml = require('sanitize-html');
const { markdownToHtml } = require('../services/blogContent');
const {
  buildProductPublicPath,
  buildProductPublicUrl,
  getPublicBaseUrlFromReq,
} = require('../services/productPublic');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNumberOrNull(value) {
  if (typeof value !== 'string') return null;
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseNumberFromLooseString(value) {
  if (typeof value !== 'string') return null;

  const cleaned = value
    .replace(/[\s\u00A0]/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  let normalized = cleaned;

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseLegacyPriceCents(product) {
  if (Number.isFinite(product.priceCents)) return product.priceCents;
  if (typeof product.priceCents === 'string') {
    const parsed = parseNumberFromLooseString(product.priceCents);
    if (parsed !== null) {
      if (parsed >= 50000) return Math.round(parsed);
      return Math.round(parsed * 100);
    }
  }

  const legacy =
    product.price ??
    product.priceEuro ??
    product.priceEuros ??
    product.prix ??
    null;

  if (typeof legacy === 'number' && Number.isFinite(legacy)) {
    if (legacy >= 50000) return Math.round(legacy);
    return Math.round(legacy * 100);
  }

  if (typeof legacy === 'string') {
    const parsed = parseNumberFromLooseString(legacy);
    if (parsed === null) return 0;
    if (parsed >= 50000) return Math.round(parsed);
    return Math.round(parsed * 100);
  }

  return 0;
}

function normalizeProduct(product) {
  if (!product) return product;

  let stockQty = null;
  if (Number.isFinite(product.stockQty)) {
    stockQty = product.stockQty;
  } else if (typeof product.stockQty === 'string') {
    const trimmed = product.stockQty.trim();
    if (trimmed) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n >= 0) {
        stockQty = Math.floor(n);
      }
    }
  }

  const inStock =
    stockQty !== null
      ? stockQty > 0
      :
    product.inStock === false ||
    product.inStock === 'false' ||
    product.inStock === 0 ||
    product.inStock === '0'
      ? false
      : true;

  const rawConsigne = product.consigne && typeof product.consigne === 'object'
    ? product.consigne
    : {};
  const consigneEnabled = rawConsigne.enabled === true;
  const consigneAmountCents = Number.isFinite(rawConsigne.amountCents) && rawConsigne.amountCents >= 0
    ? Math.floor(rawConsigne.amountCents)
    : 0;
  const consigneDelayDays = Number.isFinite(rawConsigne.delayDays) && rawConsigne.delayDays >= 0
    ? Math.floor(rawConsigne.delayDays)
    : 30;

  const compareAtPriceCents =
    Number.isFinite(product.compareAtPriceCents) && product.compareAtPriceCents >= 0
      ? product.compareAtPriceCents
      : null;

  const badges =
    product.badges && typeof product.badges === 'object'
      ? {
          topLeft: typeof product.badges.topLeft === 'string' ? product.badges.topLeft.trim() : '',
          condition: typeof product.badges.condition === 'string' ? product.badges.condition.trim() : '',
        }
      : { topLeft: '', condition: '' };

  const galleryUrls = Array.isArray(product.galleryUrls)
    ? product.galleryUrls.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
    : [];

  const keyPoints = Array.isArray(product.keyPoints)
    ? product.keyPoints.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
    : [];

  const specs = Array.isArray(product.specs)
    ? product.specs
        .filter((s) => s && (s.label || s.value))
        .map((s) => ({
          label: typeof s.label === 'string' ? s.label.trim() : '',
          value: typeof s.value === 'string' ? s.value.trim() : '',
        }))
        .filter((s) => s.label && s.value)
    : [];

  const reconditioningSteps = Array.isArray(product.reconditioningSteps)
    ? product.reconditioningSteps
        .filter((s) => s && (s.title || s.description))
        .map((s) => ({
          title: typeof s.title === 'string' ? s.title.trim() : '',
          description: typeof s.description === 'string' ? s.description.trim() : '',
        }))
        .filter((s) => s.title && s.description)
    : [];

  const compatibility = Array.isArray(product.compatibility)
    ? product.compatibility
        .filter((c) => c && (c.make || c.model || c.years || c.engine))
        .map((c) => ({
          make: typeof c.make === 'string' ? c.make.trim() : '',
          model: typeof c.model === 'string' ? c.model.trim() : '',
          years: typeof c.years === 'string' ? c.years.trim() : '',
          engine: typeof c.engine === 'string' ? c.engine.trim() : '',
        }))
        .filter((c) => c.make || c.model || c.years || c.engine)
    : [];

  const faqs = Array.isArray(product.faqs)
    ? product.faqs
        .filter((f) => f && (f.question || f.answer))
        .map((f) => ({
          question: typeof f.question === 'string' ? f.question.trim() : '',
          answer: typeof f.answer === 'string' ? f.answer.trim() : '',
        }))
        .filter((f) => f.question && f.answer)
    : [];

  const media =
    product.media && typeof product.media === 'object'
      ? {
          videoUrl: typeof product.media.videoUrl === 'string' ? product.media.videoUrl.trim() : '',
        }
      : { videoUrl: '' };

  const shippingDelayText = typeof product.shippingDelayText === 'string'
    ? product.shippingDelayText.trim()
    : '';

  const compatibleReferences = Array.isArray(product.compatibleReferences)
    ? product.compatibleReferences
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

  const rawSections = product.sections && typeof product.sections === 'object' ? product.sections : {};
  const sections = {
    showKeyPoints: rawSections.showKeyPoints !== false,
    showSpecs: rawSections.showSpecs !== false,
    showReconditioning: rawSections.showReconditioning !== false,
    showCompatibility: rawSections.showCompatibility !== false,
    showFaq: rawSections.showFaq !== false,
    showVideo: rawSections.showVideo !== false,
    showSupportBox: rawSections.showSupportBox !== false,
    showRelatedProducts: rawSections.showRelatedProducts !== false,
  };

  return {
    ...product,
    inStock,
    stockQty,
    shippingDelayText,
    compatibleReferences,
    priceCents: parseLegacyPriceCents(product),
    consigne: {
      enabled: consigneEnabled,
      amountCents: consigneAmountCents,
      delayDays: consigneDelayDays,
    },
    compareAtPriceCents,
    badges,
    galleryUrls,
    shortDescription: typeof product.shortDescription === 'string' ? product.shortDescription.trim() : '',
    description: typeof product.description === 'string' ? product.description.trim() : '',
    keyPoints,
    specs,
    reconditioningSteps,
    compatibility,
    faqs,
    relatedBlogPostIds: Array.isArray(product.relatedBlogPostIds)
      ? product.relatedBlogPostIds.map((id) => String(id))
      : [],
    media,
    sections,
  };
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

function normalizeImportedText(value) {
  if (typeof value !== 'string') return '';
  let out = value;
  if (out.includes('\\n')) {
    out = out.replace(/\\n/g, '\n');
  }
  out = out.replace(/\r\n?/g, '\n');
  out = out.replace(/^\s*•\s+/gm, '- ');
  return out;
}

function looksLikeHtml(value) {
  const input = typeof value === 'string' ? value : '';
  return /<\/?[a-z][\s\S]*>/i.test(input);
}

function toPlainText(value) {
  const normalized = normalizeImportedText(typeof value === 'string' ? value : '');
  const noHtml = stripHtml(normalized);
  return stripMarkdown(noHtml);
}

function estimateReadingTimeMinutes(text) {
  const plain = stripMarkdown(stripHtml(text));
  if (!plain) return 0;
  const words = plain.split(/\s+/).filter(Boolean).length;
  const minutes = words / 190;
  const rounded = Math.max(1, Math.round(minutes));
  return Math.min(120, rounded);
}

function formatDateFRShort(value) {
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

function sanitizeProductHtml(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';

  return sanitizeHtml(raw, {
    allowedTags: [
      'p', 'br', 'hr',
      'strong', 'b', 'em', 'i', 'u',
      'ul', 'ol', 'li',
      'h2', 'h3', 'h4',
      'blockquote',
      'a',
      'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'loading'],
      span: ['class'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener', target: '_blank' }),
    },
    disallowedTagsMode: 'discard',
    allowVulnerableTags: false,
  });
}

function resolveAbsoluteUrl(req, rawUrl) {
  const input = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!input) return '';
  if (/^https?:\/\//i.test(input)) return input;

  const base = getPublicBaseUrlFromReq(req);
  if (!base) return input;
  if (input.startsWith('/')) return `${base}${input}`;
  return `${base}/${input}`;
}

async function listProducts(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let selectedVehicleMake = typeof req.query.vehicleMake === 'string' ? req.query.vehicleMake.trim() : '';
    let selectedVehicleModel = typeof req.query.vehicleModel === 'string' ? req.query.vehicleModel.trim() : '';
    const legacySelectedCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    let selectedMainCategory = typeof req.query.mainCategory === 'string' ? req.query.mainCategory.trim() : '';
    let selectedSubCategory = typeof req.query.subCategory === 'string' ? req.query.subCategory.trim() : '';

    if (!selectedMainCategory && legacySelectedCategory) {
      const parts = legacySelectedCategory
        .split('>')
        .map((p) => String(p || '').trim())
        .filter(Boolean);

      if (parts.length >= 1) {
        selectedMainCategory = parts[0];
        selectedSubCategory = parts.slice(1).join(' > ').trim();
      }
    }

    if (!selectedMainCategory) {
      selectedSubCategory = '';
    }

    let selectedCategoryLabel = selectedSubCategory
      ? `${selectedMainCategory} > ${selectedSubCategory}`
      : selectedMainCategory;
    const selectedStock = typeof req.query.stock === 'string' ? req.query.stock.trim() : '';
    const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';

    let page = 1;
    if (typeof req.query.page === 'string') {
      const parsedPage = Number(req.query.page);
      if (Number.isFinite(parsedPage) && parsedPage >= 1) {
        page = Math.floor(parsedPage);
      }
    }

    const perPage = 12;

    const minPriceEuros = toNumberOrNull(req.query.minPrice);
    const maxPriceEuros = toNumberOrNull(req.query.maxPrice);

    let categories = [
      'Moteur',
      'Transmission',
      'Carrosserie / Éclairage',
      'Électricité / Électronique',
      'Freinage',
      'Suspension / Direction',
      'Habitacle',
      'Entretien',
      'Autre',
    ];

    let mainCategories = categories.slice();
    let subCategoriesByMain = {};

    if (dbConnected) {
      const dbCategories = await Category.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .select('_id name sortOrder')
        .lean();

      const productCategoryCounts = await Product.aggregate([
        { $match: { category: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);

      const usedCountByCategory = new Map();
      const usedMainSet = new Set();
      for (const row of productCategoryCounts) {
        const key = typeof row._id === 'string' ? row._id.trim() : '';
        const count = Number.isFinite(row.count) ? row.count : 0;
        if (!key || count <= 0) continue;

        usedCountByCategory.set(key, count);

        const parts = key
          .split('>')
          .map((p) => String(p || '').trim())
          .filter(Boolean);
        const main = parts[0] || '';
        if (main) usedMainSet.add(main);
      }

      if (dbCategories.length > 0) {
        categories = dbCategories
          .map((c) => (typeof c.name === 'string' ? c.name.trim() : ''))
          .filter(Boolean);

        const mains = [];
        const mainSet = new Set();
        const subsMap = {};

        for (const c of dbCategories) {
          const name = typeof c.name === 'string' ? c.name.trim() : '';
          if (!name) continue;

          const parts = name
            .split('>')
            .map((p) => p.trim())
            .filter(Boolean);
          const main = parts[0] || '';
          const sub = parts.length > 1 ? parts.slice(1).join(' > ').trim() : '';
          if (!main) continue;

          const isUsedMain = usedMainSet.size ? usedMainSet.has(main) : true;
          if (!isUsedMain) continue;

          if (!mainSet.has(main)) {
            mainSet.add(main);
            mains.push(main);
          }

          if (sub) {
            const fullName = `${main} > ${sub}`;
            const isUsedSub = usedCountByCategory.size ? (usedCountByCategory.get(fullName) || 0) > 0 : true;
            if (!isUsedSub) continue;

            if (!subsMap[main]) subsMap[main] = [];
            if (!subsMap[main].includes(sub)) subsMap[main].push(sub);
          }
        }

        if (mains.length > 0) {
          mainCategories = mains;
        }
        subCategoriesByMain = subsMap;
      }
    }

    if (selectedMainCategory && Array.isArray(mainCategories) && !mainCategories.includes(selectedMainCategory)) {
      selectedMainCategory = '';
      selectedSubCategory = '';
    }

    if (selectedMainCategory) {
      const subOptions = selectedMainCategory && subCategoriesByMain
        ? (subCategoriesByMain[selectedMainCategory] || [])
        : [];

      if (selectedSubCategory && Array.isArray(subOptions) && !subOptions.includes(selectedSubCategory)) {
        selectedSubCategory = '';
      }
    }

    selectedCategoryLabel = selectedSubCategory
      ? `${selectedMainCategory} > ${selectedSubCategory}`
      : selectedMainCategory;

    const minPriceCents =
      minPriceEuros !== null ? Math.round(minPriceEuros * 100) : null;
    const maxPriceCents =
      maxPriceEuros !== null ? Math.round(maxPriceEuros * 100) : null;

    let products = [];
    let totalCount = 0;

    const filter = {};
    if (searchQuery) {
      filter.name = { $regex: escapeRegex(searchQuery), $options: 'i' };
    }

    if (selectedVehicleMake || selectedVehicleModel) {
      const elem = {};
      if (selectedVehicleMake) {
        elem.make = { $regex: escapeRegex(selectedVehicleMake), $options: 'i' };
      }
      if (selectedVehicleModel) {
        elem.model = { $regex: escapeRegex(selectedVehicleModel), $options: 'i' };
      }
      filter.compatibility = { $elemMatch: elem };
    }

    if (selectedMainCategory) {
      if (selectedSubCategory) {
        filter.category = `${selectedMainCategory} > ${selectedSubCategory}`;
      } else {
        const rx = `^${escapeRegex(selectedMainCategory)}(\\s*>|$)`;
        filter.category = { $regex: new RegExp(rx) };
      }
    }

    if (selectedStock === 'in') {
      filter.$or = [{ stockQty: { $gt: 0 } }, { stockQty: null, inStock: true }];
    }

    const priceFilter = {};
    if (minPriceEuros !== null) {
      priceFilter.$gte = Math.round(minPriceEuros * 100);
    }
    if (maxPriceEuros !== null) {
      priceFilter.$lte = Math.round(maxPriceEuros * 100);
    }
    if (Object.keys(priceFilter).length > 0) {
      filter.priceCents = priceFilter;
    }

    let vehicleMakes = [];
    let vehicleModelsByMake = {};
    if (dbConnected) {
      const rows = await Product.aggregate([
        { $unwind: '$compatibility' },
        {
          $match: {
            'compatibility.make': { $type: 'string', $ne: '' },
          },
        },
        {
          $project: {
            make: { $trim: { input: '$compatibility.make' } },
            model: { $trim: { input: '$compatibility.model' } },
          },
        },
        {
          $group: {
            _id: {
              make: '$make',
              model: '$model',
            },
          },
        },
      ]);

      const map = new Map();
      for (const r of rows) {
        const make = r && r._id && typeof r._id.make === 'string' ? r._id.make.trim() : '';
        const model = r && r._id && typeof r._id.model === 'string' ? r._id.model.trim() : '';
        if (!make) continue;
        if (!map.has(make)) map.set(make, new Set());
        if (model) map.get(make).add(model);
      }

      vehicleMakes = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
      vehicleModelsByMake = {};
      for (const mk of vehicleMakes) {
        const set = map.get(mk);
        vehicleModelsByMake[mk] = set ? Array.from(set).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })) : [];
      }
    } else {
      const map = new Map();
      for (const p of Array.isArray(demoProducts) ? demoProducts : []) {
        const compat = Array.isArray(p.compatibility) ? p.compatibility : [];
        for (const c of compat) {
          const make = c && typeof c.make === 'string' ? c.make.trim() : '';
          const model = c && typeof c.model === 'string' ? c.model.trim() : '';
          if (!make) continue;
          if (!map.has(make)) map.set(make, new Set());
          if (model) map.get(make).add(model);
        }
      }

      vehicleMakes = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
      vehicleModelsByMake = {};
      for (const mk of vehicleMakes) {
        const set = map.get(mk);
        vehicleModelsByMake[mk] = set ? Array.from(set).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })) : [];
      }
    }

    if (selectedVehicleMake && vehicleMakes.length) {
      const needle = selectedVehicleMake.toLowerCase();
      const match = vehicleMakes.find((mk) => String(mk).toLowerCase() === needle);
      if (match) selectedVehicleMake = match;
    }
    if (selectedVehicleModel && selectedVehicleMake && vehicleModelsByMake[selectedVehicleMake]) {
      const models = Array.isArray(vehicleModelsByMake[selectedVehicleMake]) ? vehicleModelsByMake[selectedVehicleMake] : [];
      const needle = selectedVehicleModel.toLowerCase();
      const match = models.find((md) => String(md).toLowerCase() === needle);
      if (match) selectedVehicleModel = match;
    }

    let sortSpec = { createdAt: -1 };
    if (sort === 'price_asc') sortSpec = { priceCents: 1 };
    if (sort === 'price_desc') sortSpec = { priceCents: -1 };
    if (sort === 'newest') sortSpec = { createdAt: -1 };

    if (dbConnected) {
      totalCount = await Product.countDocuments(filter);

      const totalPagesRaw = Math.max(1, Math.ceil(totalCount / perPage));
      if (page > totalPagesRaw) page = totalPagesRaw;

      products = await Product.find(filter)
        .sort(sortSpec)
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean();

      products = products.map(normalizeProduct);

      const noFilters =
        !searchQuery &&
        !selectedMainCategory &&
        !selectedSubCategory &&
        !selectedStock &&
        minPriceCents === null &&
        maxPriceCents === null;

      if (totalCount === 0 && noFilters) {
        totalCount = demoProducts.length;
        const totalPagesRaw = Math.max(1, Math.ceil(totalCount / perPage));
        if (page > totalPagesRaw) page = totalPagesRaw;
        products = demoProducts
          .slice((page - 1) * perPage, page * perPage)
          .map(normalizeProduct);
      }
    } else {
      const q = searchQuery.toLowerCase();

      products = demoProducts
        .filter((p) => {
          if (searchQuery) {
            const haystack = `${p.name} ${p.brand || ''} ${p.sku || ''}`.toLowerCase();
            if (!haystack.includes(q)) return false;
          }

          if (selectedVehicleMake || selectedVehicleModel) {
            const compat = Array.isArray(p.compatibility) ? p.compatibility : [];
            const mk = String(selectedVehicleMake || '').toLowerCase();
            const md = String(selectedVehicleModel || '').toLowerCase();
            const ok = compat.some((c) => {
              if (!c) return false;
              const cMake = String(c.make || '').toLowerCase();
              const cModel = String(c.model || '').toLowerCase();
              if (mk && !cMake.includes(mk)) return false;
              if (md && !cModel.includes(md)) return false;
              return true;
            });
            if (!ok) return false;
          }

          if (selectedMainCategory) {
            if (selectedSubCategory) {
              const full = `${selectedMainCategory} > ${selectedSubCategory}`;
              if (p.category !== full) return false;
            } else {
              if (p.category !== selectedMainCategory && !String(p.category || '').startsWith(`${selectedMainCategory} >`)) {
                return false;
              }
            }
          }
          if (selectedStock === 'in' && !p.inStock) return false;

          if (minPriceCents !== null && p.priceCents < minPriceCents) return false;
          if (maxPriceCents !== null && p.priceCents > maxPriceCents) return false;

          return true;
        })
        .slice()
        .map(normalizeProduct);

      totalCount = products.length;

      const totalPagesRaw = Math.max(1, Math.ceil(totalCount / perPage));
      if (page > totalPagesRaw) page = totalPagesRaw;

      if (sort === 'price_asc') {
        products.sort((a, b) => a.priceCents - b.priceCents);
      }

      if (sort === 'price_desc') {
        products.sort((a, b) => b.priceCents - a.priceCents);
      }

      products = products.slice((page - 1) * perPage, page * perPage);
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

    const productsWithPublicPath = (products || []).map((p) => ({
      ...p,
      publicPath: buildProductPublicPath(p),
    }));

    const baseUrl = getPublicBaseUrlFromReq(req);
    const canonicalUrl = baseUrl ? `${baseUrl}/produits` : '/produits';

    const hasAnyFilter =
      !!searchQuery ||
      !!selectedVehicleMake ||
      !!selectedVehicleModel ||
      !!selectedMainCategory ||
      !!selectedSubCategory ||
      !!selectedStock ||
      minPriceEuros !== null ||
      maxPriceEuros !== null ||
      (!!sort && sort !== 'newest') ||
      (Number(page) || 1) > 1;

    const metaRobots = hasAnyFilter ? 'noindex, follow' : '';

    const titleParts = [];
    if (selectedCategoryLabel) titleParts.push(String(selectedCategoryLabel));
    if (searchQuery) titleParts.push(`Recherche: ${searchQuery}`);
    const titleSuffix = titleParts.length ? ` (${titleParts.join(' • ')})` : '';
    const title = `Catalogue pièces auto${titleSuffix} - CarParts France`;

    const metaDescription = 'Catalogue de pièces auto : recherche par référence, marque et catégorie. Livraison rapide. Paiement sécurisé.';

    return res.render('products/index', {
      title,
      metaDescription,
      canonicalUrl,
      ogTitle: title,
      ogDescription: metaDescription,
      ogUrl: canonicalUrl,
      metaRobots,
      dbConnected,
      searchQuery,
      selectedVehicleMake,
      selectedVehicleModel,
      vehicleMakes,
      vehicleModelsByMake,
      selectedMainCategory,
      selectedSubCategory,
      selectedCategoryLabel,
      selectedStock,
      minPriceEuros,
      maxPriceEuros,
      sort,
      categories,
      mainCategories,
      subCategoriesByMain,
      returnTo: req.originalUrl,
      products: productsWithPublicPath,
      page,
      perPage,
      totalCount,
      totalPages,
    });
  } catch (err) {
    return next(err);
  }
}

async function getProduct(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const rawParam = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const id = rawParam.includes('-') ? rawParam.split('-').pop() : rawParam;

    let product = null;

    if (dbConnected) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(404).render('errors/404', {
          title: 'Page introuvable - CarParts France',
        });
      }

      product = await Product.findById(id).lean();

      product = normalizeProduct(product);

      if (!product) {
        product =
          demoProducts.find((p) => String(p._id) === String(id)) || null;
        product = normalizeProduct(product);
      }
    } else {
      product = demoProducts.find((p) => String(p._id) === String(id)) || null;
      product = normalizeProduct(product);

      if (!product) {
        return res.render('products/show', {
          title: 'Produit - CarParts France',
          dbConnected,
          returnTo: req.originalUrl,
          product: null,
          relatedProducts: [],
        });
      }
    }

    if (!product) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const canonicalPath = buildProductPublicPath(product);
    const requestedPath = `${req.baseUrl || ''}${req.path || ''}`;
    if (canonicalPath && requestedPath && canonicalPath !== requestedPath) {
      return res.redirect(301, canonicalPath);
    }

    const canonicalUrl = buildProductPublicUrl(product, { req });
    const brandText = typeof product.brand === 'string' ? product.brand.trim() : '';
    const skuText = typeof product.sku === 'string' ? product.sku.trim() : '';
    const compatibleReferences = Array.isArray(product.compatibleReferences)
      ? product.compatibleReferences
          .filter((v) => typeof v === 'string' && v.trim())
          .map((v) => v.trim())
      : [];

    const firstCompat = Array.isArray(product.compatibility)
      ? product.compatibility.find((c) => c && (c.make || c.model || c.engine))
      : null;
    const compatText = firstCompat
      ? [firstCompat.make, firstCompat.model, firstCompat.engine].filter(Boolean).join(' ')
      : '';

    const titleOverride = product.seo && typeof product.seo.metaTitle === 'string'
      ? product.seo.metaTitle.trim()
      : '';

    const seoTitle = titleOverride
      ? titleOverride
      : `${product.name}${brandText ? ` - ${brandText}` : ''}${skuText ? ` (Réf ${skuText})` : ''} | CarParts France`;

    const descriptionOverride = product.seo && typeof product.seo.metaDescription === 'string'
      ? product.seo.metaDescription.trim()
      : '';
    const baseDesc = product.shortDescription || product.description || '';
    const baseDescPlain = toPlainText(baseDesc);
    const refsText = compatibleReferences.length ? compatibleReferences.slice(0, 6).join(', ') : '';
    const autoDesc = `Pièce auto ${product.name}${skuText ? ` (réf ${skuText})` : ''}${refsText ? ` (références compatibles ${refsText})` : ''}${compatText ? ` compatible ${compatText}` : ''}. Livraison rapide. Paiement sécurisé.`;
    const metaDescription = truncateText(normalizeMetaText(toPlainText(descriptionOverride) || baseDescPlain || autoDesc), 160);

    const images = [];
    if (product.imageUrl) images.push(product.imageUrl);
    if (Array.isArray(product.galleryUrls)) {
      for (const u of product.galleryUrls) {
        if (typeof u === 'string' && u.trim()) images.push(u.trim());
      }
    }
    const mainImage = images.find(Boolean) || '';
    const ogImage = resolveAbsoluteUrl(req, mainImage);

    const price = Number.isFinite(product.priceCents) ? (product.priceCents / 100).toFixed(2) : undefined;
    const descriptionForSchema = normalizeMetaText(toPlainText(product.description || product.shortDescription || autoDesc));

    const schemaProduct = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: truncateText(descriptionForSchema, 5000),
      sku: skuText || undefined,
      mpn: compatibleReferences.length ? compatibleReferences[0] : undefined,
      brand: brandText ? { '@type': 'Brand', name: brandText } : undefined,
      image: images.filter(Boolean).slice(0, 8).map((u) => resolveAbsoluteUrl(req, u)),
      additionalProperty: compatibleReferences.length
        ? compatibleReferences.map((r) => ({ '@type': 'PropertyValue', name: 'Référence compatible', value: r }))
        : undefined,
      offers: {
        '@type': 'Offer',
        url: canonicalUrl,
        priceCurrency: 'EUR',
        price,
        availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    };

    const jsonLd = JSON.stringify(schemaProduct)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');

    let relatedProducts = [];
    let relatedBlogPosts = [];

    if (dbConnected) {
      const relatedFilter = { _id: { $ne: id } };
      if (product.category) {
        relatedFilter.category = product.category;
      }

      relatedProducts = await Product.find(relatedFilter)
        .sort({ updatedAt: -1 })
        .limit(4)
        .lean();

      relatedProducts = relatedProducts.map(normalizeProduct);

      if (relatedProducts.length < 4) {
        const already = relatedProducts.map((p) => String(p._id));
        const fallbackFilter = { _id: { $nin: [id, ...already] } };

        const fallback = await Product.find(fallbackFilter)
          .sort({ updatedAt: -1 })
          .limit(4 - relatedProducts.length)
          .lean();

        relatedProducts = relatedProducts.concat(fallback.map(normalizeProduct));
      }

      const mappedBlogCard = (b) => {
          const publishedAt = b.publishedAt || b.createdAt || null;
          const minutes = Number.isFinite(b.readingTimeMinutes) && b.readingTimeMinutes > 0
            ? b.readingTimeMinutes
            : estimateReadingTimeMinutes(b.contentHtml || '');
          const excerpt = (b.excerpt || '').trim() || truncateText(stripHtml(b.contentHtml || ''), 140);
          const categoryLabel = b.category && b.category.label
            ? String(b.category.label).trim()
            : (b.category && b.category.slug ? String(b.category.slug).trim() : 'Blog');

          return {
            id: String(b._id),
            slug: String(b.slug),
            title: b.title || '',
            excerpt,
            imageUrl: b.coverImageUrl || '',
            categoryLabel,
            dateLabel: formatDateFRShort(publishedAt),
            readTimeLabel: `${minutes} min`,
            url: `/blog/${encodeURIComponent(String(b.slug))}`,
          };
      };

      const blogProjection = 'slug title excerpt coverImageUrl category publishedAt createdAt readingTimeMinutes contentHtml';

      const chosenIds = Array.isArray(product.relatedBlogPostIds) ? product.relatedBlogPostIds : [];
      const chosenObjectIds = chosenIds
        .filter((v) => mongoose.Types.ObjectId.isValid(v))
        .map((v) => new mongoose.Types.ObjectId(v));

      const chosenDocs = chosenObjectIds.length
        ? await BlogPost.find({ _id: { $in: chosenObjectIds }, isPublished: true })
            .select(`_id ${blogProjection}`)
            .lean()
        : [];

      const chosenById = new Map((chosenDocs || []).map((d) => [String(d._id), d]));
      const chosenOrdered = chosenObjectIds
        .map((oid) => chosenById.get(String(oid)))
        .filter(Boolean);

      const fromArticlesDocs = await BlogPost.find({
        isPublished: true,
        relatedProductIds: new mongoose.Types.ObjectId(id),
      })
        .sort({ publishedAt: -1, createdAt: -1 })
        .limit(6)
        .select(`_id ${blogProjection}`)
        .lean();

      const merged = [];
      const seen = new Set();
      for (const d of chosenOrdered) {
        const key = d && d._id ? String(d._id) : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(d);
      }
      for (const d of (fromArticlesDocs || [])) {
        const key = d && d._id ? String(d._id) : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(d);
      }

      relatedBlogPosts = merged
        .filter((b) => b && b.slug)
        .slice(0, 3)
        .map(mappedBlogCard);
    } else {
      relatedProducts = demoProducts
        .filter((p) => String(p._id) !== String(id))
        .slice(0, 4)
        .map(normalizeProduct);
    }

    relatedProducts = (relatedProducts || []).map((p) => ({
      ...p,
      publicPath: buildProductPublicPath(p),
    }));

    const descriptionRaw = product.description || product.shortDescription || '';
    const descriptionNormalized = normalizeImportedText(descriptionRaw);
    const htmlCandidate = looksLikeHtml(descriptionNormalized)
      ? descriptionNormalized
      : markdownToHtml(descriptionNormalized);
    const safeDescriptionHtml = sanitizeProductHtml(htmlCandidate);

    product = {
      ...product,
      publicPath: canonicalPath,
      descriptionHtmlSafe: safeDescriptionHtml,
      descriptionText: toPlainText(descriptionRaw),
    };

    return res.render('products/show', {
      title: seoTitle,
      metaDescription,
      canonicalUrl,
      ogTitle: seoTitle,
      ogDescription: metaDescription,
      ogUrl: canonicalUrl,
      ogImage,
      ogType: 'product',
      jsonLd,
      dbConnected,
      returnTo: req.originalUrl,
      product,
      relatedProducts,
      relatedBlogPosts,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listProducts,
  getProduct,
};
