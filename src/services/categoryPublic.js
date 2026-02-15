function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPublicBaseUrlFromEnv() {
  const base = getTrimmedString(process.env.PUBLIC_BASE_URL);
  return base ? base.replace(/\/$/, '') : '';
}

function getPublicBaseUrlFromReq(req) {
  const envBase = getPublicBaseUrlFromEnv();
  if (envBase) return envBase;

  if (!req) return '';
  const proto = req.protocol || 'http';
  const host = typeof req.get === 'function' ? req.get('host') : '';
  if (!host) return '';
  return `${proto}://${host}`;
}

function buildCategoryPublicPath(category) {
  const slug = getTrimmedString(category && category.slug ? category.slug : '');
  if (!slug) return '/categorie';
  return `/categorie/${encodeURIComponent(slug)}`;
}

function buildCategoryPublicUrl(category, { req } = {}) {
  const base = getPublicBaseUrlFromReq(req);
  const path = buildCategoryPublicPath(category);
  if (!base) return path;
  return `${base}${path}`;
}

module.exports = {
  buildCategoryPublicPath,
  buildCategoryPublicUrl,
  getPublicBaseUrlFromReq,
};
