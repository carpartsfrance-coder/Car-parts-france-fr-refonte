const mongoose = require('mongoose');

const crypto = require('crypto');

const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const demoProducts = require('../demoProducts');

const parcelwill = require('../services/parcelwill');
const emailService = require('../services/emailService');

function getCart(req) {
  if (!req.session.cart) {
    req.session.cart = { items: {} };
  }

  return req.session.cart;
}

function getForgotPassword(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;

  return res.render('account/forgot-password', {
    title: 'Mot de passe oublié - CarParts France',
    dbConnected,
    errorMessage: null,
    successMessage: null,
    email: '',
  });
}

async function postForgotPassword(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).render('account/forgot-password', {
        title: 'Mot de passe oublié - CarParts France',
        dbConnected,
        errorMessage: 'Merci de renseigner ton email.',
        successMessage: null,
        email,
      });
    }

    if (!dbConnected) {
      return res.status(503).render('account/forgot-password', {
        title: 'Mot de passe oublié - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Réessaie plus tard.",
        successMessage: null,
        email,
      });
    }

    const user = await User.findOne({ email }).select('_id email firstName').lean();
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = sha256Hex(token);
      const ttlMinutes = getResetPasswordTtlMinutes();
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            resetPasswordTokenHash: tokenHash,
            resetPasswordExpiresAt: expiresAt,
          },
        }
      );

      const resetUrl = buildResetUrl(token);
      if (resetUrl) {
        try {
          await emailService.sendResetPasswordEmail({ user, resetUrl });
        } catch (err) {
          console.error('Erreur email reset mot de passe :', err && err.message ? err.message : err);
        }
      }
    }

    return res.render('account/forgot-password', {
      title: 'Mot de passe oublié - CarParts France',
      dbConnected,
      errorMessage: null,
      successMessage: "Si un compte existe avec cet email, tu vas recevoir un lien de réinitialisation.",
      email: '',
    });
  } catch (err) {
    return next(err);
  }
}

async function getResetPassword(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const tokenHash = token ? sha256Hex(token) : '';

    if (!dbConnected) {
      return res.status(503).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Réessaie plus tard.",
        successMessage: null,
        token,
      });
    }

    if (!tokenHash) {
      return res.status(400).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: 'Lien invalide.',
        successMessage: null,
        token: '',
      });
    }

    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() },
    }).select('_id').lean();

    if (!user) {
      return res.status(400).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: 'Lien expiré ou invalide. Merci de refaire une demande.',
        successMessage: null,
        token: '',
      });
    }

    return res.render('account/reset-password', {
      title: 'Réinitialiser le mot de passe - CarParts France',
      dbConnected,
      errorMessage: null,
      successMessage: null,
      token,
    });
  } catch (err) {
    return next(err);
  }
}

async function postResetPassword(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';

    if (!dbConnected) {
      return res.status(503).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Réessaie plus tard.",
        successMessage: null,
        token,
      });
    }

    if (!token) {
      return res.status(400).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: 'Lien invalide.',
        successMessage: null,
        token: '',
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: 'Merci de remplir tous les champs.',
        successMessage: null,
        token,
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: 'Le mot de passe doit faire au moins 6 caractères.',
        successMessage: null,
        token,
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: 'La confirmation du mot de passe ne correspond pas.',
        successMessage: null,
        token,
      });
    }

    const tokenHash = sha256Hex(token);
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = hashPassword(newPassword, newSalt);

    const updateResult = await User.updateOne(
      {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          passwordSalt: newSalt,
          passwordHash: newHash,
          resetPasswordTokenHash: '',
          resetPasswordExpiresAt: null,
        },
      }
    );

    if (!updateResult || updateResult.modifiedCount !== 1) {
      return res.status(400).render('account/reset-password', {
        title: 'Réinitialiser le mot de passe - CarParts France',
        dbConnected,
        errorMessage: 'Lien expiré ou invalide. Merci de refaire une demande.',
        successMessage: null,
        token: '',
      });
    }

    if (req.session) {
      req.session.accountSuccess = 'Mot de passe réinitialisé. Tu peux te connecter.';
    }
    return res.redirect('/compte/connexion');
  } catch (err) {
    return next(err);
  }
}

