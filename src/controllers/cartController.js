const mongoose = require('mongoose');

const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const demoProducts = require('../demoProducts');

const promoCodes = require('../services/promoCodes');
const pricing = require('../services/pricing');

function getCart(req) {
  if (!req.session.cart) {
    req.session.cart = { items: {} };
  }

  return req.session.cart;
}

function getSafeReturnTo(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  return value;
}

function computeCartItemCount(cart) {
  return Object.values(cart.items).reduce((sum, item) => sum + item.quantity, 0);
}

function clampQty(value) {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 99) return 99;
  return value;
}

function parseNumberFromLooseString(value) {
  if (typeof value !== 'string') return null;

  const cleaned = value
    .replace(/[\s\u00A0]/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  let normalized = cleaned;

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseLegacyPriceCents(product) {
  if (Number.isFinite(product.priceCents)) return product.priceCents;

  if (typeof product.priceCents === 'string') {
    const parsed = parseNumberFromLooseString(product.priceCents);
    if (parsed !== null) {
      if (parsed >= 50000) return Math.round(parsed);
      return Math.round(parsed * 100);
    }
  }

  const legacy =
    product.price ??
    product.priceEuro ??
    product.priceEuros ??
    product.prix ??
    null;

  if (typeof legacy === 'number' && Number.isFinite(legacy)) {
    if (legacy >= 50000) return Math.round(legacy);
    return Math.round(legacy * 100);
  }

  if (typeof legacy === 'string') {
    const parsed = parseNumberFromLooseString(legacy);
    if (parsed === null) return 0;
    if (parsed >= 50000) return Math.round(parsed);
    return Math.round(parsed * 100);
  }

  return 0;
}

function normalizeProduct(product) {
  if (!product) return product;

  let stockQty = null;
  if (Number.isFinite(product.stockQty)) {
    stockQty = product.stockQty;
  } else if (typeof product.stockQty === 'string') {
    const trimmed = product.stockQty.trim();
    if (trimmed) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n >= 0) {
        stockQty = Math.floor(n);
      }
    }
  }

  const inStock =
    stockQty !== null
      ? stockQty > 0
      :
    product.inStock === false ||
    product.inStock === 'false' ||
    product.inStock === 0 ||
    product.inStock === '0'
      ? false
      : true;

  return {
    ...product,
    inStock,
    stockQty,
    priceCents: parseLegacyPriceCents(product),
  };
}

async function showCart(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const cart = getCart(req);
    const cartItemCount = computeCartItemCount(cart);

    const errorMessage = req.session.cartError || null;
    delete req.session.cartError;

    const items = Object.values(cart.items);

    if (items.length === 0) {
      const suggestedProducts = dbConnected
        ? (await Product.find({})
            .sort({ createdAt: -1 })
            .limit(4)
            .lean())
            .map(normalizeProduct)
        : demoProducts.slice(0, 4).map(normalizeProduct);

      return res.render('cart/index', {
        title: 'Panier - CarParts France',
        dbConnected,
        cartItemCount,
        items: [],
        totalCents: 0,
        errorMessage,
        suggestedProducts,
      });
    }

    const productById = new Map();

    if (dbConnected) {
      const productIds = items.map((i) => i.productId);
      const products = await Product.find({ _id: { $in: productIds } }).lean();
      for (const p of products) {
        productById.set(String(p._id), p);
      }
    }

    for (const p of demoProducts) {
      if (!productById.has(String(p._id))) {
        productById.set(String(p._id), p);
      }
    }

    const viewItems = [];
    let itemsSubtotalCents = 0;

    for (const item of items) {
      const product = normalizeProduct(productById.get(String(item.productId)));
      if (!product) continue;

      const lineTotalCents = product.priceCents * item.quantity;
      itemsSubtotalCents += lineTotalCents;

      viewItems.push({
        product,
        quantity: item.quantity,
        lineTotalCents,
      });
    }

    const sessionUser = req.session.user;
    let clientDiscountPercent = 0;
    if (dbConnected && sessionUser && sessionUser._id) {
      const user = await User.findById(sessionUser._id).select('_id discountPercent').lean();
      clientDiscountPercent = user && Number.isFinite(user.discountPercent) ? user.discountPercent : 0;
    }

    const promoCodeFromSession = typeof req.session.promoCode === 'string' ? req.session.promoCode : '';
    let promo = null;
    let appliedPromoCode = '';

    if (dbConnected && promoCodeFromSession) {
      const result = await promoCodes.getApplicablePromo({
        code: promoCodeFromSession,
        userId: sessionUser && sessionUser._id ? sessionUser._id : null,
        itemsSubtotalCents,
      });

      if (!result.ok) {
        delete req.session.promoCode;
        req.session.cartError = result.reason || 'Code promo invalide.';
        return res.redirect('/panier');
      }

      promo = result.promo;
      appliedPromoCode = result.code;
    }

    const computed = pricing.computePricing({
      itemsSubtotalCents,
      shippingCostCents: 0,
      clientDiscountPercent,
      promo,
    });

    const totalCents = computed.itemsTotalAfterDiscountCents;

    const cartProductIds = new Set(viewItems.map((it) => String(it.product && it.product._id ? it.product._id : '')).filter(Boolean));

    let suggestedProducts = [];
    if (dbConnected) {
      suggestedProducts = (await Product.find({ _id: { $nin: Array.from(cartProductIds) } })
        .sort({ createdAt: -1 })
        .limit(4)
        .lean()).map(normalizeProduct);
    } else {
      suggestedProducts = demoProducts
        .filter((p) => !cartProductIds.has(String(p._id)))
        .slice(0, 4)
        .map(normalizeProduct);
    }

    return res.render('cart/index', {
      title: 'Panier - CarParts France',
      dbConnected,
      cartItemCount,
      items: viewItems,
      totalCents,
      itemsSubtotalCents,
      clientDiscountPercent: computed.clientDiscountPercent,
      clientDiscountCents: computed.clientDiscountCents,
      promoCode: appliedPromoCode,
      promoDiscountCents: computed.promoDiscountCents,
      itemsTotalAfterDiscountCents: computed.itemsTotalAfterDiscountCents,
      errorMessage,
      suggestedProducts,
    });
  } catch (err) {
    return next(err);
  }
}

