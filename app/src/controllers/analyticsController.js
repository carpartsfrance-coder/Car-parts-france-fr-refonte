const mongoose = require('mongoose');

const AnalyticsEvent = require('../models/AnalyticsEvent');

/* ------------------------------------------------------------------ */
/*  API: receive tracking events from frontend                        */
/* ------------------------------------------------------------------ */

async function postTrackEvent(req, res) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.status(204).end();

    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(204).end();

    const events = Array.isArray(body.events) ? body.events : (body.type ? [body] : []);
    if (events.length === 0) return res.status(204).end();

    // Limit batch size
    const batch = events.slice(0, 20);

    const docs = [];
    for (const ev of batch) {
      if (!ev || typeof ev.type !== 'string') continue;
      const type = ev.type.trim().slice(0, 40);
      if (!type) continue;

      docs.push({
        type,
        sessionId: sanitize(ev.sessionId, 64),
        source: sanitize(ev.source, 60),
        medium: sanitize(ev.medium, 60),
        campaign: sanitize(ev.campaign, 120),
        referrer: sanitize(ev.referrer, 500),
        page: sanitize(ev.page, 500),
        productId: isObjectId(ev.productId) ? ev.productId : null,
        productName: sanitize(ev.productName, 200),
        searchQuery: sanitize(ev.searchQuery, 200),
        searchResultCount: typeof ev.searchResultCount === 'number' ? Math.max(-1, Math.floor(ev.searchResultCount)) : -1,
        funnelStep: sanitize(ev.funnelStep, 40),
        interaction: sanitize(ev.interaction, 60),
        converted: ev.converted === true,
        deviceType: sanitize(ev.deviceType, 20),
      });
    }

    if (docs.length > 0) {
      await AnalyticsEvent.insertMany(docs, { ordered: false });
    }

    return res.status(204).end();
  } catch (err) {
    // Silent fail — analytics should never break the site
    console.error('[analytics] track error:', err.message);
    return res.status(204).end();
  }
}

/* ------------------------------------------------------------------ */
/*  Admin: analytics dashboard                                         */
/* ------------------------------------------------------------------ */

async function getAnalyticsDashboard(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    // Default to last 30 days
    const daysParam = parseInt(req.query.days, 10);
    const days = daysParam > 0 && daysParam <= 365 ? daysParam : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    let data = {
      days,
      conversionBySource: [],
      failedSearches: [],
      funnelSteps: [],
      productClicks: [],
      totalSessions: 0,
      totalPageviews: 0,
      totalSearches: 0,
    };

    if (dbConnected) {
      data = await buildDashboardData(since, days);
    }

    return res.render('admin/analytics', {
      active: 'analytics',
      ...data,
    });
  } catch (err) {
    return next(err);
  }
}

async function buildDashboardData(since, days) {
  // Run all aggregations in parallel
  const [
    conversionBySource,
    failedSearches,
    funnelRaw,
    productClicks,
    totals,
  ] = await Promise.all([
    // 1. Conversion rate by traffic source
    getConversionBySource(since),
    // 3. Searches with no results
    getFailedSearches(since),
    // 4. Funnel steps
    getFunnelSteps(since),
    // 5. Product interaction heatmap
    getProductClicks(since),
    // Totals
    getTotals(since),
  ]);

  return {
    days,
    conversionBySource,
    failedSearches,
    funnelSteps: funnelRaw,
    productClicks,
    ...totals,
  };
}

/* --- 1. Taux de conversion par source de trafic --- */
async function getConversionBySource(since) {
  // Get all sessions with their source and whether they converted
  const result = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since }, type: 'pageview' } },
    {
      $group: {
        _id: '$sessionId',
        source: { $first: '$source' },
        medium: { $first: '$medium' },
        converted: { $max: { $cond: ['$converted', 1, 0] } },
      },
    },
    {
      $group: {
        _id: { source: { $ifNull: ['$source', 'direct'] }, medium: { $ifNull: ['$medium', ''] } },
        sessions: { $sum: 1 },
        conversions: { $sum: '$converted' },
      },
    },
    { $sort: { sessions: -1 } },
    { $limit: 15 },
  ]);

  return result.map((r) => ({
    source: r._id.source || 'direct',
    medium: r._id.medium || '(none)',
    sessions: r.sessions,
    conversions: r.conversions,
    rate: r.sessions > 0 ? ((r.conversions / r.sessions) * 100).toFixed(1) : '0.0',
  }));
}

