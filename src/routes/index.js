const express = require('express');

const homeController = require('../controllers/homeController');
const productController = require('../controllers/productController');
const legacyRedirectController = require('../controllers/legacyRedirectController');

const router = express.Router();

router.get('/', homeController.getHome);
router.get('/shop', legacyRedirectController.redirectLegacyShop);
router.get('/product', (req, res) => res.redirect(301, '/produits'));
router.get('/product/:slug', productController.getProductBySlug);
router.get('/:slug', homeController.redirectLegacyBlogSlug);

module.exports = router;
