const express = require('express');

const accountController = require('../controllers/accountController');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  const returnTo = req.originalUrl;
  return res.redirect(`/compte/connexion?returnTo=${encodeURIComponent(returnTo)}`);
}

router.get('/', requireAuth, accountController.getAccount);
router.post('/type', accountController.setAccountType);

router.get('/connexion', accountController.getLogin);
router.post('/connexion', accountController.postLogin);

router.get('/inscription', accountController.getRegister);
router.post('/inscription', accountController.postRegister);

router.get('/mot-de-passe-oublie', accountController.getForgotPassword);
router.post('/mot-de-passe-oublie', accountController.postForgotPassword);
router.get('/reinitialiser-mot-de-passe', accountController.getResetPassword);
router.post('/reinitialiser-mot-de-passe', accountController.postResetPassword);

router.post('/deconnexion', accountController.postLogout);

router.get('/profil', requireAuth, accountController.getProfile);
router.post('/profil', requireAuth, accountController.postProfile);

router.get('/securite', requireAuth, accountController.getSecurity);
router.post('/securite', requireAuth, accountController.postSecurity);

router.get('/adresses', requireAuth, accountController.getAddresses);
router.post('/adresses', requireAuth, accountController.postAddAddress);
router.post('/adresses/:addressId/par-defaut', requireAuth, accountController.postSetDefaultAddress);
router.post('/adresses/:addressId/supprimer', requireAuth, accountController.postDeleteAddress);

router.get('/commandes', requireAuth, accountController.getOrdersPage);
router.get('/commandes/:orderId', requireAuth, accountController.getOrderDetailPage);
router.get('/commandes/:orderId/suivi', requireAuth, accountController.getOrderTrackingPage);
router.get('/commandes/:orderId/facture.pdf', requireAuth, accountController.getOrderInvoicePdf);
router.post('/commandes/:orderId/racheter', requireAuth, accountController.postRepurchaseOrder);
router.get('/factures', requireAuth, accountController.getInvoicesPage);
router.get('/garage', requireAuth, accountController.getGaragePage);

module.exports = router;
