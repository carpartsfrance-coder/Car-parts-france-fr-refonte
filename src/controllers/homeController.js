const mongoose = require('mongoose');

const Product = require('../models/Product');
const demoProducts = require('../demoProducts');

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

    return res.render('home', {
      title: 'CarParts France - Pièces Détachées de Qualité',
      dbConnected,
      featuredProducts,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getHome,
};
