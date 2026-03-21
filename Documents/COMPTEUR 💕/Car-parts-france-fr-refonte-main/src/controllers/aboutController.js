const mongoose = require('mongoose');

const { getPublicBaseUrlFromReq } = require('../services/productPublic');
const siteSettings = require('../services/siteSettings');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMetaText(value) {
  return getTrimmedString(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function truncateText(value, max) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return '';
  if (!Number.isFinite(max) || max <= 0) return input;
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function toSafeJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

async function getAboutPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const baseUrl = getPublicBaseUrlFromReq(req);
    const settings = res && res.locals && res.locals.siteSettings
      ? res.locals.siteSettings
      : (dbConnected
        ? await siteSettings.getSiteSettingsMergedWithFallback()
        : siteSettings.buildEnvFallback());

    const canonicalUrl = baseUrl ? `${baseUrl}/notre-histoire` : '/notre-histoire';
    const title = 'Notre Histoire — Car Parts France | Spécialiste pièces auto reconditionnées';
    const aboutSummary = getTrimmedString(settings && settings.aboutText)
      || 'Car Parts France accompagne particuliers et professionnels avec des pièces auto reconditionnées et d’occasion contrôlées, un diagnostic précis et un suivi humain pour trouver la bonne référence rapidement.';
    const metaDescription = truncateText(
      normalizeMetaText(
        'Découvrez Car Parts France, spécialiste français des pièces auto reconditionnées et d’occasion contrôlées : expertise atelier, tests sur banc, garantie jusqu’à 24 mois et accompagnement technique réactif.'
      ),
      160
    );
    const ogImage = baseUrl ? `${baseUrl}/images/hero-home.png` : '/images/hero-home.png';
    const jsonLd = toSafeJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'AboutPage',
          name: 'Notre Histoire',
          url: canonicalUrl,
          description: metaDescription,
          primaryImageOfPage: ogImage,
          inLanguage: 'fr-FR',
        },
        {
          '@type': 'Organization',
          name: 'Car Parts France',
          url: baseUrl ? `${baseUrl}/` : '/',
          description: aboutSummary,
          image: ogImage,
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Accueil',
              item: baseUrl ? `${baseUrl}/` : '/',
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Notre Histoire',
              item: canonicalUrl,
            },
          ],
        },
      ],
    });

    return res.render('about/index', {
      title,
      metaDescription,
      canonicalUrl,
      ogTitle: title,
      ogDescription: metaDescription,
      ogUrl: canonicalUrl,
      ogImage,
      ogSiteName: 'CarParts France',
      ogType: 'website',
      jsonLd,
      dbConnected,
      aboutSummary,
      foundedYear: 2021,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getAboutPage,
};