/* --- 3. Recherches sans résultat --- */
async function getFailedSearches(since) {
  const result = await AnalyticsEvent.aggregate([
    {
      $match: {
        createdAt: { $gte: since },
        type: 'search',
        searchResultCount: 0,
      },
    },
    {
      $group: {
        _id: { $toLower: '$searchQuery' },
        count: { $sum: 1 },
        lastSearched: { $max: '$createdAt' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 30 },
  ]);

  return result.map((r) => ({
    query: r._id,
    count: r.count,
    lastSearched: r.lastSearched,
  }));
}

/* --- 4. Taux d'abandon par étape du tunnel --- */
async function getFunnelSteps(since) {
  const stepOrder = ['landing', 'product_view', 'add_to_cart', 'checkout_shipping', 'checkout_payment', 'order_confirmed'];
  const stepLabels = {
    landing: 'Page d\'accueil',
    product_view: 'Fiche produit',
    add_to_cart: 'Ajout au panier',
    checkout_shipping: 'Livraison',
    checkout_payment: 'Paiement',
    order_confirmed: 'Commande confirmée',
  };

  const result = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since }, type: 'funnel_step' } },
    {
      $group: {
        _id: '$sessionId',
        steps: { $addToSet: '$funnelStep' },
      },
    },
  ]);

  // Count how many sessions reached each step
  const stepCounts = {};
  for (const step of stepOrder) stepCounts[step] = 0;

  for (const session of result) {
    for (const step of stepOrder) {
      if (session.steps.includes(step)) {
        stepCounts[step]++;
      }
    }
  }

  const totalSessions = stepCounts.landing || 1;

  return stepOrder.map((step, i) => {
    const count = stepCounts[step];
    const prev = i > 0 ? stepCounts[stepOrder[i - 1]] : count;
    const dropoff = prev > 0 ? (((prev - count) / prev) * 100).toFixed(1) : '0.0';

    return {
      step,
      label: stepLabels[step] || step,
      count,
      percentage: ((count / totalSessions) * 100).toFixed(1),
      dropoff: i === 0 ? '0.0' : dropoff,
    };
  });
}

/* --- 5. Clics / interactions sur les fiches produit --- */
async function getProductClicks(since) {
  const result = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since }, type: 'product_interaction' } },
    {
      $group: {
        _id: { interaction: '$interaction', productName: '$productName' },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);

  // Also get interaction summary (totals by type)
  const summary = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since }, type: 'product_interaction' } },
    {
      $group: {
        _id: '$interaction',
        count: { $sum: 1 },
        uniqueProducts: { $addToSet: '$productName' },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const interactionLabels = {
    image_click: 'Clic sur image',
    description_expand: 'Lecture description',
    compatibility_check: 'Vérif. compatibilité',
    faq_expand: 'Ouverture FAQ',
    add_to_cart_click: 'Clic ajout panier',
    specs_view: 'Consultation specs',
  };

  return {
    details: result.map((r) => ({
      interaction: r._id.interaction,
      interactionLabel: interactionLabels[r._id.interaction] || r._id.interaction,
      productName: r._id.productName,
      count: r.count,
    })),
    summary: summary.map((r) => ({
      interaction: r._id,
      label: interactionLabels[r._id] || r._id,
      count: r.count,
      uniqueProducts: r.uniqueProducts ? r.uniqueProducts.length : 0,
    })),
  };
}

/* --- Totals --- */
async function getTotals(since) {
  const [pageviews, sessions, searches] = await Promise.all([
    AnalyticsEvent.countDocuments({ type: 'pageview', createdAt: { $gte: since } }),
    AnalyticsEvent.distinct('sessionId', { type: 'pageview', createdAt: { $gte: since } }).then((r) => r.length),
    AnalyticsEvent.countDocuments({ type: 'search', createdAt: { $gte: since } }),
  ]);

  return {
    totalPageviews: pageviews,
    totalSessions: sessions,
    totalSearches: searches,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sanitize(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function isObjectId(value) {
  if (!value) return false;
  return mongoose.Types.ObjectId.isValid(value);
}

module.exports = {
  postTrackEvent,
  getAnalyticsDashboard,
};