function getSafeReturnTo(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  return value;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function getPublicBaseUrl() {
  const raw = typeof process.env.PUBLIC_BASE_URL === 'string' ? process.env.PUBLIC_BASE_URL.trim() : '';
  return raw;
}

function getResetPasswordTtlMinutes() {
  const raw = typeof process.env.RESET_PASSWORD_TOKEN_TTL_MINUTES === 'string'
    ? process.env.RESET_PASSWORD_TOKEN_TTL_MINUTES.trim()
    : '';
  const n = Number.parseInt(raw || '60', 10);
  if (!Number.isFinite(n) || n < 10) return 60;
  return Math.min(24 * 60, n);
}

function buildResetUrl(token) {
  const base = getPublicBaseUrl();
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/compte/reinitialiser-mot-de-passe?token=${encodeURIComponent(String(token))}`;
}

function computeConsigneSummaryForOrder(order) {
  const lines = order && order.consigne && Array.isArray(order.consigne.lines)
    ? order.consigne.lines
    : [];
  const clean = lines.filter(Boolean);
  if (!clean.length) {
    return {
      hasConsigne: false,
      label: '',
      className: '',
    };
  }

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  let minDaysLeft = null;
  let hasOverdue = false;
  let hasPending = false;
  let totalDueCents = 0;

  for (const l of clean) {
    if (!l) continue;
    const qty = Number.isFinite(l.quantity) ? l.quantity : 1;
    const amountCents = Number.isFinite(l.amountCents) ? l.amountCents : 0;
    const lineTotalCents = qty * amountCents;
    const isReceived = !!l.receivedAt;

    if (!isReceived) {
      hasPending = true;
    }

    const dueAt = l.dueAt ? new Date(l.dueAt) : null;
    let daysLeft = null;
    if (dueAt && !Number.isNaN(dueAt.getTime())) {
      const dueDay = new Date(dueAt);
      dueDay.setHours(0, 0, 0, 0);
      daysLeft = Math.ceil((dueDay.getTime() - startToday.getTime()) / (24 * 60 * 60 * 1000));
    }

    if (!isReceived && daysLeft !== null && daysLeft < 0) {
      hasOverdue = true;
      totalDueCents += lineTotalCents;
    }

    if (!isReceived && daysLeft !== null) {
      if (minDaysLeft === null || daysLeft < minDaysLeft) minDaysLeft = daysLeft;
    }
  }

  if (hasOverdue) {
    return {
      hasConsigne: true,
      label: `Consigne en retard • Montant dû : ${formatEuro(totalDueCents)}`,
      className: 'text-red-700',
    };
  }

  if (minDaysLeft !== null) {
    return {
      hasConsigne: true,
      label: `Consigne • Jours restants : ${minDaysLeft}`,
      className: 'text-amber-800',
    };
  }

  if (hasPending) {
    return {
      hasConsigne: true,
      label: 'Consigne • À retourner après livraison',
      className: 'text-slate-700',
    };
  }

  return {
    hasConsigne: true,
    label: 'Consigne • Reçue',
    className: 'text-green-700',
  };
}

async function getInvoicesPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('account/invoices', {
        title: 'Mes factures - CarParts France',
        dbConnected,
        invoices: [],
      });
    }

    const orders = await Order.find({ userId: sessionUser._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const invoices = orders.map((o) => ({
      id: String(o._id),
      number: o.number,
      date: formatDateFR(o.createdAt),
      total: formatEuro(o.totalCents),
    }));

    return res.render('account/invoices', {
      title: 'Mes factures - CarParts France',
      dbConnected,
      invoices,
    });
  } catch (err) {
    return next(err);
  }
}

async function getOrderDetailPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;
    const { orderId } = req.params;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const order = await Order.findOne({ _id: orderId, userId: sessionUser._id }).lean();

    if (!order) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const productMap = new Map();

    if (Array.isArray(order.items)) {
      const productIds = order.items
        .map((it) => (it && it.productId ? String(it.productId) : null))
        .filter(Boolean);

      const validProductIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

      if (validProductIds.length) {
        const products = await Product.find({ _id: { $in: validProductIds } })
          .select('_id imageUrl inStock')
          .lean();

        for (const p of products) {
          productMap.set(String(p._id), p);
        }
      }

      for (const p of demoProducts) {
        if (!productMap.has(String(p._id))) {
          productMap.set(String(p._id), p);
        }
      }
    }

    const shippingCostCents = Number.isFinite(order.shippingCostCents) ? order.shippingCostCents : 0;

    const fallbackItemsSubtotalCents = Array.isArray(order.items)
      ? order.items.reduce((sum, it) => {
          if (!it || !Number.isFinite(it.lineTotalCents)) return sum;
          return sum + it.lineTotalCents;
        }, 0)
      : 0;

    const itemsSubtotalCents = Number.isFinite(order.itemsSubtotalCents)
      ? order.itemsSubtotalCents
      : fallbackItemsSubtotalCents;

    const clientDiscountCents = Number.isFinite(order.clientDiscountCents) ? order.clientDiscountCents : 0;
    const promoDiscountCents = Number.isFinite(order.promoDiscountCents) ? order.promoDiscountCents : 0;
    const itemsTotalAfterDiscountCents = Number.isFinite(order.itemsTotalAfterDiscountCents)
      ? order.itemsTotalAfterDiscountCents
      : Math.max(0, itemsSubtotalCents - clientDiscountCents - promoDiscountCents);

    const totalCents = Number.isFinite(order.totalCents)
      ? order.totalCents
      : itemsTotalAfterDiscountCents + shippingCostCents;

    const htCents = Math.round(totalCents / 1.2);
    const vatCents = totalCents - htCents;

    const statusBanner = getOrderStatusBanner(order.status);

    const consigneLines = order && order.consigne && Array.isArray(order.consigne.lines)
      ? order.consigne.lines
      : [];

    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);

    const viewConsigneLines = consigneLines
      .filter(Boolean)
      .map((l) => {
        const qty = Number.isFinite(l.quantity) ? l.quantity : 1;
        const amountCents = Number.isFinite(l.amountCents) ? l.amountCents : 0;
        const totalLineCents = amountCents * qty;

        const dueAt = l.dueAt ? new Date(l.dueAt) : null;
        const receivedAt = l.receivedAt ? new Date(l.receivedAt) : null;

        let daysLeft = null;
        if (dueAt && !Number.isNaN(dueAt.getTime())) {
          const dueDay = new Date(dueAt);
          dueDay.setHours(0, 0, 0, 0);
          daysLeft = Math.ceil((dueDay.getTime() - startToday.getTime()) / (24 * 60 * 60 * 1000));
        }

        const isReceived = !!receivedAt;
        const isOverdue = !isReceived && daysLeft !== null && daysLeft < 0;

        return {
          name: l.name || 'Produit',
          sku: l.sku || '',
          quantity: qty,
          amount: formatEuro(amountCents),
          total: formatEuro(totalLineCents),
          startAt: l.startAt ? formatDateTimeFR(l.startAt) : '',
          dueAt: dueAt ? formatDateTimeFR(dueAt) : '',
          receivedAt: receivedAt ? formatDateTimeFR(receivedAt) : '',
          daysLeft,
          isReceived,
          isOverdue,
          totalCents: totalLineCents,
        };
      });

    const totalDueCents = viewConsigneLines
      .filter((l) => l && l.isOverdue)
      .reduce((sum, l) => sum + (Number(l.totalCents) || 0), 0);

    const consigne = {
      hasConsigne: viewConsigneLines.length > 0,
      hasOverdue: viewConsigneLines.some((l) => l && l.isOverdue),
      hasPending: viewConsigneLines.some((l) => l && !l.isReceived),
      lines: viewConsigneLines,
      totalDue: formatEuro(totalDueCents),
      totalDueCents,
    };

    return res.render('account/order', {
      title: `Commande ${order.number} - CarParts France`,
      dbConnected,
      order: {
        id: String(order._id),
        number: order.number,
        date: formatDateFR(order.createdAt),
        dateTime: formatDateTimeFR(order.createdAt),
        status: formatOrderStatus(order.status),
        statusKey: order.status,
        statusTitle: statusBanner.title,
        statusSubtitle: statusBanner.subtitle,
        total: formatEuro(totalCents),
        totalCents,
        ht: formatEuro(htCents),
        htCents,
        vat: formatEuro(vatCents),
        vatCents,
        itemsSubtotal: formatEuro(itemsSubtotalCents),
        itemsSubtotalCents,
        clientDiscountPercent: Number.isFinite(order.clientDiscountPercent) ? order.clientDiscountPercent : 0,
        clientDiscountCents,
        promoCode: typeof order.promoCode === 'string' ? order.promoCode : '',
        promoDiscountCents,
        itemsTotalAfterDiscount: formatEuro(itemsTotalAfterDiscountCents),
        itemsTotalAfterDiscountCents,
        shippingCost: formatEuro(shippingCostCents),
        shippingCostCents,
        currency: order.currency || 'EUR',
        shippingMethod: order.shippingMethod || 'domicile',
        shippingMethodLabel: formatShippingMethod(order.shippingMethod),
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
        consigne,
        items: Array.isArray(order.items)
          ? order.items.map((it) => {
              const pid = it && it.productId ? String(it.productId) : '';
              const p = pid ? productMap.get(pid) : null;
              return {
                productId: pid,
                imageUrl: p && p.imageUrl ? p.imageUrl : '',
                inStock: p && typeof p.inStock === 'boolean' ? p.inStock : null,
                name: it.name,
                sku: it.sku,
                unitPrice: formatEuro(it.unitPriceCents),
                unitPriceCents: it.unitPriceCents,
                quantity: it.quantity,
                lineTotal: formatEuro(it.lineTotalCents),
                lineTotalCents: it.lineTotalCents,
              };
            })
          : [],
      },
    });
  } catch (err) {
    return next(err);
  }
}

function formatPrettyDateFR(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const raw = d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  return capitalizeFirst(raw);
}

function formatTimelineTimeLabel(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const startDate = new Date(d);
  startDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((startToday.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (diffDays === 0) return `${time} - Aujourd'hui`;
  if (diffDays === 1) return `${time} - Hier`;

  const date = d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${time} - ${date}`;
}

function getTrackingUiForStatus(status) {
  switch (status) {
    case 'livree':
      return {
        statusLabel: 'Livrée',
        statusBadgeClass: 'bg-green-50 text-green-700',
        statusDotClass: 'bg-green-600',
        statusDotPulse: false,
        activeStepIndex: 3,
        progressWidthClass: 'w-[100%]',
      };
    case 'expediee':
      return {
        statusLabel: "En cours d'acheminement",
        statusBadgeClass: 'bg-blue-50 text-blue-600',
        statusDotClass: 'bg-blue-600',
        statusDotPulse: true,
        activeStepIndex: 2,
        progressWidthClass: 'w-[66.66%]',
      };
    case 'validee':
      return {
        statusLabel: 'En préparation',
        statusBadgeClass: 'bg-amber-50 text-amber-800',
        statusDotClass: 'bg-amber-600',
        statusDotPulse: true,
        activeStepIndex: 1,
        progressWidthClass: 'w-[33.33%]',
      };
    case 'annulee':
      return {
        statusLabel: 'Annulée',
        statusBadgeClass: 'bg-red-50 text-red-700',
        statusDotClass: 'bg-red-600',
        statusDotPulse: false,
        activeStepIndex: 0,
        progressWidthClass: 'w-[0%]',
      };
    case 'en_attente':
    default:
      return {
        statusLabel: 'En attente',
        statusBadgeClass: 'bg-amber-50 text-amber-800',
        statusDotClass: 'bg-amber-600',
        statusDotPulse: true,
        activeStepIndex: 0,
        progressWidthClass: 'w-[0%]',
      };
  }
}

function getTimelineTitleForStatus(status) {
  switch (status) {
    case 'livree':
      return 'Commande livrée';
    case 'expediee':
      return 'Colis pris en charge par le transporteur';
    case 'validee':
      return 'Commande préparée';
    case 'annulee':
      return 'Commande annulée';
    case 'en_attente':
    default:
      return 'Paiement accepté & Commande validée';
  }
}

function addDays(date, days) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
}

function getTrackingUiForParcelStatusCode(statusCode, fallbackOrderStatus) {
  const code = Number.isFinite(statusCode) ? statusCode : null;

  if (code === 0) return getTrackingUiForStatus('livree');

  if (code === 4) {
    return {
      statusLabel: 'En livraison',
      statusBadgeClass: 'bg-blue-50 text-blue-600',
      statusDotClass: 'bg-blue-600',
      statusDotPulse: true,
      activeStepIndex: 2,
      progressWidthClass: 'w-[66.66%]',
    };
  }

  if (code === 2 || code === 3) {
    return getTrackingUiForStatus('expediee');
  }

  if (code === 8) {
    return getTrackingUiForStatus('validee');
  }

  if (code === 6 || code === 7) {
    return {
      statusLabel: 'Incident de livraison',
      statusBadgeClass: 'bg-red-50 text-red-700',
      statusDotClass: 'bg-red-600',
      statusDotPulse: true,
      activeStepIndex: 2,
      progressWidthClass: 'w-[66.66%]',
    };
  }

  if (code === 5) {
    return {
      statusLabel: 'Suivi introuvable',
      statusBadgeClass: 'bg-amber-50 text-amber-800',
      statusDotClass: 'bg-amber-600',
      statusDotPulse: true,
      activeStepIndex: 2,
      progressWidthClass: 'w-[66.66%]',
    };
  }

  return getTrackingUiForStatus(fallbackOrderStatus);
}

function getEpochMs(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 10_000_000_000) return num;
  return num * 1000;
}

function parseParcelEventDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

async function getOrderTrackingPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;
    const { orderId } = req.params;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('account/order-tracking', {
        title: 'Suivi de commande - CarParts France',
        dbConnected,
        order: null,
        tracking: null,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const order = await Order.findOne({ _id: orderId, userId: sessionUser._id }).lean();
    if (!order) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const productMap = new Map();

    if (Array.isArray(order.items)) {
      const productIds = order.items
        .map((it) => (it && it.productId ? String(it.productId) : null))
        .filter(Boolean);

      const validProductIds = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

      if (validProductIds.length) {
        const products = await Product.find({ _id: { $in: validProductIds } })
          .select('_id imageUrl')
          .lean();

        for (const p of products) {
          productMap.set(String(p._id), p);
        }
      }

      for (const p of demoProducts) {
        if (!productMap.has(String(p._id))) {
          productMap.set(String(p._id), p);
        }
      }
    }

    const itemsCount = Array.isArray(order.items)
      ? order.items.reduce((sum, it) => sum + (Number(it && it.quantity) || 0), 0)
      : 0;

    const shippingCostCents = Number.isFinite(order.shippingCostCents) ? order.shippingCostCents : 0;
    const itemsSubtotalCents = Array.isArray(order.items)
      ? order.items.reduce((sum, it) => {
          if (!it || !Number.isFinite(it.lineTotalCents)) return sum;
          return sum + it.lineTotalCents;
        }, 0)
      : 0;

    const totalCents = Number.isFinite(order.totalCents)
      ? order.totalCents
      : itemsSubtotalCents + shippingCostCents;

    const shipments = Array.isArray(order.shipments) ? order.shipments.filter(Boolean) : [];
    const shipmentsSorted = shipments
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const lastShipment = shipmentsSorted[0] || null;

    const parcelApiKey = typeof process.env.PARCELWILL_API_KEY === 'string'
      ? process.env.PARCELWILL_API_KEY.trim()
      : '';

    let parcelDelivery = null;
    let parcelErrorMessage = '';
    const isProd = process.env.NODE_ENV === 'production';

    const parcelEnabledRaw = typeof process.env.PARCELWILL_ENABLED === 'string'
      ? process.env.PARCELWILL_ENABLED.trim().toLowerCase()
      : '';

    let parcelEnabled = isProd;
    if (parcelEnabledRaw) {
      parcelEnabled = ['1', 'true', 'yes', 'on'].includes(parcelEnabledRaw);
    }

    if (!parcelEnabled && lastShipment && lastShipment.trackingNumber) {
      parcelErrorMessage = isProd
        ? 'Le suivi transporteur est temporairement indisponible.'
        : "Le suivi transporteur avancé n'est pas disponible en local.";
    } else if (parcelEnabled && parcelApiKey && lastShipment && lastShipment.trackingNumber) {
      try {
        const orderNumberKey = order && order.number ? String(order.number) : '';
        const orderMongoKey = order && order._id ? String(order._id) : '';

        const preferredOrderKey = orderNumberKey || orderMongoKey;
        const orderKeys = [orderNumberKey, orderMongoKey].filter(Boolean);

        const trackingNumber = lastShipment.trackingNumber;

        let trackingDoc = null;
        for (const key of orderKeys) {
          trackingDoc = await parcelwill.getTrackingDetails(parcelApiKey, key);
          parcelDelivery = parcelwill.normalizeParcelwillToParcelDelivery(trackingDoc, trackingNumber);
          if (parcelDelivery) break;
        }

        if (!parcelDelivery && preferredOrderKey) {
          let courierCode = '';

          if (lastShipment && lastShipment.carrier) {
            courierCode = await parcelwill.guessCourierCode(parcelApiKey, lastShipment.carrier);
          }

          if (!courierCode && typeof trackingNumber === 'string' && trackingNumber.trim().toUpperCase().startsWith('1Z')) {
            courierCode = 'ups';
          }

          if (courierCode) {
            try {
              await parcelwill.createTrackings(parcelApiKey, [
                {
                  order_id: preferredOrderKey,
                  tracking_number: trackingNumber,
                  courier_code: courierCode,
                  date_shipped: parcelwill.formatParcelwillDateTime(lastShipment && lastShipment.createdAt ? lastShipment.createdAt : new Date()),
                  status_shipped: 1,
                },
              ]);
            } catch (err) {
              // ignore
            }

            trackingDoc = await parcelwill.getTrackingDetails(parcelApiKey, preferredOrderKey);
            parcelDelivery = parcelwill.normalizeParcelwillToParcelDelivery(trackingDoc, trackingNumber);
          } else {
            parcelErrorMessage =
              'Transporteur non reconnu. Merci de renseigner un transporteur (ex: UPS, Colissimo, Chronopost) dans la commande.';
          }
        }

        if (!parcelDelivery && !parcelErrorMessage) {
          parcelErrorMessage =
            'Le suivi est en cours d’activation chez le transporteur. Réessayez dans quelques minutes.';
        }
      } catch (err) {
        const rawMessage = err && err.message ? String(err.message) : '';
        if (rawMessage.toLowerCase().includes('account not found')) {
          parcelErrorMessage =
            "Le suivi transporteur est indisponible : la clé ParcelWILL n'est pas reconnue (ou l'accès API n'est pas activé sur ce compte). " +
            'Récupérez une clé API ParcelWILL puis mettez-la dans PARCELWILL_API_KEY.';
        } else {
          parcelErrorMessage = rawMessage || 'Impossible de récupérer le suivi transporteur.';
        }
      }
    } else if (parcelEnabled && parcelApiKey && (!lastShipment || !lastShipment.trackingNumber)) {
      parcelErrorMessage = 'Aucun numéro de suivi n’est renseigné pour cette commande.';
    } else if (parcelEnabled && !parcelApiKey && lastShipment && lastShipment.trackingNumber) {
      parcelErrorMessage = isProd
        ? 'Le suivi transporteur est temporairement indisponible.'
        : 'Clé ParcelWILL manquante : configurez PARCELWILL_API_KEY dans le fichier .env.';
    }

    const ui = parcelDelivery
      ? getTrackingUiForParcelStatusCode(parcelDelivery.status_code, order.status)
      : getTrackingUiForStatus(order.status);

    const baseSteps = [
      { label: 'Validée', icon: 'check' },
      { label: 'Préparation', icon: 'inventory_2' },
      { label: 'En livraison', icon: 'local_shipping' },
      { label: 'Livrée', icon: 'task_alt' },
    ];

    const isDeliveredUi =
      ui.statusLabel === 'Livrée' ||
      ui.progressWidthClass === 'w-[100%]' ||
      (parcelDelivery && parcelDelivery.status_code === 0);

    const steps = baseSteps.map((s, idx) => {
      if (isDeliveredUi) {
        return { ...s, state: 'completed' };
      }

      if (idx < ui.activeStepIndex) return { ...s, state: 'completed' };
      if (idx === ui.activeStepIndex) return { ...s, state: 'active' };
      return { ...s, state: '' };
    });

    const timeline = [];

    const parcelEvents = parcelDelivery && Array.isArray(parcelDelivery.events) ? parcelDelivery.events : [];
    if (parcelDelivery && parcelEvents.length === 0 && !parcelErrorMessage) {
      parcelErrorMessage =
        "Le transporteur n'a pas encore fourni d'informations de suivi. Réessayez un peu plus tard.";
    }
    for (const ev of parcelEvents) {
      if (!ev || !ev.event) continue;
      const dateObj = parseParcelEventDate(ev.date);
      const sortTime = dateObj ? dateObj.getTime() : 0;
      const descParts = [];
      if (ev.location) descParts.push(String(ev.location));
      if (ev.additional) descParts.push(String(ev.additional));

      timeline.push({
        sortTime,
        title: String(ev.event),
        description: descParts.length ? descParts.join(' • ') : '',
        timeLabel: dateObj ? formatTimelineTimeLabel(dateObj) : (ev.date ? String(ev.date) : '—'),
      });
    }

    if (Array.isArray(order.statusHistory)) {
      for (const h of order.statusHistory) {
        if (!h || !h.changedAt) continue;
        const d = new Date(h.changedAt);
        timeline.push({
          sortTime: Number.isNaN(d.getTime()) ? 0 : d.getTime(),
          title: getTimelineTitleForStatus(h.status),
          description: '',
          timeLabel: formatTimelineTimeLabel(h.changedAt),
        });
      }
    }

    for (const s of shipmentsSorted) {
      if (!s || !s.createdAt) continue;
      const d = new Date(s.createdAt);
      timeline.push({
        sortTime: Number.isNaN(d.getTime()) ? 0 : d.getTime(),
        title: 'Suivi transporteur disponible',
        description: s.carrier ? `${s.carrier} • ${s.trackingNumber}` : s.trackingNumber,
        timeLabel: formatTimelineTimeLabel(s.createdAt),
      });
    }

    timeline.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));

    const lastUpdateLabel = timeline.length ? timeline[0].title : '—';

    let estimatedDateLabel = '—';
    let estimatedTimeLabel = '';

    const parcelExpectedMs = parcelDelivery && parcelDelivery.timestamp_expected
      ? getEpochMs(parcelDelivery.timestamp_expected)
      : null;
    const parcelExpectedEndMs = parcelDelivery && parcelDelivery.timestamp_expected_end
      ? getEpochMs(parcelDelivery.timestamp_expected_end)
      : null;

    if (parcelExpectedMs) {
      estimatedDateLabel = formatPrettyDateFR(new Date(parcelExpectedMs));
      if (parcelExpectedEndMs && parcelExpectedEndMs > parcelExpectedMs) {
        const start = new Date(parcelExpectedMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const end = new Date(parcelExpectedEndMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        estimatedTimeLabel = `${start} - ${end}`;
      }
    } else if (order.status === 'annulee') {
      estimatedDateLabel = '—';
    } else if (order.status === 'livree') {
      const delivered = Array.isArray(order.statusHistory)
        ? order.statusHistory.find((h) => h && h.status === 'livree' && h.changedAt)
        : null;
      estimatedDateLabel = delivered ? formatPrettyDateFR(delivered.changedAt) : 'Livrée';
    } else {
      const eta = addDays(order.createdAt, 3);
      estimatedDateLabel = eta ? formatPrettyDateFR(eta) : '—';
      estimatedTimeLabel = 'Entre 08:00 et 18:00';
    }

    return res.render('account/order-tracking', {
      title: `Suivi ${order.number} - CarParts France`,
      dbConnected,
      order: {
        id: String(order._id),
        number: order.number,
        total: formatEuro(totalCents),
        itemsCount,
        shippingAddress: order.shippingAddress,
        shippingMethod: order.shippingMethod || 'domicile',
        shippingMethodLabel: formatShippingMethod(order.shippingMethod),
        items: Array.isArray(order.items)
          ? order.items.map((it) => {
              const pid = it && it.productId ? String(it.productId) : '';
              const p = pid ? productMap.get(pid) : null;
              return {
                name: it.name,
                quantity: it.quantity,
                unitPrice: formatEuro(it.unitPriceCents),
                imageUrl: p && p.imageUrl ? p.imageUrl : '',
              };
            })
          : [],
      },
      tracking: {
        statusLabel: ui.statusLabel,
        statusBadgeClass: ui.statusBadgeClass,
        statusDotClass: ui.statusDotClass,
        statusDotPulse: ui.statusDotPulse,
        parcelErrorMessage,
        estimatedDateLabel,
        estimatedTimeLabel,
        progressWidthClass: ui.progressWidthClass,
        steps,
        lastUpdateLabel,
        timeline: timeline.map((t) => ({
          title: t.title,
          description: t.description,
          timeLabel: t.timeLabel,
        })),
        trackingNumber: lastShipment && lastShipment.trackingNumber ? lastShipment.trackingNumber : '',
        trackingCarrier: lastShipment && lastShipment.carrier ? lastShipment.carrier : '',
        shippingSubtitle: formatShippingMethod(order.shippingMethod),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function postRepurchaseOrder(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;
    const { orderId } = req.params;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('errors/500', {
        title: 'Erreur - CarParts France',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(404).render('errors/404', {
        title: 'Page introuvable - CarParts France',
      });
    }

    const order = await Order.findOne({ _id: orderId, userId: sessionUser._id }).lean();

    if (!order || !Array.isArray(order.items) || order.items.length === 0) {
      return res.redirect('/panier');
    }

    const cart = getCart(req);

    for (const it of order.items) {
      const pid = it && it.productId ? String(it.productId) : '';
      const qty = it && Number.isFinite(it.quantity) ? it.quantity : 1;

      if (!pid) continue;

      if (!cart.items[pid]) {
        cart.items[pid] = { productId: pid, quantity: 0 };
      }

      const currentQty = Number.isFinite(cart.items[pid].quantity) ? cart.items[pid].quantity : 0;
      cart.items[pid].quantity = Math.min(currentQty + qty, 99);
    }

    return res.redirect('/panier');
  } catch (err) {
    return next(err);
  }
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function hashPassword(password, salt) {
  if (typeof password !== 'string' || password.length === 0) return '';
  if (typeof salt !== 'string' || salt.length === 0) return '';
  return crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
}

function formatEuro(totalCents) {
  return `${(totalCents / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDateFR(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function capitalizeFirst(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatOrderListDate(value) {
  if (!value) return { line1: '—', line2: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { line1: '—', line2: '' };

  const line1 = capitalizeFirst(
    d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
    }).replace('.', '')
  );

  const line2 = String(d.getFullYear());
  return { line1, line2 };
}

function getStatusBadge(status) {
  switch (status) {
    case 'expediee':
      return { label: 'Expédiée', className: 'bg-blue-50 text-blue-700' };
    case 'livree':
      return { label: 'Livrée', className: 'bg-green-50 text-green-700' };
    case 'annulee':
      return { label: 'Annulée', className: 'bg-red-50 text-red-700' };
    case 'validee':
      return { label: 'En préparation', className: 'bg-amber-50 text-amber-800' };
    case 'en_attente':
    default:
      return { label: 'En attente', className: 'bg-amber-50 text-amber-800' };
  }
}

function formatDateTimeFR(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const date = d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const time = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${date} à ${time}`;
}

function formatShippingMethod(value) {
  switch (value) {
    case 'retrait':
      return 'Retrait magasin';
    case 'domicile':
    default:
      return 'Livraison à domicile';
  }
}

function getOrderStatusBanner(status) {
  switch (status) {
    case 'expediee':
      return {
        title: "Votre commande est en cours d'expédition",
        subtitle: "Livraison prévue estimée sous 2-3 jours ouvrés.",
      };
    case 'validee':
      return {
        title: 'Votre commande est validée',
        subtitle: 'Nous préparons ton colis.',
      };
    case 'livree':
      return {
        title: 'Votre commande a été livrée',
        subtitle: 'Merci pour ta commande.',
      };
    case 'annulee':
      return {
        title: 'Votre commande a été annulée',
        subtitle: 'Si besoin, contacte le support.',
      };
    case 'en_attente':
    default:
      return {
        title: 'Votre commande est en cours de préparation',
        subtitle: 'Nous confirmons et préparons les articles.',
      };
  }
}

function formatOrderStatus(status) {
  switch (status) {
    case 'en_attente':
      return "En attente";
    case 'validee':
      return 'Validée';
    case 'expediee':
      return 'Expédiée';
    case 'livree':
      return 'Livrée';
    case 'annulee':
      return 'Annulée';
    default:
      return '—';
  }
}

async function getAccount(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    let addresses = [];
    let defaultAddress = null;

    let inProgressOrderCount = 0;
    let recentOrders = [];

    if (dbConnected && sessionUser && sessionUser._id) {
      const user = await User.findById(sessionUser._id).lean();

      if (!user) {
        delete req.session.user;
        return res.redirect('/compte/connexion?returnTo=%2Fcompte');
      }

      addresses = Array.isArray(user.addresses) ? user.addresses : [];
      defaultAddress = addresses.find((a) => a && a.isDefault) || null;

      req.session.user = {
        _id: String(user._id),
        accountType: user.accountType,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        companyName: user.companyName || '',
        discountPercent: typeof user.discountPercent === 'number' ? user.discountPercent : 0,
      };

      req.session.accountType = user.accountType;

      const inProgressStatuses = ['en_attente', 'validee', 'expediee'];
      inProgressOrderCount = await Order.countDocuments({
        userId: user._id,
        status: { $in: inProgressStatuses },
      });

      const orders = await Order.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      recentOrders = orders.map((o) => ({
        id: String(o._id),
        number: o.number,
        date: formatDateFR(o.createdAt),
        status: formatOrderStatus(o.status),
        total: formatEuro(o.totalCents),
      }));
    }

    return res.render('account/index', {
      title: 'Mon compte - CarParts France',
      dbConnected,
      currentUser: req.session.user || null,
      accountType: req.session.accountType === 'pro' ? 'pro' : 'particulier',
      addressCount: addresses.length,
      defaultAddress,
      orderCount: inProgressOrderCount,
      vehicleCount: 0,
      orders: recentOrders,
      vehicles: [],
    });
  } catch (err) {
    return next(err);
  }
}

async function getOrdersPage(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('account/orders', {
        title: 'Mes commandes - CarParts France',
        dbConnected,
        orders: [],
      });
    }

    const orders = await Order.find({ userId: sessionUser._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const viewOrders = orders.map((o) => {
      const dateParts = formatOrderListDate(o.createdAt);
      const statusBadge = getStatusBadge(o.status);
      const itemCount = Array.isArray(o.items)
        ? o.items.reduce((sum, it) => {
            if (!it || !Number.isFinite(it.quantity)) return sum;
            return sum + it.quantity;
          }, 0)
        : 0;

      const consigne = computeConsigneSummaryForOrder(o);

      return {
        id: String(o._id),
        number: o.number,
        date: formatDateFR(o.createdAt),
        dateLine1: dateParts.line1,
        dateLine2: dateParts.line2,
        itemCount,
        status: formatOrderStatus(o.status),
        statusKey: o.status,
        statusBadge,
        total: formatEuro(o.totalCents),
        consigne,
      };
    });

    return res.render('account/orders', {
      title: 'Mes commandes - CarParts France',
      dbConnected,
      orders: viewOrders,
    });
  } catch (err) {
    return next(err);
  }
}

function getGaragePage(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;

  return res.render('account/garage', {
    title: 'Mon garage - CarParts France',
    dbConnected,
    vehicles: [],
  });
}

function setAccountType(req, res) {
  if (req.session.user) {
    const returnToBlocked = getSafeReturnTo(req.body.returnTo);
    return res.redirect(returnToBlocked || '/compte');
  }

  const type = typeof req.body.type === 'string' ? req.body.type : '';
  req.session.accountType = type === 'pro' ? 'pro' : 'particulier';

  const returnTo = getSafeReturnTo(req.body.returnTo);
  const target = returnTo || '/compte';

  if (!req.session || typeof req.session.save !== 'function') {
    return res.redirect(target);
  }

  return req.session.save(() => res.redirect(target));
}

function getLogin(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;
  const returnTo = getSafeReturnTo(req.query.returnTo) || '/compte';

  const successMessage = req.session && req.session.accountSuccess ? String(req.session.accountSuccess) : null;
  if (req.session) delete req.session.accountSuccess;

  res.render('account/login', {
    title: 'Connexion - CarParts France',
    dbConnected,
    errorMessage: null,
    successMessage,
    email: '',
    returnTo,
  });
}

async function postLogin(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;

    if (!dbConnected) {
      return res.status(503).render('account/login', {
        title: 'Connexion - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Impossible de se connecter pour le moment.",
        email: normalizeEmail(req.body.email),
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).render('account/login', {
        title: 'Connexion - CarParts France',
        dbConnected,
        errorMessage: 'Merci de renseigner ton email et ton mot de passe.',
        email,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    const user = await User.findOne({ email }).lean();

    if (!user) {
      return res.status(401).render('account/login', {
        title: 'Connexion - CarParts France',
        dbConnected,
        errorMessage: 'Identifiants incorrects.',
        email,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    const computed = hashPassword(password, user.passwordSalt);

    if (computed !== user.passwordHash) {
      return res.status(401).render('account/login', {
        title: 'Connexion - CarParts France',
        dbConnected,
        errorMessage: 'Identifiants incorrects.',
        email,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    req.session.user = {
      _id: String(user._id),
      accountType: user.accountType,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      companyName: user.companyName || '',
      discountPercent: typeof user.discountPercent === 'number' ? user.discountPercent : 0,
    };

    req.session.accountType = user.accountType;

    const returnTo = getSafeReturnTo(req.body.returnTo);
    const target = returnTo || '/compte';
    return req.session.save(() => res.redirect(target));
  } catch (err) {
    return next(err);
  }
}

function getSecurity(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;

  res.render('account/security', {
    title: 'Sécurité - CarParts France',
    dbConnected,
    errorMessage: null,
    successMessage: null,
  });
}

async function postSecurity(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('account/security', {
        title: 'Sécurité - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Impossible de changer le mot de passe.",
        successMessage: null,
      });
    }

    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).render('account/security', {
        title: 'Sécurité - CarParts France',
        dbConnected,
        errorMessage: 'Merci de remplir tous les champs.',
        successMessage: null,
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).render('account/security', {
        title: 'Sécurité - CarParts France',
        dbConnected,
        errorMessage: 'Le nouveau mot de passe doit faire au moins 6 caractères.',
        successMessage: null,
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).render('account/security', {
        title: 'Sécurité - CarParts France',
        dbConnected,
        errorMessage: 'La confirmation du mot de passe ne correspond pas.',
        successMessage: null,
      });
    }

    const user = await User.findById(sessionUser._id);

    if (!user) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    const computedCurrent = hashPassword(currentPassword, user.passwordSalt);

    if (computedCurrent !== user.passwordHash) {
      return res.status(401).render('account/security', {
        title: 'Sécurité - CarParts France',
        dbConnected,
        errorMessage: 'Ton mot de passe actuel est incorrect.',
        successMessage: null,
      });
    }

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = hashPassword(newPassword, newSalt);

    user.passwordSalt = newSalt;
    user.passwordHash = newHash;
    await user.save();

    return res.render('account/security', {
      title: 'Sécurité - CarParts France',
      dbConnected,
      errorMessage: null,
      successMessage: 'Mot de passe mis à jour avec succès.',
    });
  } catch (err) {
    return next(err);
  }
}

async function getAddresses(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('account/addresses', {
        title: 'Mes adresses - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Impossible d'afficher tes adresses.",
        addresses: [],
        form: {
          label: '',
          fullName: '',
          phone: '',
          line1: '',
          line2: '',
          postalCode: '',
          city: '',
          country: 'France',
          isDefault: false,
        },
      });
    }

    const user = await User.findById(sessionUser._id).lean();

    if (!user) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    const addresses = Array.isArray(user.addresses) ? user.addresses : [];

    return res.render('account/addresses', {
      title: 'Mes adresses - CarParts France',
      dbConnected,
      errorMessage: null,
      addresses,
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
    });
  } catch (err) {
    return next(err);
  }
}

async function postAddAddress(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
    const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const line1 = typeof req.body.line1 === 'string' ? req.body.line1.trim() : '';
    const line2 = typeof req.body.line2 === 'string' ? req.body.line2.trim() : '';
    const postalCode = typeof req.body.postalCode === 'string' ? req.body.postalCode.trim() : '';
    const city = typeof req.body.city === 'string' ? req.body.city.trim() : '';
    const country = typeof req.body.country === 'string' ? req.body.country.trim() : 'France';
    const isDefault = req.body.isDefault === 'on' || req.body.isDefault === 'true' || req.body.isDefault === true;

    const form = {
      label,
      fullName,
      phone,
      line1,
      line2,
      postalCode,
      city,
      country: country || 'France',
      isDefault: !!isDefault,
    };

    if (!dbConnected) {
      return res.status(503).render('account/addresses', {
        title: 'Mes adresses - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Impossible d'ajouter une adresse.",
        addresses: [],
        form,
      });
    }

    if (!line1 || !postalCode || !city) {
      const userLean = await User.findById(sessionUser._id).lean();
      const addresses = userLean && Array.isArray(userLean.addresses) ? userLean.addresses : [];

      return res.status(400).render('account/addresses', {
        title: 'Mes adresses - CarParts France',
        dbConnected,
        errorMessage: 'Merci de renseigner au minimum : adresse, code postal et ville.',
        addresses,
        form,
      });
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
    return res.redirect('/compte/adresses');
  } catch (err) {
    return next(err);
  }
}

async function postSetDefaultAddress(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;
    const addressId = typeof req.params.addressId === 'string' ? req.params.addressId : '';

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.redirect('/compte/adresses');
    }

    const user = await User.findById(sessionUser._id);
    if (!user) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    if (!Array.isArray(user.addresses) || user.addresses.length === 0) {
      return res.redirect('/compte/adresses');
    }

    const target = user.addresses.id(addressId);
    if (!target) {
      return res.redirect('/compte/adresses');
    }

    user.addresses.forEach((a) => {
      a.isDefault = false;
    });
    target.isDefault = true;

    await user.save();
    return res.redirect('/compte/adresses');
  } catch (err) {
    return next(err);
  }
}

async function postDeleteAddress(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;
    const addressId = typeof req.params.addressId === 'string' ? req.params.addressId : '';

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.redirect('/compte/adresses');
    }

    const user = await User.findById(sessionUser._id);
    if (!user) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    if (!Array.isArray(user.addresses) || user.addresses.length === 0) {
      return res.redirect('/compte/adresses');
    }

    const target = user.addresses.id(addressId);
    if (!target) {
      return res.redirect('/compte/adresses');
    }

    const wasDefault = !!target.isDefault;
    target.deleteOne();

    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    return res.redirect('/compte/adresses');
  } catch (err) {
    return next(err);
  }
}

function getRegister(req, res) {
  const dbConnected = mongoose.connection.readyState === 1;
  const returnTo = getSafeReturnTo(req.query.returnTo) || '/compte';

  const defaultType = req.session.accountType === 'pro' ? 'pro' : 'particulier';

  res.render('account/register', {
    title: 'Créer un compte - CarParts France',
    dbConnected,
    errorMessage: null,
    form: {
      accountType: defaultType,
      firstName: '',
      lastName: '',
      email: '',
      companyName: '',
      siret: '',
    },
    returnTo,
  });
}

async function postRegister(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const accountType = req.body.accountType === 'pro' ? 'pro' : 'particulier';
    const firstName = typeof req.body.firstName === 'string' ? req.body.firstName.trim() : '';
    const lastName = typeof req.body.lastName === 'string' ? req.body.lastName.trim() : '';
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const companyName = typeof req.body.companyName === 'string' ? req.body.companyName.trim() : '';
    const siret = typeof req.body.siret === 'string' ? req.body.siret.trim() : '';
    const acceptTerms = req.body.acceptTerms === 'on' || req.body.acceptTerms === 'true' || req.body.acceptTerms === true;

    const form = {
      accountType,
      firstName,
      lastName,
      email,
      companyName,
      siret,
    };

    if (!dbConnected) {
      return res.status(503).render('account/register', {
        title: 'Créer un compte - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Impossible de créer un compte pour le moment.",
        form,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).render('account/register', {
        title: 'Créer un compte - CarParts France',
        dbConnected,
        errorMessage: 'Merci de remplir tous les champs obligatoires.',
        form,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    if (!acceptTerms) {
      return res.status(400).render('account/register', {
        title: 'Créer un compte - CarParts France',
        dbConnected,
        errorMessage: 'Merci d’accepter les CGV et la politique de confidentialité.',
        form,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    if (password.length < 6) {
      return res.status(400).render('account/register', {
        title: 'Créer un compte - CarParts France',
        dbConnected,
        errorMessage: 'Le mot de passe doit faire au moins 6 caractères.',
        form,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    if (accountType === 'pro' && (!companyName || !siret)) {
      return res.status(400).render('account/register', {
        title: 'Créer un compte - CarParts France',
        dbConnected,
        errorMessage: 'Pour un compte Pro, merci de renseigner la société et le SIRET.',
        form,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    const created = await User.create({
      accountType,
      firstName,
      lastName,
      email,
      passwordSalt: salt,
      passwordHash,
      companyName: accountType === 'pro' ? companyName : '',
      siret: accountType === 'pro' ? siret : '',
    });

    try {
      await emailService.sendWelcomeEmail({ user: created });
    } catch (err) {
      console.error('Erreur email bienvenue :', err && err.message ? err.message : err);
    }

    req.session.user = {
      _id: String(created._id),
      accountType: created.accountType,
      firstName: created.firstName,
      lastName: created.lastName,
      email: created.email,
      companyName: created.companyName || '',
      discountPercent: typeof created.discountPercent === 'number' ? created.discountPercent : 0,
    };

    req.session.accountType = created.accountType;

    const returnTo = getSafeReturnTo(req.body.returnTo);
    const target = returnTo || '/compte';
    return req.session.save(() => res.redirect(target));
  } catch (err) {
    if (err && err.code === 11000) {
      const dbConnected = mongoose.connection.readyState === 1;
      const form = {
        accountType: req.body.accountType === 'pro' ? 'pro' : 'particulier',
        firstName: typeof req.body.firstName === 'string' ? req.body.firstName.trim() : '',
        lastName: typeof req.body.lastName === 'string' ? req.body.lastName.trim() : '',
        email: normalizeEmail(req.body.email),
        companyName: typeof req.body.companyName === 'string' ? req.body.companyName.trim() : '',
        siret: typeof req.body.siret === 'string' ? req.body.siret.trim() : '',
      };

      return res.status(409).render('account/register', {
        title: 'Créer un compte - CarParts France',
        dbConnected,
        errorMessage: 'Un compte existe déjà avec cet email.',
        form,
        returnTo: getSafeReturnTo(req.body.returnTo) || '/compte',
      });
    }

    return next(err);
  }
}

function postLogout(req, res) {
  delete req.session.user;

  const returnTo = getSafeReturnTo(req.body.returnTo);
  const target = returnTo || '/';

  if (!req.session || typeof req.session.save !== 'function') {
    return res.redirect(target);
  }

  return req.session.save(() => res.redirect(target));
}

async function getProfile(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    if (!dbConnected) {
      return res.status(503).render('account/profile', {
        title: 'Mon profil - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Impossible d'afficher le profil.",
        form: {
          accountType: sessionUser.accountType === 'pro' ? 'pro' : 'particulier',
          firstName: sessionUser.firstName || '',
          lastName: sessionUser.lastName || '',
          email: sessionUser.email || '',
          companyName: '',
          siret: '',
        },
      });
    }

    const user = await User.findById(sessionUser._id).lean();

    if (!user) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    return res.render('account/profile', {
      title: 'Mon profil - CarParts France',
      dbConnected,
      errorMessage: null,
      form: {
        accountType: user.accountType === 'pro' ? 'pro' : 'particulier',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        companyName: user.companyName || '',
        siret: user.siret || '',
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function postProfile(req, res, next) {
  try {
    const dbConnected = mongoose.connection.readyState === 1;
    const sessionUser = req.session.user;

    if (!sessionUser || !sessionUser._id) {
      return res.redirect('/compte');
    }

    const firstName = typeof req.body.firstName === 'string' ? req.body.firstName.trim() : '';
    const lastName = typeof req.body.lastName === 'string' ? req.body.lastName.trim() : '';
    const companyName = typeof req.body.companyName === 'string' ? req.body.companyName.trim() : '';
    const siret = typeof req.body.siret === 'string' ? req.body.siret.trim() : '';

    const form = {
      accountType: sessionUser.accountType === 'pro' ? 'pro' : 'particulier',
      firstName,
      lastName,
      email: sessionUser.email || '',
      companyName,
      siret,
    };

    if (!dbConnected) {
      return res.status(503).render('account/profile', {
        title: 'Mon profil - CarParts France',
        dbConnected,
        errorMessage: "La base de données n'est pas disponible. Impossible d'enregistrer.",
        form,
      });
    }

    if (!firstName || !lastName) {
      return res.status(400).render('account/profile', {
        title: 'Mon profil - CarParts France',
        dbConnected,
        errorMessage: 'Merci de renseigner ton prénom et ton nom.',
        form,
      });
    }

    if (form.accountType === 'pro' && (!companyName || !siret)) {
      return res.status(400).render('account/profile', {
        title: 'Mon profil - CarParts France',
        dbConnected,
        errorMessage: 'Pour un compte Pro, merci de renseigner la société et le SIRET.',
        form,
      });
    }

    const updated = await User.findByIdAndUpdate(
      sessionUser._id,
      {
        $set: {
          firstName,
          lastName,
          companyName: form.accountType === 'pro' ? companyName : '',
          siret: form.accountType === 'pro' ? siret : '',
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      delete req.session.user;
      return res.redirect('/compte');
    }

    req.session.user = {
      _id: String(updated._id),
      accountType: updated.accountType,
      firstName: updated.firstName,
      lastName: updated.lastName,
      email: updated.email,
      companyName: updated.companyName || '',
      discountPercent: typeof updated.discountPercent === 'number' ? updated.discountPercent : 0,
    };

    req.session.accountType = updated.accountType;

    return res.redirect('/compte/profil');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getAccount,
  setAccountType,
  getLogin,
  postLogin,
  getRegister,
  postRegister,
  getForgotPassword,
  postForgotPassword,
  getResetPassword,
  postResetPassword,
  postLogout,
  getProfile,
  postProfile,
  getSecurity,
  postSecurity,
  getAddresses,
  postAddAddress,
  postSetDefaultAddress,
  postDeleteAddress,
  getOrdersPage,
  getOrderDetailPage,
  getOrderTrackingPage,
  postRepurchaseOrder,
  getInvoicesPage,
  getGaragePage,
};
