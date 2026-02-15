const mongoose = require('mongoose');

const Product = require('../models/Product');
const ShippingClass = require('../models/ShippingClass');
const User = require('../models/User');
const Order = require('../models/Order');
const demoProducts = require('../demoProducts');

const mollie = require('../services/mollie');
const scalapay = require('../services/scalapay');
const promoCodes = require('../services/promoCodes');
const pricing = require('../services/pricing');
const emailService = require('../services/emailService');
const { getLegalPageBySlug } = require('../services/legalPages');

function getCart(req) {
  if (!req.session.cart) {
    req.session.cart = { items: {} };
  }

  return req.session.cart;
}

function computeCartItemCount(cart) {
  return Object.values(cart.items).reduce((sum, item) => sum + item.quantity, 0);
}

function parseNumberFromLooseString(value) {
  if (typeof value !== 'string') return null;

  const cleaned = value.replace(/[\s\u00A0]/g, '').replace(/[^\d,.-]/g, '');

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

  const rawConsigne = product.consigne && typeof product.consigne === 'object'
    ? product.consigne
    : {};
  const consigneEnabled = rawConsigne.enabled === true;
  const consigneAmountCents = Number.isFinite(rawConsigne.amountCents) && rawConsigne.amountCents >= 0
    ? Math.floor(rawConsigne.amountCents)
    : 0;
  const consigneDelayDays = Number.isFinite(rawConsigne.delayDays) && rawConsigne.delayDays >= 0
    ? Math.floor(rawConsigne.delayDays)
    : 30;

  return {
    ...product,
    inStock,
    stockQty,
    priceCents: parseLegacyPriceCents(product),
    consigne: {
      enabled: consigneEnabled,
      amountCents: consigneAmountCents,
      delayDays: consigneDelayDays,
    },
  };
}

function formatEuro(totalCents) {
  return `${(totalCents / 100).toFixed(2).replace('.', ',')} €`;
}

function generateOrderNumber() {
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `CP-${Date.now()}-${rand}`;
}

async function computeShippingPricesCents(dbConnected, products) {
  const fallback = { domicile: 1290 };

  if (!dbConnected) return fallback;

  const list = Array.isArray(products) ? products : [];
  if (!list.length) return { domicile: 0 };

  const classIds = Array.from(
    new Set(
      list
        .map((p) => (p && p.shippingClassId ? String(p.shippingClassId) : ''))
        .filter(Boolean)
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )
  );

  const defaultClass = await ShippingClass.findOne({ isDefault: true })
    .select('_id domicilePriceCents')
    .lean();

  const classDocs = classIds.length
    ? await ShippingClass.find({ _id: { $in: classIds } })
        .select('_id domicilePriceCents')
        .lean()
    : [];

  const classById = new Map(classDocs.map((c) => [String(c._id), c]));

  if (!defaultClass && !classDocs.length) return fallback;

  let domicile = 0;

  for (const p of list) {
    const id = p && p.shippingClassId ? String(p.shippingClassId) : '';
    const cls = id ? classById.get(id) : defaultClass;
    if (!cls) continue;

    const d = Number.isFinite(cls.domicilePriceCents) ? cls.domicilePriceCents : 0;
    domicile = Math.max(domicile, d);
  }

  return { domicile };
}

async function getShippingMethods(dbConnected, products) {
  const prices = await computeShippingPricesCents(dbConnected, products);

  return [
    {
      id: 'domicile',
      title: 'Livraison à domicile',
      description: 'Livré chez toi en 2-3 jours ouvrés',
      priceCents: prices.domicile,
    },
    {
      id: 'retrait',
      title: 'Retrait magasin',
      description: 'Retrait rapide (si disponible)',
      priceCents: 0,
    },
  ];
}

