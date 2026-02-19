const express = require('express');

const homeController = require('../controllers/homeController');
const legacyRedirectController = require('../controllers/legacyRedirectController');

const router = express.Router();

router.get('/', homeController.getHome);
router.get('/shop', legacyRedirectController.redirectLegacyShop);
router.get('/product/:slug', legacyRedirectController.redirectLegacyWooProduct);
router.get('/:slug', homeController.redirectLegacyBlogSlug);

module.exports = router;
