function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(value) {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (!input) return '';

  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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

function buildProductPublicPath(product) {
  const id = product && product._id ? String(product._id) : '';
  const preferredSlug = getTrimmedString(product && product.slug ? product.slug : '');
  const nameSlug = slugify(getTrimmedString(product && product.name ? product.name : ''));
  const finalSlug = preferredSlug || nameSlug || 'produit';

  if (!id) return '/produits';
  return `/produits/${finalSlug}-${encodeURIComponent(id)}`;
}

function buildProductPublicUrl(product, { req } = {}) {
  const base = getPublicBaseUrlFromReq(req);
  const path = buildProductPublicPath(product);
  if (!base) return path;
  return `${base}${path}`;
}

module.exports = {
  slugify,
  buildProductPublicPath,
  buildProductPublicUrl,
  getPublicBaseUrlFromReq,
};
