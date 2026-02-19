const express = require('express');

const homeController = require('../controllers/homeController');
const productController = require('../controllers/productController');
const contactController = require('../controllers/contactController');
const legacyRedirectController = require('../controllers/legacyRedirectController');

const router = express.Router();

router.get('/', homeController.getHome);
router.get('/shop', legacyRedirectController.redirectLegacyShop);
router.get('/product', (req, res) => res.redirect(301, '/produits'));
router.get('/product/:slug', productController.getProductBySlug);

router.get('/contact', contactController.getContactPage);
router.post('/contact', contactController.postContact);
router.get('/devis', (req, res, next) => {
  req.query = { ...(req.query || {}), type: 'devis' };
  return contactController.getContactPage(req, res, next);
});
router.post('/devis', (req, res, next) => {
  req.body = { ...(req.body || {}), mode: 'devis', subject: 'devis' };
  return contactController.postContact(req, res, next);
});

router.get('/:slug', homeController.redirectLegacyBlogSlug);

module.exports = router;