async function buildCartView(dbConnected, cart) {
  const items = Object.values(cart.items);
  const productById = new Map();

  if (dbConnected && items.length) {
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
  let itemsTotalCents = 0;

  for (const item of items) {
    const product = normalizeProduct(productById.get(String(item.productId)));
    if (!product) continue;

    const lineTotalCents = product.priceCents * item.quantity;
    itemsTotalCents += lineTotalCents;

    viewItems.push({
      product,
      quantity: item.quantity,
      lineTotalCents,
    });
  }

  return { viewItems, itemsTotalCents };
}

function getDefaultAddress(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return null;
  return addresses.find((a) => a && a.isDefault) || addresses[0] || null;
}

function getCheckoutState(req) {
  if (!req.session.checkout) {
    req.session.checkout = {};
  }

  return req.session.checkout;
}

function isTruthyFormValue(value) {
  return value === 'on' || value === 'true' || value === true;
}

function normalizeVehicleIdentifier(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseScalapayProductFromPaymentMethod(paymentMethod) {
  const pm = getTrimmedString(paymentMethod).toLowerCase();
  if (pm === 'scalapay_pay_in_3') return 'pay-in-3';
  if (pm === 'scalapay_pay_in_4') return 'pay-in-4';
  return '';
}

function getCountryCodeFromAddressCountry(country) {
  const raw = getTrimmedString(country);
  if (!raw) return 'FR';
  const upper = raw.toUpperCase();
  if (upper === 'FR' || upper === 'FRANCE') return 'FR';
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return 'FR';
}

function normalizePhoneForScalapay(phone, countryCode = 'FR') {
  const raw = getTrimmedString(phone);
  if (!raw) return '+33000000000';

  const cleaned = raw.replace(/[\s.()-]/g, '');
  if (cleaned.startsWith('+')) return cleaned;

  const cc = getTrimmedString(countryCode).toUpperCase();
  if (cc === 'FR') {
    if (cleaned.startsWith('0')) return `+33${cleaned.slice(1)}`;
    return `+33${cleaned}`;
  }

  return `+${cleaned}`;
}

function splitNameParts(fullName) {
  const raw = getTrimmedString(fullName);
  if (!raw) return { givenNames: '', surname: '' };
  const parts = raw.split(/\s+/g).filter(Boolean);
  if (parts.length === 1) return { givenNames: parts[0], surname: parts[0] };
  return { givenNames: parts[0], surname: parts.slice(1).join(' ') };
}

function getPublicBaseUrl(req) {
  const fromEnv = getTrimmedString(process.env.PUBLIC_BASE_URL);
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const protoHeader = getTrimmedString(req.headers['x-forwarded-proto']);
  const proto = protoHeader ? protoHeader.split(',')[0].trim() : req.protocol;
  return `${proto}://${req.get('host')}`;
}

function getMollieProfileId() {
  return getTrimmedString(process.env.MOLLIE_PROFILE_ID);
}

function getMollieWebhookToken() {
  return getTrimmedString(process.env.MOLLIE_WEBHOOK_TOKEN);
}

function getMollieWebhookBaseUrl() {
  return getTrimmedString(process.env.MOLLIE_WEBHOOK_URL);
}

function isLocalBaseUrl(url) {
  const u = getTrimmedString(url).toLowerCase();
  return (
    u.includes('://localhost') ||
    u.includes('://127.0.0.1') ||
    u.includes('://0.0.0.0')
  );
}

function mapMollieStatusToPaymentStatus(mollieStatus) {
  const s = getTrimmedString(mollieStatus).toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'open' || s === 'pending' || s === 'authorized') return 'pending';
  return 'failed';
}

function mapScalapayStatusToPaymentStatus(scalapayStatus) {
  const s = getTrimmedString(scalapayStatus).toLowerCase();
  if (s === 'charged' || s === 'captured') return 'paid';
  if (s === 'approved') return 'paid';
  if (s === 'pending' || s === 'created' || s === 'processing') return 'pending';
  if (s === 'declined' || s === 'canceled' || s === 'cancelled' || s === 'expired' || s === 'void') return 'failed';
  return s ? 'pending' : 'pending';
}

function applyDiscountToOrderItems(orderItems, discountedItemsTotalCents) {
  const items = Array.isArray(orderItems) ? orderItems.filter(Boolean) : [];

  const originalSubtotal = items.reduce((sum, it) => sum + (Number(it && it.lineTotalCents) || 0), 0);
  const target = Math.max(0, Number(discountedItemsTotalCents) || 0);

  if (!items.length) return [];
  if (originalSubtotal <= 0) return items;
  if (target >= originalSubtotal) return items;

  const ratio = target / originalSubtotal;

  const units = [];
  for (const it of items) {
    const qty = Number(it.quantity) || 1;
    const unitPriceCents = Number(it.unitPriceCents) || 0;
    for (let i = 0; i < qty; i += 1) {
      const raw = unitPriceCents * ratio;
      const floored = Math.floor(raw);
      units.push({
        productId: it.productId,
        name: it.name,
        sku: it.sku || '',
        raw,
        unitPriceCents: floored,
        frac: raw - floored,
      });
    }
  }

  let sumUnits = units.reduce((sum, u) => sum + (Number(u.unitPriceCents) || 0), 0);
  let diff = target - sumUnits;

  if (diff > 0) {
    units.sort((a, b) => (b.frac || 0) - (a.frac || 0));
    for (let i = 0; i < units.length && diff > 0; i += 1) {
      units[i].unitPriceCents += 1;
      diff -= 1;
    }
    sumUnits = units.reduce((sum, u) => sum + (Number(u.unitPriceCents) || 0), 0);
  }

  if (diff < 0) {
    units.sort((a, b) => (a.frac || 0) - (b.frac || 0));
    for (let i = 0; i < units.length && diff < 0; i += 1) {
      if (units[i].unitPriceCents > 0) {
        units[i].unitPriceCents -= 1;
        diff += 1;
      }
    }
  }

  const grouped = new Map();

  for (const u of units) {
    const pid = u.productId ? String(u.productId) : '';
    const sku = u.sku || '';
    const name = u.name || '';
    const price = Number(u.unitPriceCents) || 0;
    const key = `${pid}__${sku}__${price}__${name}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.lineTotalCents += price;
    } else {
      grouped.set(key, {
        productId: itOrNullObjectId(pid) || u.productId,
        name,
        sku,
        unitPriceCents: price,
        quantity: 1,
        lineTotalCents: price,
      });
    }
  }

  return Array.from(grouped.values());
}

function itOrNullObjectId(value) {
  if (!value) return null;
  const s = String(value);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

async function reserveOrderStockIfNeeded(order, productById) {
  if (!order || !order._id) return;

  const state = await Order.findById(order._id).select('_id stockReservedAt stockReleasedAt').lean();
  if (!state) return;
  if (state.stockReservedAt) return;

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    if (!item || !item.productId) continue;
    const product = productById.get(String(item.productId));
    if (!product) continue;
    if (!mongoose.Types.ObjectId.isValid(String(product._id))) continue;
    if (!Number.isFinite(product.stockQty)) continue;

    const newQty = Math.max(0, product.stockQty - item.quantity);
    await Product.findByIdAndUpdate(product._id, {
      $set: { stockQty: newQty, inStock: newQty > 0 },
    });

    product.stockQty = newQty;
    product.inStock = newQty > 0;
  }

  await Order.findByIdAndUpdate(order._id, { $set: { stockReservedAt: new Date() } });
}

async function releaseOrderStockIfNeeded(order) {
  if (!order || !order._id) return;

  const state = await Order.findById(order._id).select('_id stockReservedAt stockReleasedAt items').lean();
  if (!state) return;
  if (!state.stockReservedAt) return;
  if (state.stockReleasedAt) return;

  const items = Array.isArray(state.items) ? state.items : [];

  for (const item of items) {
    if (!item || !item.productId) continue;

    const product = await Product.findById(item.productId).select('_id stockQty').lean();
    if (!product) continue;
    if (!Number.isFinite(product.stockQty)) continue;

    await Product.findByIdAndUpdate(product._id, {
      $inc: { stockQty: item.quantity },
      $set: { inStock: true },
    });
  }

  await Order.findByIdAndUpdate(order._id, { $set: { stockReleasedAt: new Date() } });
}

async function applyMolliePaymentToOrder(order, payment) {
  if (!order || !order._id || !payment) return order;

  const wasPaid = getTrimmedString(order.paymentStatus).toLowerCase() === 'paid';

  const mollieStatus = getTrimmedString(payment.status);
  const paymentStatus = mapMollieStatusToPaymentStatus(mollieStatus);

  const update = {
    paymentProvider: 'mollie',
    paymentStatus,
    molliePaymentStatus: mollieStatus,
    mollieLastCheckedAt: new Date(),
  };

  if (paymentStatus === 'paid') {
    update.molliePaidAt = new Date();

    if (order.status !== 'validee' && order.status !== 'expediee' && order.status !== 'livree') {
      update.status = 'validee';
      update.$push = {
        statusHistory: {
          status: 'validee',
          changedAt: new Date(),
          changedBy: 'mollie',
        },
      };
    }
  }

  if (paymentStatus === 'failed') {
    if (order.status !== 'annulee' && order.status !== 'livree') {
      update.status = 'annulee';
      update.$push = {
        statusHistory: {
          status: 'annulee',
          changedAt: new Date(),
          changedBy: 'mollie',
        },
      };
    }
  }

  await Order.findByIdAndUpdate(order._id, update);
  const refreshed = await Order.findById(order._id).lean();

  if (paymentStatus === 'failed') {
    await releaseOrderStockIfNeeded(refreshed);
    await promoCodes.releaseReservedForOrder(order._id);
  }

  if (paymentStatus === 'paid') {
    await promoCodes.redeemReservedForOrder(order._id);
  }

  if (paymentStatus === 'paid' && !wasPaid) {
    try {
      const alreadySent = refreshed
        && refreshed.notifications
        && refreshed.notifications.orderConfirmationSentAt;

      if (!alreadySent) {
        const user = await User.findById(refreshed.userId).select('_id email firstName').lean();
        if (user && user.email) {
          const sent = await emailService.sendOrderConfirmationEmail({ order: refreshed, user });
          if (sent && sent.ok) {
            await Order.updateOne(
              {
                _id: refreshed._id,
                $or: [
                  { 'notifications.orderConfirmationSentAt': { $exists: false } },
                  { 'notifications.orderConfirmationSentAt': null },
                ],
              },
              { $set: { 'notifications.orderConfirmationSentAt': new Date() } }
            );
          }
        }
      }
    } catch (err) {
      console.error('Erreur email confirmation commande (Mollie) :', err && err.message ? err.message : err);
    }
  }

  return refreshed;
}

async function applyScalapayPaymentToOrder(order, { scalapayStatus, paymentStatus, captured } = {}) {
  if (!order || !order._id) return order;

  const wasPaid = getTrimmedString(order.paymentStatus).toLowerCase() === 'paid';

  const safeScalapayStatus = getTrimmedString(scalapayStatus);
  const safePaymentStatus = getTrimmedString(paymentStatus) || 'pending';

  const update = {
    paymentProvider: 'scalapay',
    paymentStatus: safePaymentStatus,
    scalapayStatus: safeScalapayStatus,
    scalapayLastCheckedAt: new Date(),
  };

  if (safePaymentStatus === 'paid') {
    if (captured) update.scalapayCapturedAt = new Date();

    if (order.status !== 'validee' && order.status !== 'expediee' && order.status !== 'livree') {
      update.status = 'validee';
      update.$push = {
        statusHistory: {
          status: 'validee',
          changedAt: new Date(),
          changedBy: 'scalapay',
        },
      };
    }
  }

  if (safePaymentStatus === 'failed') {
    if (order.status !== 'annulee' && order.status !== 'livree') {
      update.status = 'annulee';
      update.$push = {
        statusHistory: {
          status: 'annulee',
          changedAt: new Date(),
          changedBy: 'scalapay',
        },
      };
    }
  }

  await Order.findByIdAndUpdate(order._id, update);
  const refreshed = await Order.findById(order._id).lean();

  if (safePaymentStatus === 'failed') {
    await releaseOrderStockIfNeeded(refreshed);
    await promoCodes.releaseReservedForOrder(order._id);
  }

  if (safePaymentStatus === 'paid') {
    await promoCodes.redeemReservedForOrder(order._id);
  }

  if (safePaymentStatus === 'paid' && !wasPaid) {
    try {
      const alreadySent = refreshed
        && refreshed.notifications
        && refreshed.notifications.orderConfirmationSentAt;

      if (!alreadySent) {
        const user = await User.findById(refreshed.userId).select('_id email firstName').lean();
        if (user && user.email) {
          const sent = await emailService.sendOrderConfirmationEmail({ order: refreshed, user });
          if (sent && sent.ok) {
            await Order.updateOne(
              {
                _id: refreshed._id,
                $or: [
                  { 'notifications.orderConfirmationSentAt': { $exists: false } },
                  { 'notifications.orderConfirmationSentAt': null },
                ],
              },
              { $set: { 'notifications.orderConfirmationSentAt': new Date() } }
            );
          }
        }
      }
    } catch (err) {
      console.error('Erreur email confirmation commande (Scalapay) :', err && err.message ? err.message : err);
    }
  }

  return refreshed;
}

async function getShipping(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const cart = getCart(req);
    const cartItemCount = computeCartItemCount(cart);

    const errorMessage = req.session.checkoutError || null;
    delete req.session.checkoutError;

    const checkout = getCheckoutState(req);
    const shippingMethodKey = typeof checkout.shippingMethod === 'string' ? checkout.shippingMethod : '';

    const sessionUser = req.session.user;
    let addresses = [];

    let userDiscountPercent = 0;
    if (dbConnected && sessionUser && sessionUser._id) {
      const user = await User.findById(sessionUser._id).select('_id addresses discountPercent').lean();
      addresses = user && Array.isArray(user.addresses) ? user.addresses : [];
      userDiscountPercent = user && Number.isFinite(user.discountPercent) ? user.discountPercent : 0;
    }

    const defaultAddress = getDefaultAddress(addresses);

    const selectedAddressId =
      typeof checkout.addressId === 'string' &&
      addresses.some((a) => String(a._id) === checkout.addressId)
        ? checkout.addressId
        : defaultAddress
          ? String(defaultAddress._id)
          : '';

    checkout.addressId = selectedAddressId;

    const billingSameAsShipping =
      typeof checkout.billingSameAsShipping === 'boolean'
        ? checkout.billingSameAsShipping
        : true;

    let selectedBillingAddressId = '';

    if (billingSameAsShipping) {
      selectedBillingAddressId = selectedAddressId;
    } else {
      selectedBillingAddressId =
        typeof checkout.billingAddressId === 'string' &&
        addresses.some((a) => String(a._id) === checkout.billingAddressId)
          ? checkout.billingAddressId
          : selectedAddressId;
    }

    checkout.billingSameAsShipping = billingSameAsShipping;
    checkout.billingAddressId = selectedBillingAddressId;

    const { viewItems, itemsTotalCents } = await buildCartView(dbConnected, cart);

    if (viewItems.length === 0) {
      return res.redirect('/panier');
    }

    const shippingMethods = await getShippingMethods(
      dbConnected,
      viewItems.map((it) => it.product)
    );

    const selectedMethod =
      shippingMethods.find((m) => m.id === checkout.shippingMethod) ||
      shippingMethods[0];

    checkout.shippingMethod = selectedMethod.id;

    const promoCodeFromSession = typeof req.session.promoCode === 'string' ? req.session.promoCode : '';
    let promo = null;
    let appliedPromoCode = '';

    if (dbConnected && promoCodeFromSession) {
      const result = await promoCodes.getApplicablePromo({
        code: promoCodeFromSession,
        userId: sessionUser && sessionUser._id ? sessionUser._id : null,
        itemsSubtotalCents: itemsTotalCents,
      });

      if (!result.ok) {
        delete req.session.promoCode;
        req.session.checkoutError = result.reason || 'Code promo invalide.';
        return res.redirect('/commande/livraison');
      }

      promo = result.promo;
      appliedPromoCode = result.code;
    }

    const computed = pricing.computePricing({
      itemsSubtotalCents: itemsTotalCents,
      shippingCostCents: selectedMethod.priceCents,
      clientDiscountPercent: userDiscountPercent,
      promo,
    });

    return res.render('checkout/shipping', {
      title: 'Livraison - CarParts France',
      dbConnected,
      cartItemCount,
      errorMessage,
      shippingMethods,
      selectedShippingMethod: selectedMethod.id,
      addresses,
      selectedAddressId,
      billingSameAsShipping,
      selectedBillingAddressId,
      form: {
        label: '',
        fullName: '',
        phone: '',
        line1: '',
        line2: '',
        postalCode: '',
        city: '',
        country: 'France',
        isDefault: addresses.length === 0,
      },
      items: viewItems,
      itemsTotalCents,
      shippingCostCents: computed.shippingCostCents,
      totalCents: computed.totalCents,
      itemsSubtotalCents: computed.itemsSubtotalCents,
      clientDiscountPercent: computed.clientDiscountPercent,
      clientDiscountCents: computed.clientDiscountCents,
      promoCode: appliedPromoCode,
      promoDiscountCents: computed.promoDiscountCents,
      itemsTotalAfterDiscountCents: computed.itemsTotalAfterDiscountCents,
    });
  } catch (err) {
    return next(err);
  }
}

async function postShipping(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte/connexion?returnTo=%2Fcommande%2Flivraison');
    }

    if (!dbConnected) {
      req.session.checkoutError = "La base de données n'est pas disponible. Impossible de continuer.";
      return res.redirect('/commande/livraison');
    }

    const cart = getCart(req);
    const { viewItems } = await buildCartView(dbConnected, cart);

    if (!viewItems.length) {
      return res.redirect('/panier');
    }

    const shippingMethods = await getShippingMethods(
      dbConnected,
      viewItems.map((it) => it.product)
    );
    const shippingMethodRaw = typeof req.body.shippingMethod === 'string' ? req.body.shippingMethod : '';
    const addressIdRaw = typeof req.body.addressId === 'string' ? req.body.addressId : '';

    const billingSameAsShipping = isTruthyFormValue(req.body.billingSameAsShipping);
    const billingAddressIdRaw = typeof req.body.billingAddressId === 'string' ? req.body.billingAddressId : '';

    const selectedMethod = shippingMethods.find((m) => m.id === shippingMethodRaw);
    if (!selectedMethod) {
      req.session.checkoutError = 'Merci de choisir un mode de livraison.';
      return res.redirect('/commande/livraison');
    }

    const user = await User.findById(sessionUser._id).lean();
    const addresses = user && Array.isArray(user.addresses) ? user.addresses : [];

    const addressExists = addresses.some((a) => String(a._id) === addressIdRaw);
    if (!addressExists) {
      req.session.checkoutError = 'Merci de choisir une adresse de livraison.';
      return res.redirect('/commande/livraison');
    }

    if (!billingSameAsShipping) {
      const billingExists = addresses.some((a) => String(a._id) === billingAddressIdRaw);
      if (!billingExists) {
        req.session.checkoutError = 'Merci de choisir une adresse de facturation.';
        return res.redirect('/commande/livraison');
      }
    }

    const checkout = getCheckoutState(req);
    checkout.shippingMethod = selectedMethod.id;
    checkout.addressId = addressIdRaw;
    checkout.billingSameAsShipping = billingSameAsShipping;
    checkout.billingAddressId = billingSameAsShipping ? addressIdRaw : billingAddressIdRaw;

    return res.redirect('/commande/paiement');
  } catch (err) {
    return next(err);
  }
}

async function postAddAddress(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte/connexion?returnTo=%2Fcommande%2Flivraison');
    }

    const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
    const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const line1 = typeof req.body.line1 === 'string' ? req.body.line1.trim() : '';
    const line2 = typeof req.body.line2 === 'string' ? req.body.line2.trim() : '';
    const postalCode = typeof req.body.postalCode === 'string' ? req.body.postalCode.trim() : '';
    const city = typeof req.body.city === 'string' ? req.body.city.trim() : '';
    const country = typeof req.body.country === 'string' ? req.body.country.trim() : 'France';
    const isDefault = isTruthyFormValue(req.body.isDefault);

    if (!dbConnected) {
      req.session.checkoutError = "La base de données n'est pas disponible. Impossible d'ajouter une adresse.";
      return res.redirect('/commande/livraison');
    }

    if (!line1 || !postalCode || !city) {
      req.session.checkoutError = 'Merci de renseigner au minimum : adresse, code postal et ville.';
      return res.redirect('/commande/livraison');
    }

    const user = await User.findById(sessionUser._id);

    if (!user) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    if (!Array.isArray(user.addresses)) {
      user.addresses = [];
    }

    const shouldBeDefault = user.addresses.length === 0 || isDefault;

    if (shouldBeDefault) {
      user.addresses.forEach((a) => {
        a.isDefault = false;
      });
    }

    user.addresses.push({
      label,
      fullName,
      phone,
      line1,
      line2,
      postalCode,
      city,
      country: country || 'France',
      isDefault: shouldBeDefault,
    });

    await user.save();

    const created = user.addresses[user.addresses.length - 1];

    const checkout = getCheckoutState(req);
    const createdId = created ? String(created._id) : '';
    if (createdId) {
      checkout.addressId = createdId;
      if (checkout.billingSameAsShipping === true) {
        checkout.billingAddressId = createdId;
      } else if (!checkout.billingAddressId) {
        checkout.billingAddressId = createdId;
      }
    }

    return res.redirect('/commande/livraison');
  } catch (err) {
    return next(err);
  }
}

async function getPayment(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const cart = getCart(req);
    const cartItemCount = computeCartItemCount(cart);

    const errorMessage = req.session.checkoutError || null;
    delete req.session.checkoutError;

    const checkout = getCheckoutState(req);
    const shippingMethodKey = typeof checkout.shippingMethod === 'string' ? checkout.shippingMethod : '';

    const { viewItems, itemsTotalCents } = await buildCartView(dbConnected, cart);

    if (viewItems.length === 0) {
      return res.redirect('/panier');
    }

    const shippingMethods = await getShippingMethods(
      dbConnected,
      viewItems.map((it) => it.product)
    );

    const selectedMethod = shippingMethods.find((m) => m.id === shippingMethodKey) || null;

    const billingSameAsShipping =
      typeof checkout.billingSameAsShipping === 'boolean'
        ? checkout.billingSameAsShipping
        : true;

    if (!selectedMethod || !checkout.addressId) {
      req.session.checkoutError = 'Merci de choisir une livraison et une adresse.';
      return res.redirect('/commande/livraison');
    }

    if (!dbConnected) {
      req.session.checkoutError = "La base de données n'est pas disponible. Impossible de continuer.";
      return res.redirect('/commande/livraison');
    }

    const sessionUser = req.session.user;
    const user = await User.findById(sessionUser._id).lean();

    const addresses = user && Array.isArray(user.addresses) ? user.addresses : [];
    const selectedAddress = addresses.find((a) => String(a._id) === checkout.addressId) || null;

    const selectedBillingAddress = billingSameAsShipping
      ? selectedAddress
      : addresses.find((a) => String(a._id) === checkout.billingAddressId) || null;

    if (!selectedAddress) {
      req.session.checkoutError = 'Adresse de livraison introuvable.';
      return res.redirect('/commande/livraison');
    }

    if (!selectedBillingAddress) {
      req.session.checkoutError = 'Adresse de facturation introuvable.';
      return res.redirect('/commande/livraison');
    }

    const shippingLine1 = getTrimmedString(selectedAddress.line1);
    const shippingPostal = getTrimmedString(selectedAddress.postalCode);
    const shippingCity = getTrimmedString(selectedAddress.city);

    if (!shippingLine1 || !shippingPostal || !shippingCity) {
      req.session.checkoutError =
        "Ton adresse de livraison est incomplète (adresse / code postal / ville). " +
        "Merci de la corriger dans \"Gérer mes adresses\" puis réessaie.";
      return res.redirect('/commande/livraison');
    }

    const billingLine1 = getTrimmedString(selectedBillingAddress.line1);
    const billingPostal = getTrimmedString(selectedBillingAddress.postalCode);
    const billingCity = getTrimmedString(selectedBillingAddress.city);

    if (!billingLine1 || !billingPostal || !billingCity) {
      req.session.checkoutError =
        "Ton adresse de facturation est incomplète (adresse / code postal / ville). " +
        "Merci de la corriger dans \"Gérer mes adresses\" puis réessaie.";
      return res.redirect('/commande/livraison');
    }

    const promoCodeFromSession = typeof req.session.promoCode === 'string' ? req.session.promoCode : '';
    let promo = null;
    let appliedPromoCode = '';

    if (dbConnected && promoCodeFromSession) {
      const result = await promoCodes.getApplicablePromo({
        code: promoCodeFromSession,
        userId: sessionUser && sessionUser._id ? sessionUser._id : null,
        itemsSubtotalCents: itemsTotalCents,
      });

      if (!result.ok) {
        delete req.session.promoCode;
        req.session.checkoutError = result.reason || 'Code promo invalide.';
        return res.redirect('/commande/paiement');
      }

      promo = result.promo;
      appliedPromoCode = result.code;
    }

    const computed = pricing.computePricing({
      itemsSubtotalCents: itemsTotalCents,
      shippingCostCents: selectedMethod.priceCents,
      clientDiscountPercent: user && Number.isFinite(user.discountPercent) ? user.discountPercent : 0,
      promo,
    });

    const shippingCostCents = computed.shippingCostCents;

    return res.render('checkout/payment', {
      title: 'Paiement - CarParts France',
      dbConnected,
      cartItemCount,
      errorMessage,
      shippingMethod: selectedMethod,
      address: selectedAddress,
      billingSameAsShipping,
      billingAddress: selectedBillingAddress,
      vehicle: checkout && typeof checkout.vehicle === 'object' && checkout.vehicle ? checkout.vehicle : null,
      items: viewItems,
      itemsTotalCents,
      itemsSubtotalCents: computed.itemsSubtotalCents,
      clientDiscountPercent: computed.clientDiscountPercent,
      clientDiscountCents: computed.clientDiscountCents,
      promoCode: appliedPromoCode,
      promoDiscountCents: computed.promoDiscountCents,
      itemsTotalAfterDiscountCents: computed.itemsTotalAfterDiscountCents,
      shippingCostCents,
      totalCents: computed.totalCents,
    });
  } catch (err) {
    return next(err);
  }
}

async function postPayment(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte/connexion?returnTo=%2Fcommande%2Flivraison');
    }

    if (!dbConnected) {
      req.session.checkoutError = "La base de données n'est pas disponible. Impossible de valider la commande.";
      return res.redirect('/commande/livraison');
    }

    const checkout = getCheckoutState(req);
    const shippingMethodKey = checkout.shippingMethod;

    if (!shippingMethodKey || !checkout.addressId) {
      req.session.checkoutError = 'Merci de choisir une livraison et une adresse.';
      return res.redirect('/commande/livraison');
    }

    const cart = getCart(req);
    const rawItems = Object.values(cart.items);

    if (rawItems.length === 0) {
      return res.redirect('/panier');
    }

    const selectedPaymentMethod = getTrimmedString(req.body && req.body.paymentMethod);
    const acceptCgv = isTruthyFormValue(req.body && req.body.acceptCgv);

    const vehicleIdentifierTypeRaw = getTrimmedString(req.body && req.body.vehicleIdentifierType);
    const vehicleIdentifierType = vehicleIdentifierTypeRaw === 'vin' ? 'vin' : 'plate';
    const rawPlate = getTrimmedString(req.body && req.body.vehiclePlate);
    const rawVin = getTrimmedString(req.body && req.body.vehicleVin);
    const vehiclePlate = vehicleIdentifierType === 'plate' ? normalizeVehicleIdentifier(rawPlate) : '';
    const vehicleVin = vehicleIdentifierType === 'vin' ? normalizeVehicleIdentifier(rawVin) : '';
    const vehicleProvided = Boolean(vehiclePlate || vehicleVin);
    const vehicleConsent = isTruthyFormValue(req.body && req.body.vehicleConsent);

    checkout.vehicle = {
      identifierType: vehicleIdentifierType,
      plate: vehiclePlate,
      vin: vehicleVin,
      consentAt: vehicleProvided && vehicleConsent ? new Date() : null,
      providedAt: vehicleProvided ? new Date() : null,
    };

    if (vehicleProvided && !vehicleConsent) {
      req.session.checkoutError =
        "Merci de cocher l'accord pour utiliser la plaque/VIN afin de vérifier la compatibilité et/ou programmer la pièce.";
      return res.redirect('/commande/paiement');
    }

    if (vehiclePlate && vehiclePlate.length < 5) {
      req.session.checkoutError = 'La plaque semble trop courte. Merci de vérifier.';
      return res.redirect('/commande/paiement');
    }

    if (vehicleVin && vehicleVin.length < 11) {
      req.session.checkoutError = 'Le VIN semble trop court. Merci de vérifier.';
      return res.redirect('/commande/paiement');
    }

    if (!acceptCgv) {
      req.session.checkoutError = 'Merci d’accepter les CGV pour continuer.';
      return res.redirect('/commande/paiement');
    }
    const scalapayProduct = parseScalapayProductFromPaymentMethod(selectedPaymentMethod);
    const paymentProvider = scalapayProduct ? 'scalapay' : 'mollie';

    const cgvPage = await getLegalPageBySlug({ slug: 'cgv', dbConnected });
    if (!cgvPage) {
      req.session.checkoutError = 'Les CGV sont indisponibles pour le moment. Réessaie plus tard.';
      return res.redirect('/commande/paiement');
    }

    if (paymentProvider === 'mollie' && !getTrimmedString(process.env.MOLLIE_API_KEY)) {
      req.session.checkoutError =
        "Le paiement est temporairement indisponible. Merci de réessayer dans quelques minutes.";
      return res.redirect('/commande/paiement');
    }

    if (paymentProvider === 'scalapay' && !getTrimmedString(process.env.SCALAPAY_API_KEY)) {
      req.session.checkoutError =
        "Le paiement en plusieurs fois est temporairement indisponible. Merci de réessayer dans quelques minutes.";
      return res.redirect('/commande/paiement');
    }

    if (checkout.pendingOrderId && mongoose.Types.ObjectId.isValid(String(checkout.pendingOrderId))) {
      const existingPending = await Order.findOne({
        _id: checkout.pendingOrderId,
        userId: sessionUser._id,
      }).lean();

      if (existingPending) {
        if (existingPending.paymentStatus === 'paid') {
          req.session.cart = { items: {} };
          delete req.session.checkout;
          delete req.session.promoCode;
          return res.redirect(`/compte/commandes/${encodeURIComponent(String(existingPending._id))}`);
        }

        if (existingPending.mollieCheckoutUrl && existingPending.paymentStatus === 'pending') {
          return res.redirect(existingPending.mollieCheckoutUrl);
        }

        if (existingPending.scalapayCheckoutUrl && existingPending.paymentStatus === 'pending') {
          return res.redirect(existingPending.scalapayCheckoutUrl);
        }

        checkout.pendingOrderId = '';
      }
    }

    const user = await User.findById(sessionUser._id);
    if (!user) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    const selectedAddress =
      Array.isArray(user.addresses)
        ? user.addresses.find((a) => String(a._id) === checkout.addressId)
        : null;

    const billingSameAsShipping =
      typeof checkout.billingSameAsShipping === 'boolean'
        ? checkout.billingSameAsShipping
        : true;

    const selectedBillingAddress = billingSameAsShipping
      ? selectedAddress
      : Array.isArray(user.addresses)
        ? user.addresses.find((a) => String(a._id) === checkout.billingAddressId)
        : null;

    if (!selectedAddress) {
      req.session.checkoutError = 'Adresse de livraison introuvable.';
      return res.redirect('/commande/livraison');
    }

    if (!selectedBillingAddress) {
      req.session.checkoutError = 'Adresse de facturation introuvable.';
      return res.redirect('/commande/livraison');
    }

    const shippingLine1 = getTrimmedString(selectedAddress.line1);
    const shippingPostal = getTrimmedString(selectedAddress.postalCode);
    const shippingCity = getTrimmedString(selectedAddress.city);

    if (!shippingLine1 || !shippingPostal || !shippingCity) {
      req.session.checkoutError =
        "Ton adresse de livraison est incomplète (adresse / code postal / ville). " +
        "Merci de la corriger dans \"Gérer mes adresses\" puis réessaie.";
      return res.redirect('/commande/livraison');
    }

    const billingLine1 = getTrimmedString(selectedBillingAddress.line1);
    const billingPostal = getTrimmedString(selectedBillingAddress.postalCode);
    const billingCity = getTrimmedString(selectedBillingAddress.city);

    if (!billingLine1 || !billingPostal || !billingCity) {
      req.session.checkoutError =
        "Ton adresse de facturation est incomplète (adresse / code postal / ville). " +
        "Merci de la corriger dans \"Gérer mes adresses\" puis réessaie.";
      return res.redirect('/commande/livraison');
    }

    const productById = new Map();
    const productIds = rawItems.map((i) => i.productId);

    const products = await Product.find({ _id: { $in: productIds } }).lean();
    for (const p of products) {
      productById.set(String(p._id), p);
    }

    for (const p of demoProducts) {
      if (!productById.has(String(p._id))) {
        productById.set(String(p._id), p);
      }
    }

    // Vérification des quantités disponibles avant de créer la commande
    for (const item of rawItems) {
      const product = normalizeProduct(productById.get(String(item.productId)));
      if (!product) continue;

      if (Number.isFinite(product.stockQty) && item.quantity > product.stockQty) {
        req.session.checkoutError = 'Stock insuffisant pour un ou plusieurs articles. Merci de mettre à jour ton panier.';
        return res.redirect('/panier');
      }
    }

    const orderItems = [];
    const consigneLines = [];
    const shippingProducts = [];
    let itemsTotalCents = 0;

    for (const item of rawItems) {
      const product = normalizeProduct(productById.get(String(item.productId)));
      if (!product) continue;
      if (product.inStock === false) continue;

      const lineTotalCents = product.priceCents * item.quantity;
      itemsTotalCents += lineTotalCents;

      if (!mongoose.Types.ObjectId.isValid(String(product._id))) continue;

      orderItems.push({
        productId: new mongoose.Types.ObjectId(String(product._id)),
        name: product.name,
        sku: product.sku || '',
        unitPriceCents: product.priceCents,
        quantity: item.quantity,
        lineTotalCents,
      });

      if (product.consigne && product.consigne.enabled && Number.isFinite(product.consigne.amountCents) && product.consigne.amountCents > 0) {
        consigneLines.push({
          productId: new mongoose.Types.ObjectId(String(product._id)),
          name: product.name,
          sku: product.sku || '',
          quantity: item.quantity,
          amountCents: product.consigne.amountCents,
          delayDays: product.consigne.delayDays,
          startAt: null,
          dueAt: null,
          receivedAt: null,
        });
      }

      shippingProducts.push(product);
    }

    if (orderItems.length === 0) {
      req.session.checkoutError = 'Ton panier ne contient aucun article commandable.';
      return res.redirect('/panier');
    }

    const addressSnapshot = {
      label: selectedAddress.label || '',
      fullName: selectedAddress.fullName || '',
      phone: selectedAddress.phone || '',
      line1: shippingLine1,
      line2: selectedAddress.line2 || '',
      postalCode: shippingPostal,
      city: shippingCity,
      country: selectedAddress.country || 'France',
    };

    const billingAddressSnapshot = {
      label: selectedBillingAddress.label || '',
      fullName: selectedBillingAddress.fullName || '',
      phone: selectedBillingAddress.phone || '',
      line1: billingLine1,
      line2: selectedBillingAddress.line2 || '',
      postalCode: billingPostal,
      city: billingCity,
      country: selectedBillingAddress.country || 'France',
    };

    const shippingMethods = await getShippingMethods(dbConnected, shippingProducts);
    const selectedMethod = shippingMethods.find((m) => m.id === shippingMethodKey) || null;
    if (!selectedMethod) {
      req.session.checkoutError = 'Merci de choisir un mode de livraison.';
      return res.redirect('/commande/livraison');
    }

    const promoCodeFromSession = typeof req.session.promoCode === 'string' ? req.session.promoCode : '';
    let promo = null;
    let appliedPromoCode = '';

    if (dbConnected && promoCodeFromSession) {
      const result = await promoCodes.getApplicablePromo({
        code: promoCodeFromSession,
        userId: user._id,
        itemsSubtotalCents: itemsTotalCents,
      });

      if (!result.ok) {
        delete req.session.promoCode;
        req.session.checkoutError = result.reason || 'Code promo invalide.';
        return res.redirect('/commande/paiement');
      }

      promo = result.promo;
      appliedPromoCode = result.code;
    }

    const computed = pricing.computePricing({
      itemsSubtotalCents: itemsTotalCents,
      shippingCostCents: selectedMethod.priceCents,
      clientDiscountPercent: Number.isFinite(user.discountPercent) ? user.discountPercent : 0,
      promo,
    });

    const shippingCostCents = computed.shippingCostCents;
    const totalCents = computed.totalCents;

    const discountedOrderItems = applyDiscountToOrderItems(orderItems, computed.itemsTotalAfterDiscountCents);

    let created = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        created = await Order.create({
          userId: user._id,
          number: generateOrderNumber(),
          status: 'en_attente',
          statusHistory: [
            {
              status: 'en_attente',
              changedAt: new Date(),
              changedBy: 'client',
            },
          ],
          accountType: user.accountType,
          paymentProvider,
          paymentStatus: 'pending',
          mollieProfileId: paymentProvider === 'mollie' ? getMollieProfileId() : '',
          totalCents,
          items: orderItems,
          consigne: { lines: consigneLines },
          shippingAddress: addressSnapshot,
          billingAddress: billingAddressSnapshot,
          shippingMethod: selectedMethod.id,
          shippingCostCents,
          itemsSubtotalCents: computed.itemsSubtotalCents,
          clientDiscountPercent: computed.clientDiscountPercent,
          clientDiscountCents: computed.clientDiscountCents,
          promoCode: appliedPromoCode,
          promoDiscountCents: computed.promoDiscountCents,
          itemsTotalAfterDiscountCents: computed.itemsTotalAfterDiscountCents,
          vehicle: vehicleProvided
            ? {
                identifierType: vehicleIdentifierType,
                plate: vehiclePlate,
                vin: vehicleVin,
                consentAt: vehicleConsent ? new Date() : null,
                providedAt: new Date(),
              }
            : undefined,
          legal: {
            cgvAcceptedAt: new Date(),
            cgvSlug: 'cgv',
            cgvUpdatedAt: cgvPage && cgvPage.updatedAt ? new Date(cgvPage.updatedAt) : null,
          },
        });
        break;
      } catch (err) {
        if (err && err.code === 11000 && attempt < 2) {
          continue;
        }
        throw err;
      }
    }

    if (!created) {
      req.session.checkoutError = 'Une erreur est survenue lors de la création de ta commande.';
      return res.redirect('/commande/livraison');
    }

    await reserveOrderStockIfNeeded(created, productById);

    if (promo && promo._id) {
      try {
        await promoCodes.reservePromo({ promoId: promo._id, userId: user._id, orderId: created._id });
      } catch (err) {
        await Order.findByIdAndUpdate(created._id, {
          $set: {
            promoCode: '',
            promoDiscountCents: 0,
            paymentStatus: 'failed',
            status: 'annulee',
          },
          $push: {
            statusHistory: {
              status: 'annulee',
              changedAt: new Date(),
              changedBy: 'promo',
            },
          },
        });

        await releaseOrderStockIfNeeded(created);
        await promoCodes.releaseReservedForOrder(created._id);
        checkout.pendingOrderId = '';
        delete req.session.promoCode;
        req.session.checkoutError =
          'Le code promo ne peut pas être réservé pour le moment (il vient peut-être d’être utilisé). Merci de réessayer.';
        return res.redirect('/commande/paiement');
      }
    }

    const baseUrl = getPublicBaseUrl(req);

    if (paymentProvider === 'mollie') {
      const redirectUrl = `${baseUrl}/commande/paiement/retour?orderId=${encodeURIComponent(String(created._id))}`;
      const webhookToken = getMollieWebhookToken();

      const webhookBaseUrl = getMollieWebhookBaseUrl() || baseUrl;
      const webhookUrl = isLocalBaseUrl(webhookBaseUrl)
        ? ''
        : webhookToken
          ? `${webhookBaseUrl}/commande/paiement/webhook?token=${encodeURIComponent(webhookToken)}`
          : `${webhookBaseUrl}/commande/paiement/webhook`;

      let payment;
      try {
        payment = await mollie.createPayment({
          amountCents: totalCents,
          currency: 'EUR',
          description: `Commande ${created.number}`,
          redirectUrl,
          webhookUrl,
          metadata: {
            orderId: String(created._id),
            orderNumber: created.number,
            userId: String(user._id),
          },
          locale: 'fr_FR',
        });
      } catch (err) {
        console.error('[Mollie] Erreur création paiement', {
          orderId: String(created._id),
          orderNumber: created.number,
          message: err && err.message ? err.message : String(err),
        });
        await Order.findByIdAndUpdate(created._id, {
          $set: {
            paymentProvider: 'mollie',
            paymentStatus: 'failed',
            molliePaymentStatus: 'failed',
            mollieLastCheckedAt: new Date(),
            status: 'annulee',
          },
          $push: {
            statusHistory: {
              status: 'annulee',
              changedAt: new Date(),
              changedBy: 'mollie',
            },
          },
        });
        await releaseOrderStockIfNeeded(created);
        await promoCodes.releaseReservedForOrder(created._id);
        req.session.checkoutError = 'Impossible de démarrer le paiement. Merci de réessayer.';
        return res.redirect('/commande/paiement');
      }

      const checkoutUrl =
        payment && payment._links && payment._links.checkout && payment._links.checkout.href
          ? String(payment._links.checkout.href)
          : '';

      if (!checkoutUrl || !payment.id) {
        console.error('[Mollie] Réponse paiement incomplète', {
          orderId: String(created._id),
          orderNumber: created.number,
          hasPaymentId: Boolean(payment && payment.id),
          hasCheckoutUrl: Boolean(checkoutUrl),
        });
        req.session.checkoutError = 'Impossible de démarrer le paiement. Merci de réessayer.';
        await releaseOrderStockIfNeeded(created);
        await promoCodes.releaseReservedForOrder(created._id);
        return res.redirect('/commande/paiement');
      }

      await Order.findByIdAndUpdate(created._id, {
        $set: {
          molliePaymentId: String(payment.id),
          molliePaymentStatus: getTrimmedString(payment.status),
          mollieCheckoutUrl: checkoutUrl,
          mollieLastCheckedAt: new Date(),
        },
      });

      checkout.pendingOrderId = String(created._id);
      return res.redirect(checkoutUrl);
    }

    const redirectConfirmUrl = `${baseUrl}/commande/paiement/retour?orderId=${encodeURIComponent(String(created._id))}`;
    const redirectCancelUrl = `${baseUrl}/commande/paiement/retour?orderId=${encodeURIComponent(String(created._id))}&cancel=1`;

    const countryCode = getCountryCodeFromAddressCountry(addressSnapshot.country);
    const consumerPhone = normalizePhoneForScalapay(addressSnapshot.phone || billingAddressSnapshot.phone, countryCode);
    const nameParts = splitNameParts(user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : addressSnapshot.fullName);
    const givenNames = nameParts.givenNames || 'Client';
    const surname = nameParts.surname || 'CarParts';

    const scalapayItems = discountedOrderItems.map((it) => {
      const sku = getTrimmedString(it.sku) || String(it.productId);
      return {
        sku,
        name: getTrimmedString(it.name) || 'Article',
        quantity: Number(it.quantity) || 1,
        price: {
          amount: scalapay.formatAmountFromCents(it.unitPriceCents),
          currency: 'EUR',
        },
        category: 'car-parts',
      };
    });

    const scalapayBody = {
      totalAmount: {
        amount: scalapay.formatAmountFromCents(totalCents),
        currency: 'EUR',
      },
      consumer: {
        phoneNumber: consumerPhone,
        givenNames,
        surname,
        email: getTrimmedString(user.email),
      },
      shipping: {
        phoneNumber: consumerPhone,
        countryCode,
        name: getTrimmedString(addressSnapshot.fullName) || `${givenNames} ${surname}`,
        postcode: getTrimmedString(addressSnapshot.postalCode),
        suburb: getTrimmedString(addressSnapshot.city),
        line1: getTrimmedString(addressSnapshot.line1),
      },
      billing: {
        phoneNumber: consumerPhone,
        countryCode: getCountryCodeFromAddressCountry(billingAddressSnapshot.country),
        name: getTrimmedString(billingAddressSnapshot.fullName) || `${givenNames} ${surname}`,
        postcode: getTrimmedString(billingAddressSnapshot.postalCode),
        suburb: getTrimmedString(billingAddressSnapshot.city),
        line1: getTrimmedString(billingAddressSnapshot.line1),
      },
      items: scalapayItems,
      merchant: {
        redirectCancelUrl,
        redirectConfirmUrl,
      },
      merchantReference: created.number,
      shippingAmount: {
        amount: scalapay.formatAmountFromCents(shippingCostCents),
        currency: 'EUR',
      },
      taxAmount: {
        amount: '0.00',
        currency: 'EUR',
      },
      type: 'online',
      product: scalapayProduct,
    };

    let spOrder;
    try {
      spOrder = await scalapay.createOrder({ body: scalapayBody });
    } catch (err) {
      const rawMessage = err && err.message ? String(err.message) : String(err);
      console.error('[Scalapay] Erreur création commande', {
        orderId: String(created._id),
        orderNumber: created.number,
        message: rawMessage,
      });
      await Order.findByIdAndUpdate(created._id, {
        $set: {
          paymentProvider: 'scalapay',
          paymentStatus: 'failed',
          scalapayStatus: 'failed',
          scalapayLastCheckedAt: new Date(),
          status: 'annulee',
        },
        $push: {
          statusHistory: {
            status: 'annulee',
            changedAt: new Date(),
            changedBy: 'scalapay',
          },
        },
      });
      await releaseOrderStockIfNeeded(created);
      await promoCodes.releaseReservedForOrder(created._id);

      if (rawMessage.toLowerCase().includes('http 401') || rawMessage.toLowerCase().includes('unauthorized')) {
        req.session.checkoutError =
          "Scalapay refuse la connexion (401) : la clé API ne correspond pas à l'environnement de test. " +
          "Il te faut une clé Scalapay SANDBOX (test) pour https://integration.api.scalapay.com.";
      } else {
        req.session.checkoutError = 'Impossible de démarrer le paiement. Merci de réessayer.';
      }
      return res.redirect('/commande/paiement');
    }

    const scalapayCheckoutUrl = spOrder && spOrder.checkoutUrl ? String(spOrder.checkoutUrl) : '';
    const scalapayToken = spOrder && spOrder.token ? String(spOrder.token) : '';

    if (!scalapayCheckoutUrl || !scalapayToken) {
      req.session.checkoutError = 'Impossible de démarrer le paiement. Merci de réessayer.';
      await releaseOrderStockIfNeeded(created);
      await promoCodes.releaseReservedForOrder(created._id);
      return res.redirect('/commande/paiement');
    }

    await Order.findByIdAndUpdate(created._id, {
      $set: {
        scalapayOrderToken: scalapayToken,
        scalapayCheckoutUrl: scalapayCheckoutUrl,
        scalapayStatus: 'created',
        scalapayLastCheckedAt: new Date(),
      },
    });

    checkout.pendingOrderId = String(created._id);
    return res.redirect(scalapayCheckoutUrl);
  } catch (err) {
    return next(err);
  }
}

async function getPaymentReturn(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    const orderId = getTrimmedString(req.query.orderId);
    if (!dbConnected || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.redirect('/compte/commandes');
    }

    const order = await Order.findOne({ _id: orderId, userId: sessionUser._id }).lean();
    if (!order) return res.redirect('/compte/commandes');

    const checkout = getCheckoutState(req);

    if (order.paymentStatus === 'paid') {
      req.session.cart = { items: {} };
      delete req.session.checkout;
      delete req.session.promoCode;
      return res.redirect(`/compte/commandes/${encodeURIComponent(String(order._id))}`);
    }

    const wasCancelled = getTrimmedString(req.query && req.query.cancel) === '1';

    if (order.scalapayOrderToken) {
      try {
        const details = await scalapay.getPayment(order.scalapayOrderToken);
        const status = details && details.status ? String(details.status) : '';
        let paymentStatus = mapScalapayStatusToPaymentStatus(status);

        if (wasCancelled && paymentStatus !== 'paid') {
          paymentStatus = 'failed';
        }

        let captured = Boolean(order.scalapayCapturedAt);

        if (paymentStatus === 'paid' && !captured) {
          try {
            await scalapay.capturePayment({
              token: order.scalapayOrderToken,
              merchantReference: order.number,
              amountCents: order.totalCents,
              currency: order.currency || 'EUR',
            });
            captured = true;
          } catch (err) {
            paymentStatus = 'pending';
          }
        }

        const updated = await applyScalapayPaymentToOrder(order, {
          scalapayStatus: status,
          paymentStatus,
          captured,
        });

        if (updated && updated.paymentStatus === 'paid') {
          req.session.cart = { items: {} };
          delete req.session.checkout;
          delete req.session.promoCode;
          return res.redirect(`/compte/commandes/${encodeURIComponent(String(order._id))}`);
        }

        if (updated && updated.paymentStatus === 'pending') {
          checkout.pendingOrderId = String(order._id);
          req.session.checkoutError = wasCancelled
            ? 'Le paiement a été annulé. Vous pouvez réessayer.'
            : "Le paiement n'a pas été finalisé. Vous pouvez réessayer.";
          return res.redirect('/commande/paiement');
        }

        checkout.pendingOrderId = '';
        req.session.checkoutError = wasCancelled
          ? 'Le paiement a été annulé. Vous pouvez réessayer.'
          : 'Le paiement a échoué ou a été annulé. Vous pouvez réessayer.';
        return res.redirect('/commande/paiement');
      } catch (err) {
        checkout.pendingOrderId = String(order._id);
        req.session.checkoutError = 'Impossible de vérifier le paiement pour le moment. Réessayez.';
        return res.redirect('/commande/paiement');
      }
    }

    if (order.molliePaymentId) {
      try {
        const payment = await mollie.getPayment(order.molliePaymentId);
        const updated = await applyMolliePaymentToOrder(order, payment);

        if (updated && updated.paymentStatus === 'paid') {
          req.session.cart = { items: {} };
          delete req.session.checkout;
          delete req.session.promoCode;
          return res.redirect(`/compte/commandes/${encodeURIComponent(String(order._id))}`);
        }

        if (updated && updated.paymentStatus === 'pending') {
          checkout.pendingOrderId = String(order._id);
          req.session.checkoutError = "Le paiement n'a pas été finalisé. Vous pouvez réessayer.";
          return res.redirect('/commande/paiement');
        }

        checkout.pendingOrderId = '';
        req.session.checkoutError = 'Le paiement a échoué ou a été annulé. Vous pouvez réessayer.';
        return res.redirect('/commande/paiement');
      } catch (err) {
        checkout.pendingOrderId = String(order._id);
        req.session.checkoutError = 'Impossible de vérifier le paiement pour le moment. Réessayez.';
        return res.redirect('/commande/paiement');
      }
    }

    checkout.pendingOrderId = '';
    req.session.checkoutError = 'Paiement introuvable. Merci de réessayer.';
    return res.redirect('/commande/paiement');
  } catch (err) {
    return next(err);
  }
}

async function postPaymentWebhook(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    if (!dbConnected) return res.status(200).send('OK');

    const expectedToken = getMollieWebhookToken();
    if (expectedToken) {
      const providedToken = getTrimmedString(req.query && req.query.token);
      if (!providedToken || providedToken !== expectedToken) {
        return res.status(200).send('OK');
      }
    }

    const paymentId = getTrimmedString(req.body && (req.body.id || req.body.paymentId));
    if (!paymentId) return res.status(200).send('OK');

    const order = await Order.findOne({ molliePaymentId: paymentId }).lean();
    if (!order) return res.status(200).send('OK');

    try {
      const payment = await mollie.getPayment(paymentId);
      await applyMolliePaymentToOrder(order, payment);
    } catch (err) {
      return res.status(200).send('OK');
    }

    return res.status(200).send('OK');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getShipping,
  postShipping,
  postAddAddress,
  getPayment,
  postPayment,
  getPaymentReturn,
  postPaymentWebhook,
};
