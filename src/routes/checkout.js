const express = require('express');

const checkoutController = require('../controllers/checkoutController');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  const returnTo = req.method === 'GET' ? req.originalUrl || '/panier' : '/panier';
  return res.redirect(`/compte/connexion?returnTo=${encodeURIComponent(returnTo)}`);
}

router.get('/livraison', requireAuth, checkoutController.getShipping);
router.post('/livraison', requireAuth, checkoutController.postShipping);
router.post('/livraison/adresse', requireAuth, checkoutController.postAddAddress);

router.get('/paiement', requireAuth, checkoutController.getPayment);
router.post('/paiement', requireAuth, checkoutController.postPayment);

router.get('/paiement/retour', requireAuth, checkoutController.getPaymentReturn);
router.post('/paiement/webhook', checkoutController.postPaymentWebhook);

module.exports = router;
