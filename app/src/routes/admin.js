const express = require('express');
const mongoose = require('mongoose');

const adminController = require('../controllers/adminController');
const blogAdminController = require('../controllers/blogAdminController');
const legalAdminController = require('../controllers/legalAdminController');
const AdminUser = require('../models/AdminUser');
const { handleProductImageUpload } = require('../middlewares/adminProductUpload');
const { handleBlogCoverUpload, handleBlogMediaUpload } = require('../middlewares/adminBlogUpload');
const { handleInvoiceLogoUpload } = require('../middlewares/adminInvoiceUpload');

const router = express.Router();

function getSafeReturnTo(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/admin')) return null;
  if (value.startsWith('//')) return null;
  return value;
}

async function requireAdminAuth(req, res, next) {
  try {
    if (req.session && req.session.admin) {
      const adminSession = req.session.admin;
      const adminUserId = adminSession && typeof adminSession.adminUserId === 'string' ? adminSession.adminUserId.trim() : '';
      const dbConnected = mongoose.connection.readyState === 1;

      if (dbConnected && adminUserId && mongoose.Types.ObjectId.isValid(adminUserId)) {
        const adminUser = await AdminUser.findById(adminUserId)
          .select('_id email firstName lastName role isActive')
          .lean();

        if (!adminUser || adminUser.isActive === false) {
          delete req.session.admin;
        } else {
          req.session.admin = {
            adminUserId: String(adminUser._id),
            email: adminUser.email,
            firstName: adminUser.firstName,
            lastName: adminUser.lastName,
            role: adminUser.role,
          };
          return next();
        }
      } else {
        return next();
      }
    }

    const accept = req && req.headers && typeof req.headers.accept === 'string' ? req.headers.accept : '';
    if (accept.includes('application/json')) {
      return res.status(401).json({ ok: false, error: 'Session expir\u00e9e. Veuillez vous reconnecter.', redirect: '/admin/connexion' });
    }
    const returnTo = getSafeReturnTo(req.originalUrl) || '/admin';
    return res.redirect(`/admin/connexion?returnTo=${encodeURIComponent(returnTo)}`);
  } catch (err) {
    return next(err);
  }
}

router.get('/connexion', adminController.getAdminLogin);
router.post('/connexion', adminController.postAdminLogin);
router.post('/deconnexion', adminController.postAdminLogout);

router.get('/reinitialiser', adminController.getAdminResetPassword);
router.post('/reinitialiser', adminController.postAdminResetPassword);

router.get('/', requireAdminAuth, adminController.getAdminDashboard);

router.get('/commandes', requireAdminAuth, adminController.getAdminOrdersPage);
router.get('/commandes/:orderId', requireAdminAuth, adminController.getAdminOrderDetailPage);
router.post('/commandes/:orderId/statut', requireAdminAuth, adminController.postAdminUpdateOrderStatus);
router.post('/commandes/:orderId/consigne/recu', requireAdminAuth, adminController.postAdminMarkOrderConsigneReceived);
router.post('/commandes/:orderId/suivi', requireAdminAuth, adminController.postAdminAddOrderShipment);
router.post('/commandes/:orderId/suivi/:shipmentId/supprimer', requireAdminAuth, adminController.postAdminDeleteOrderShipment);
router.post('/commandes/:orderId/retour', requireAdminAuth, adminController.postAdminCreateReturnFromOrder);

router.get('/catalogue', requireAdminAuth, adminController.getAdminCatalogPage);
router.get('/categories', requireAdminAuth, adminController.getAdminCategoriesPage);
router.post('/categories', requireAdminAuth, adminController.postAdminCreateCategory);
router.post('/categories/supprimer-multi', requireAdminAuth, adminController.postAdminBulkDeleteCategories);
router.post('/categories/:categoryId', requireAdminAuth, adminController.postAdminUpdateCategory);
router.post('/categories/:categoryId/toggle', requireAdminAuth, adminController.postAdminToggleCategory);
router.post('/categories/:categoryId/supprimer', requireAdminAuth, adminController.postAdminDeleteCategory);

router.get('/vehicules', requireAdminAuth, adminController.getAdminVehicleMakesPage);
router.post('/vehicules', requireAdminAuth, adminController.postAdminCreateVehicleMake);
router.post('/vehicules/:makeId', requireAdminAuth, adminController.postAdminUpdateVehicleMake);
router.post('/vehicules/:makeId/supprimer', requireAdminAuth, adminController.postAdminDeleteVehicleMake);
router.post('/vehicules/:makeId/modeles', requireAdminAuth, adminController.postAdminAddVehicleModel);
router.post('/vehicules/:makeId/modeles/:modelId', requireAdminAuth, adminController.postAdminUpdateVehicleModel);
router.post('/vehicules/:makeId/modeles/:modelId/supprimer', requireAdminAuth, adminController.postAdminDeleteVehicleModel);

router.get('/expedition', requireAdminAuth, adminController.getAdminShippingClassesPage);
router.post('/expedition', requireAdminAuth, adminController.postAdminCreateShippingClass);
router.post('/expedition/:classId', requireAdminAuth, adminController.postAdminUpdateShippingClass);
router.post('/expedition/:classId/supprimer', requireAdminAuth, adminController.postAdminDeleteShippingClass);