async function postCartPromoCode(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const raw = typeof req.body.code === 'string' ? req.body.code : '';
    const code = promoCodes.normalizeCode(raw);

    if (!code) {
      delete req.session.promoCode;
      return res.redirect('/panier');
    }

    if (!promoCodes.isValidCode(code)) {
      req.session.cartError = 'Code promo invalide.';
      delete req.session.promoCode;
      return res.redirect('/panier');
    }

    req.session.promoCode = code;

    if (dbConnected) {
      const cart = getCart(req);
      const items = Object.values(cart.items);
      const productById = new Map();

      const productIds = items.map((i) => i.productId);
      const products = await Product.find({ _id: { $in: productIds } }).lean();
      for (const p of products) {
        productById.set(String(p._id), p);
      }
      for (const p of demoProducts) {
        if (!productById.has(String(p._id))) {
          productById.set(String(p._id), p);
        }
      }

      let itemsSubtotalCents = 0;
      for (const item of items) {
        const product = normalizeProduct(productById.get(String(item.productId)));
        if (!product) continue;
        itemsSubtotalCents += product.priceCents * item.quantity;
      }

      const sessionUser = req.session.user;
      const result = await promoCodes.getApplicablePromo({
        code,
        userId: sessionUser && sessionUser._id ? sessionUser._id : null,
        itemsSubtotalCents,
      });

      if (!result.ok) {
        req.session.cartError = result.reason || 'Code promo invalide.';
        delete req.session.promoCode;
      } else {
        req.session.promoCode = result.code;
      }
    }

    return res.redirect('/panier');
  } catch (err) {
    return next(err);
  }
}

function formatEuro(totalCents) {
  return `${(totalCents / 100).toFixed(2).replace('.', ',')} €`;
}

function getDefaultAddress(user) {
  if (!user || !Array.isArray(user.addresses)) return null;
  return user.addresses.find((a) => a && a.isDefault) || user.addresses[0] || null;
}

function generateOrderNumber() {
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `CP-${Date.now()}-${rand}`;
}

async function placeOrder(req, res, next) {
  try {
    return res.redirect('/commande/livraison');
  } catch (err) {
    return next(err);
  }
}

async function addToCart(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const { id } = req.params;
    const returnTo = getSafeReturnTo(req.body.returnTo);

    const qtyRaw = req.body.qty;
    let qty = 1;
    if (typeof qtyRaw === 'string') {
      const parsed = Number.parseInt(qtyRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        qty = Math.min(parsed, 99);
      }
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    let product = null;
    if (dbConnected) {
      product = await Product.findById(id).select('_id inStock stockQty').lean();
    }

    if (!product) {
      product = demoProducts.find((p) => String(p._id) === String(id)) || null;
    }

    product = normalizeProduct(product);

    if (!product) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    if (product.inStock === false) {
      return res.redirect(returnTo || `/produits/${id}`);
    }

    const cart = getCart(req);

    if (!cart.items[id]) {
      cart.items[id] = { productId: id, quantity: 0 };
    }

    cart.items[id].quantity = Math.min(cart.items[id].quantity + qty, 99);

    return res.redirect(returnTo || '/panier');
  } catch (err) {
    return next(err);
  }
}

function updateCartItem(req, res) {
  const { id } = req.params;
  const returnTo = getSafeReturnTo(req.body.returnTo);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).render('errors/404', {
      title: 'Page introuvable - CarParts France',
    });
  }

  const qtyRaw = req.body.qty;
  let qty = 1;
  if (typeof qtyRaw === 'string') {
    const parsed = Number.parseInt(qtyRaw, 10);
    if (Number.isFinite(parsed)) {
      qty = clampQty(parsed);
    }
  }

  const cart = getCart(req);

  if (qty <= 0) {
    delete cart.items[id];
  } else {
    if (!cart.items[id]) {
      cart.items[id] = { productId: id, quantity: 0 };
    }
    cart.items[id].quantity = qty;
  }

  return res.redirect(returnTo || '/panier');
}

function removeFromCart(req, res) {
  const { id } = req.params;
  const returnTo = getSafeReturnTo(req.body.returnTo);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).render('errors/404', {
      title: 'Page introuvable - CarParts France',
    });
  }

  const cart = getCart(req);
  delete cart.items[id];

  return res.redirect(returnTo || '/panier');
}

function clearCart(req, res) {
  req.session.cart = { items: {} };
  delete req.session.promoCode;
  return res.redirect('/panier');
}

module.exports = {
  showCart,
  postCartPromoCode,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  placeOrder,
};
