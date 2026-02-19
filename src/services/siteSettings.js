const SiteSettings = require('../models/SiteSettings');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : value ? String(value).trim() : '';
}

function buildEnvFallback() {
  return {
    promoBannerText:
      getTrimmedString(process.env.PROMO_BANNER_TEXT) ||
      'Offre Spéciale : -5% sur toute commande cette semaine avec le code :',
    promoBannerCode: getTrimmedString(process.env.PROMO_BANNER_CODE) || 'PROMO5',
  };
}

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30 * 1000;

async function getSiteSettings() {
  const doc = await SiteSettings.findOne({ key: 'site' }).lean();
  return doc || null;
}

async function getSiteSettingsMergedWithFallback({ bypassCache = false } = {}) {
  const fallback = buildEnvFallback();
  const now = Date.now();

  if (!bypassCache && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const saved = await getSiteSettings();
    if (!saved) {
      cached = fallback;
      cachedAt = now;
      return fallback;
    }

    const merged = {
      promoBannerText: saved.promoBannerText || '',
      promoBannerCode: saved.promoBannerCode || '',
    };

    cached = merged;
    cachedAt = now;
    return merged;
  } catch (err) {
    cached = fallback;
    cachedAt = now;
    return fallback;
  }
}

function sanitizeForm(body) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    promoBannerText: getTrimmedString(b.promoBannerText),
    promoBannerCode: getTrimmedString(b.promoBannerCode),
  };
}

async function updateSiteSettingsFromForm(body) {
  const data = sanitizeForm(body);

  const updated = await SiteSettings.findOneAndUpdate(
    { key: 'site' },
    { $set: { key: 'site', ...data } },
    { new: true, upsert: true }
  ).lean();

  cached = {
    promoBannerText: updated && updated.promoBannerText ? updated.promoBannerText : '',
    promoBannerCode: updated && updated.promoBannerCode ? updated.promoBannerCode : '',
  };
  cachedAt = Date.now();

  return updated;
}

module.exports = {
  buildEnvFallback,
  getSiteSettings,
  getSiteSettingsMergedWithFallback,
  updateSiteSettingsFromForm,
};
