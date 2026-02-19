const express = require('express');
const session = require('express-session');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

const isProd = process.env.NODE_ENV === 'production';
const oneDayMs = 24 * 60 * 60 * 1000;

if (isProd) {
  app.set('trust proxy', 1);
}

const secureCookieFromEnv =
  process.env.SESSION_COOKIE_SECURE === 'true'
    ? true
    : process.env.SESSION_COOKIE_SECURE === 'false'
      ? false
      : null;

const shouldUseSecureCookie = secureCookieFromEnv === null ? isProd : secureCookieFromEnv;

const indexRouter = require('./routes');
const productsRouter = require('./routes/products');
const categoriesRouter = require('./routes/categories');
const searchRouter = require('./routes/search');
const cartRouter = require('./routes/cart');
const accountRouter = require('./routes/account');
const checkoutRouter = require('./routes/checkout');
const legalRouter = require('./routes/legal');
const blogRouter = require('./routes/blog');
const adminRouter = require('./routes/admin');
const seoController = require('./controllers/seoController');
const siteSettings = require('./services/siteSettings');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

let compression = null;
try {
  compression = require('compression');
} catch (err) {
  compression = null;
}

let MongoStore = null;
try {
  MongoStore = require('connect-mongo');
} catch (err) {
  MongoStore = null;
}

if (compression) {
  app.use(compression());
}

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.use(
  session((() => {
    const sessionOptions = {
      name: 'carpartsfrance.sid',
      secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
      proxy: isProd,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookie,
        maxAge: 30 * oneDayMs,
      },
    };

    const mongoUrl = typeof process.env.MONGODB_URI === 'string' ? process.env.MONGODB_URI.trim() : '';
    if (MongoStore && mongoUrl) {
      sessionOptions.store = MongoStore.create({
        mongoUrl,
        ttl: 30 * 24 * 60 * 60,
      });
    }

    return sessionOptions;
  })())
);

app.use((req, res, next) => {
  const originalRender = res.render;
  res.render = function patchedRender(view, options, callback) {
    let locals = options;
    let cb = callback;

    if (typeof locals === 'function') {
      cb = locals;
      locals = undefined;
    }

    if (locals && typeof locals === 'object' && Object.prototype.hasOwnProperty.call(locals, 'include')) {
      delete locals.include;
    }

    if (this && this.locals && typeof this.locals === 'object' && Object.prototype.hasOwnProperty.call(this.locals, 'include')) {
      delete this.locals.include;
    }

    return originalRender.call(this, view, locals, cb);
  };

  next();
});

app.use((req, res, next) => {
  const cart = req.session.cart || { items: {} };

  const currentUser = req.session.user && typeof req.session.user === 'object'
    ? req.session.user
    : null;

  const currentAdmin = req.session.admin && typeof req.session.admin === 'object'
    ? req.session.admin
    : null;

  const accountTypeFromUser = currentUser && currentUser.accountType === 'pro'
    ? 'pro'
    : currentUser && currentUser.accountType === 'particulier'
      ? 'particulier'
      : null;

  const accountTypeFromSession = req.session.accountType === 'pro' ? 'pro' : 'particulier';
  const accountType = accountTypeFromUser || accountTypeFromSession;

  req.session.accountType = accountType;

  const cartItemCount = Object.values(cart.items).reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  res.locals.cartItemCount = cartItemCount;
  res.locals.searchQuery = '';
  res.locals.accountType = accountType;
  res.locals.currentPath = req.originalUrl;
  res.locals.currentUser = currentUser;
  res.locals.currentAdmin = currentAdmin;

  const pathOnly = typeof req.path === 'string' ? req.path : '';
  const noIndex = /^\/(admin|panier|commande|compte)(\/|$)/.test(pathOnly);
  res.locals.metaRobots = noIndex ? 'noindex, nofollow' : '';

  if (process.env.FORCE_NOINDEX === 'true') {
    res.locals.metaRobots = 'noindex, nofollow';
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }

  if (Object.prototype.hasOwnProperty.call(res.locals, 'include')) {
    delete res.locals.include;
  }

  next();
});

app.use(async (req, res, next) => {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    res.locals.siteSettings = dbConnected
      ? await siteSettings.getSiteSettingsMergedWithFallback()
      : siteSettings.buildEnvFallback();
  } catch (err) {
    res.locals.siteSettings = siteSettings.buildEnvFallback();
  }

  next();
});

app.get('/sitemap.xml', seoController.getSitemapXml);
app.get('/robots.txt', seoController.getRobotsTxt);

const staticOptions = isProd
  ? { maxAge: '7d', etag: true }
  : undefined;

app.use(express.static(path.join(__dirname, '..', 'public'), staticOptions));

app.use('/', indexRouter);
app.use('/blog', blogRouter);
app.use('/categorie', categoriesRouter);
app.use('/rechercher', searchRouter);
app.use('/produits', productsRouter);
app.use('/panier', cartRouter);
app.use('/commande', checkoutRouter);
app.use('/legal', legalRouter);
app.use('/compte', accountRouter);
app.use('/admin', adminRouter);

app.use((req, res) => {
  res.status(404).render('errors/404', {
    title: 'Page introuvable - CarParts France',
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).render('errors/500', {
    title: 'Erreur - CarParts France',
  });
});

module.exports = app;
