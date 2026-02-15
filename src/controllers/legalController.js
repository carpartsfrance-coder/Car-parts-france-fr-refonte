const mongoose = require('mongoose');

const { listLegalPages, getLegalPageBySlug } = require('../services/legalPages');

async function getLegalIndex(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const pages = await listLegalPages({ dbConnected });

    return res.render('legal/index', {
      title: 'Informations légales - CarParts France',
      dbConnected,
      pages,
    });
  } catch (err) {
    return next(err);
  }
}

async function getLegalPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const slug = req.params && req.params.slug ? String(req.params.slug) : '';

    const page = await getLegalPageBySlug({ slug, dbConnected });
    if (!page) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    return res.render('legal/page', {
      title: `${page.title} - CarParts France`,
      dbConnected,
      page,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getLegalIndex,
  getLegalPage,
};
