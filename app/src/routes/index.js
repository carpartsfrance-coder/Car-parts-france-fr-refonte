const express = require('express');

const aboutController = require('../controllers/aboutController');
const homeController = require('../controllers/homeController');
const savController = require('../controllers/savController');
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

router.get('/notre-histoire', aboutController.getAboutPage);

router.get('/sav', savController.getSavHome);
router.get('/sav/notre-engagement', (req, res) => {
  res.render('sav-engagement', {
    title: 'Notre engagement SAV — CarParts France',
    metaDescription: 'Transparence, banc dédié, réponse sous 5 jours, équité. Découvrez notre engagement Service Après-Vente.',
    canonicalUrl: `${process.env.SITE_URL || 'https://www.carpartsfrance.fr'}/sav/notre-engagement`,
  });
});
router.get('/legal/cgv-sav', (req, res) => {
  res.render('legal/cgv-sav', {
    title: 'CGV SAV — CarParts France',
    metaDescription: 'Conditions générales du Service Après-Vente CarParts France.',
    canonicalUrl: `${process.env.SITE_URL || 'https://www.carpartsfrance.fr'}/legal/cgv-sav`,
  });
});
router.post('/sav/check-commande', savController.postCheckCommande);

// Suivi invité
const savGuestController = require('../controllers/savGuestController');
router.get('/sav/suivi', savGuestController.getSuiviForm);
router.post('/sav/suivi', savGuestController.postSuiviForm);
router.get('/sav/suivi/:numero', savGuestController.getSuiviDetail);
router.post('/sav/suivi/:numero/messages', savGuestController.postSuiviMessage);
router.get('/sav/confirmation/:numero', savController.getConfirmation);
router.get('/sav/feedback/:numero', savController.getFeedback);
router.post('/sav/feedback/:numero', savController.postFeedback);

router.get('/faq', (req, res) => {
  res.render('faq/index', {
    title: 'FAQ - Questions fréquentes | CarParts France',
    metaDescription: 'Retrouvez les réponses aux questions les plus fréquentes : livraison, échange standard, garantie, compatibilité, paiement et retours.',
    canonicalUrl: `${process.env.BASE_URL || 'https://www.carpartsfrance.fr'}/faq`,
  });
});

router.get('/:slug', homeController.redirectLegacyBlogSlug);

module.exports = router;