router.get('/catalogue/options', requireAdminAuth, adminController.getAdminProductOptionTemplatesPage);
router.post('/catalogue/options', requireAdminAuth, adminController.postAdminCreateProductOptionTemplate);
router.post('/catalogue/options/:templateId', requireAdminAuth, adminController.postAdminUpdateProductOptionTemplate);
router.post('/catalogue/options/:templateId/toggle', requireAdminAuth, adminController.postAdminToggleProductOptionTemplate);
router.post('/api/products/generate-draft', requireAdminAuth, adminController.postAdminGenerateProductDraft);
router.get('/api/products/generate-draft/:jobId', requireAdminAuth, adminController.getAdminGenerateProductDraftStatus);
router.post('/api/products/generate-draft/:jobId/cancel', requireAdminAuth, adminController.postAdminCancelProductDraft);
router.post('/api/products/generate-draft/cancel-all', requireAdminAuth, adminController.postAdminCancelAllProductDrafts);

router.get('/catalogue/nouveau', requireAdminAuth, adminController.getAdminNewProductPage);
router.post('/catalogue/nouveau', requireAdminAuth, handleProductImageUpload, adminController.postAdminCreateProduct);
router.post('/catalogue/generer-ia-multi', requireAdminAuth, adminController.postAdminBulkGenerateProductDrafts);
router.post('/catalogue/supprimer-multi', requireAdminAuth, adminController.postAdminBulkDeleteProducts);
router.get('/catalogue/:productId', requireAdminAuth, adminController.getAdminEditProductPage);
router.post('/catalogue/:productId', requireAdminAuth, handleProductImageUpload, adminController.postAdminUpdateProduct);
router.post('/catalogue/:productId/supprimer', requireAdminAuth, adminController.postAdminDeleteProduct);

const adminProductSearchHandler = typeof blogAdminController.getAdminProductSearchApi === 'function'
  ? blogAdminController.getAdminProductSearchApi
  : (req, res) => res.status(501).json({ ok: false, items: [], error: 'Recherche produits non disponible.' });
router.get('/api/products/search', requireAdminAuth, adminProductSearchHandler);
const adminBlogSearchHandler = typeof blogAdminController.getAdminBlogPostSearchApi === 'function'
  ? blogAdminController.getAdminBlogPostSearchApi
  : (req, res) => res.status(501).json({ ok: false, items: [], error: 'Recherche blog non disponible.' });
router.get('/api/blog/search', requireAdminAuth, adminBlogSearchHandler);

router.get('/clients', requireAdminAuth, adminController.getAdminClientsPage);
router.get('/clients/:userId', requireAdminAuth, adminController.getAdminClientDetailPage);
router.post('/clients/:userId/remise', requireAdminAuth, adminController.postAdminUpdateClientDiscount);

router.get('/codes-promo', requireAdminAuth, adminController.getAdminPromoCodesPage);
router.post('/codes-promo', requireAdminAuth, adminController.postAdminCreatePromoCode);
router.post('/codes-promo/:promoId', requireAdminAuth, adminController.postAdminUpdatePromoCode);
router.post('/codes-promo/:promoId/supprimer', requireAdminAuth, adminController.postAdminDeletePromoCode);

router.get('/retours', requireAdminAuth, adminController.getAdminReturnsPage);
router.get('/retours/:returnId', requireAdminAuth, adminController.getAdminReturnDetailPage);
router.post('/retours/:returnId/statut', requireAdminAuth, adminController.postAdminUpdateReturnStatus);
router.post('/retours/:returnId/note', requireAdminAuth, adminController.postAdminUpdateReturnNote);

router.get('/blog', requireAdminAuth, blogAdminController.getAdminBlogPostsPage);
router.get('/blog/nouveau', requireAdminAuth, blogAdminController.getAdminNewBlogPostPage);
router.post('/blog/nouveau', requireAdminAuth, handleBlogCoverUpload, blogAdminController.postAdminCreateBlogPost);
router.get('/blog/:postId', requireAdminAuth, blogAdminController.getAdminEditBlogPostPage);
router.post('/blog/:postId', requireAdminAuth, handleBlogCoverUpload, blogAdminController.postAdminUpdateBlogPost);
router.post('/blog/:postId/supprimer', requireAdminAuth, blogAdminController.postAdminDeleteBlogPost);

router.post('/api/blog/upload', requireAdminAuth, handleBlogMediaUpload, blogAdminController.postAdminBlogMediaUploadApi);

router.get('/pages-legales', requireAdminAuth, legalAdminController.getAdminLegalPages);
router.get('/pages-legales/:slug', requireAdminAuth, legalAdminController.getAdminEditLegalPage);
router.post('/pages-legales/:slug', requireAdminAuth, legalAdminController.postAdminUpdateLegalPage);
router.get('/parametres', requireAdminAuth, adminController.getAdminSettingsPage);
router.post('/parametres/equipe', requireAdminAuth, adminController.postAdminCreateBackofficeUser);
router.post('/parametres/equipe/:adminUserId/toggle', requireAdminAuth, adminController.postAdminToggleBackofficeUser);
router.post('/parametres/equipe/:adminUserId/mot-de-passe', requireAdminAuth, adminController.postAdminResetBackofficeUserPassword);
router.post('/parametres/mot-de-passe', requireAdminAuth, adminController.postAdminChangeOwnPassword);
router.get('/parametres/facturation', requireAdminAuth, adminController.getAdminInvoiceSettingsPage);
router.post('/parametres/facturation', requireAdminAuth, handleInvoiceLogoUpload, adminController.postAdminInvoiceSettings);
router.get('/parametres/site', requireAdminAuth, adminController.getAdminSiteSettingsPage);
router.post('/parametres/site', requireAdminAuth, adminController.postAdminSiteSettings);

module.exports = router;
