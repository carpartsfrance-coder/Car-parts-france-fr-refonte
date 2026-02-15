const {
  buildOrderConfirmationEmail,
  buildConsigneStartEmail,
  buildConsigneReceivedEmail,
  buildShipmentTrackingEmail,
  buildConsigneReminderSoonEmail,
  buildConsigneOverdueEmail,
  buildWelcomeEmail,
  buildResetPasswordEmail,
} = require('./emailTemplates');

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');

const { buildOrderInvoicePdfBuffer } = require('./invoicePdf');
const { buildLegalPdfBuffer } = require('./legalPdf');
const { getLegalPageBySlug } = require('./legalPages');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolvePublicUrl(baseUrl, rawUrl) {
  const input = getTrimmedString(rawUrl);
  if (!input) return '';
  if (/^https?:\/\//i.test(input)) return input;
  if (!baseUrl) return '';
  const base = String(baseUrl).replace(/\/$/, '');
  if (input.startsWith('/')) return `${base}${input}`;
  return `${base}/${input}`;
}

function readFileIfExists(filePath) {
  try {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch (err) {
    return null;
  }
}

async function getCgvPdfBuffer({ dbConnected } = {}) {
  const custom = getTrimmedString(process.env.CGV_PDF_PATH);
  if (!custom) {
    try {
      const page = await getLegalPageBySlug({ slug: 'cgv', dbConnected, includeUnpublished: false });
      if (!page) return null;

      const pdf = await buildLegalPdfBuffer({ title: page.title || 'CGV', content: page.content || '' });
      if (pdf && Buffer.isBuffer(pdf) && pdf.length) return pdf;
    } catch (err) {
      // ignore
    }
  }

  if (custom) {
    const abs = path.isAbsolute(custom)
      ? custom
      : path.join(__dirname, '..', '..', custom);
    const buf = readFileIfExists(abs);
    if (buf && Buffer.isBuffer(buf) && buf.length) return buf;
  }

  const fallback = path.join(__dirname, '..', '..', 'public', 'cgv.pdf');
  const fallbackBuf = readFileIfExists(fallback);
  if (fallbackBuf && Buffer.isBuffer(fallbackBuf) && fallbackBuf.length) return fallbackBuf;

  return null;
}

function getDbConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

async function hydrateUserForEmail(user) {
  if (!user || !user._id) return user;
  if (user.firstName && user.lastName && user.email) return user;
  try {
    const full = await User.findById(user._id)
      .select('_id email firstName lastName companyName siret accountType')
      .lean();
    return full || user;
  } catch (err) {
    return user;
  }
}

async function hydrateOrderForEmail(order) {
  if (!order || !order._id) return order;
  const hasItems = Array.isArray(order.items) && order.items.length;
  const hasTotals = Number.isFinite(order.totalCents);
  if (hasItems && hasTotals) return order;

  try {
    const full = await Order.findById(order._id).lean();
    return full || order;
  } catch (err) {
    return order;
  }
}

async function addProductImagesToOrder({ order, baseUrl } = {}) {
  if (!order || !Array.isArray(order.items) || !order.items.length) return order;

  const ids = order.items
    .map((it) => (it && it.productId ? String(it.productId) : ''))
    .filter(Boolean);

  if (!ids.length) return order;

  try {
    const products = await Product.find({ _id: { $in: ids } })
      .select('_id imageUrl')
      .lean();

    const byId = new Map();
    for (const p of products) {
      byId.set(String(p._id), p);
    }

    const nextItems = order.items.map((it) => {
      if (!it || !it.productId) return it;
      const p = byId.get(String(it.productId));
      const resolved = p && p.imageUrl ? resolvePublicUrl(baseUrl, p.imageUrl) : '';
      return { ...it, imageUrl: resolved };
    });

    return { ...order, items: nextItems };
  } catch (err) {
    return order;
  }
}

function getMailerSendApiKey() {
  return getTrimmedString(process.env.MAILERSEND_API_KEY);
}

function getBaseUrl() {
  return getTrimmedString(process.env.PUBLIC_BASE_URL);
}

function resolveToEmail(toEmail) {
  const original = getTrimmedString(toEmail);
  const forced = getTrimmedString(process.env.MAIL_FORCE_TO);
  if (forced) return { toEmail: forced, forcedFrom: original || null };

  const isProd = process.env.NODE_ENV === 'production';
  const testTo = getTrimmedString(process.env.MAIL_TEST_TO);
  if (!isProd && testTo) return { toEmail: testTo, forcedFrom: original || null };

  return { toEmail: original, forcedFrom: null };
}

function getFrom() {
  return {
    email: getTrimmedString(process.env.MAIL_FROM_EMAIL),
    name: getTrimmedString(process.env.MAIL_FROM_NAME) || 'CarPartsFrance',
  };
}

async function sendEmail({ toEmail, subject, html, text, attachments } = {}) {
  const apiKey = getMailerSendApiKey();
  const from = getFrom();

  if (!apiKey) {
    console.error('MAILERSEND_API_KEY manquant : email non envoyé');
    return { ok: false, reason: 'missing_api_key' };
  }
  if (!from.email) {
    console.error('MAIL_FROM_EMAIL manquant : email non envoyé');
    return { ok: false, reason: 'missing_from_email' };
  }

  const resolved = resolveToEmail(toEmail);
  if (!resolved.toEmail) {
    console.error('Destinataire manquant : email non envoyé');
    return { ok: false, reason: 'missing_to_email' };
  }

  const safeSubject = getTrimmedString(subject) || 'Message';
  const finalSubject = resolved.forcedFrom ? `[DEV] ${safeSubject}` : safeSubject;

  const payload = {
    from: { email: from.email, name: from.name },
    to: [{ email: resolved.toEmail }],
    subject: finalSubject,
    html: typeof html === 'string' && html.trim() ? html : undefined,
    text: typeof text === 'string' && text.trim() ? text : undefined,
  };

  if (Array.isArray(attachments) && attachments.length) {
    payload.attachments = attachments
      .filter((a) => a && typeof a.filename === 'string' && a.filename.trim() && typeof a.content === 'string' && a.content.trim())
      .map((a) => ({
        filename: a.filename.trim(),
        content: a.content.trim(),
        disposition: a.disposition === 'inline' ? 'inline' : 'attachment',
      }));

    if (!payload.attachments.length) {
      delete payload.attachments;
    }
  }

  try {
    const res = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 202) {
      return { ok: true, forcedFrom: resolved.forcedFrom };
    }

    const bodyText = await res.text();
    console.error('MailerSend email refusé :', res.status, res.statusText, bodyText ? bodyText.slice(0, 1200) : '');
    return { ok: false, reason: 'mailersend_error', status: res.status };
  } catch (err) {
    console.error('MailerSend erreur envoi email :', err && err.message ? err.message : err);
    return { ok: false, reason: 'network_error' };
  }
}

async function sendOrderConfirmationEmail({ order, user } = {}) {
  if (!order || !user || !user.email) return { ok: false, reason: 'missing_data' };
  const baseUrl = getBaseUrl();

  const fullUser = await hydrateUserForEmail(user);
  const fullOrder = await hydrateOrderForEmail(order);
  const orderWithImages = await addProductImagesToOrder({ order: fullOrder, baseUrl });

  const attachments = [];
  let hasInvoice = false;
  let hasCgv = false;

  try {
    const invoiceBuffer = await buildOrderInvoicePdfBuffer({ order: orderWithImages, user: fullUser });
    if (invoiceBuffer && Buffer.isBuffer(invoiceBuffer) && invoiceBuffer.length) {
      const number = orderWithImages && orderWithImages.number ? String(orderWithImages.number).trim() : '';
      const filename = number ? `Facture-${number}.pdf` : 'Facture.pdf';
      attachments.push({ filename, content: invoiceBuffer.toString('base64'), disposition: 'attachment' });
      hasInvoice = true;
    }
  } catch (err) {
    console.warn('Facture PDF: génération impossible');
  }

  const cgvBuffer = await getCgvPdfBuffer({ dbConnected: getDbConnected() });
  if (cgvBuffer && Buffer.isBuffer(cgvBuffer) && cgvBuffer.length) {
    attachments.push({ filename: 'CGV-CarPartsFrance.pdf', content: cgvBuffer.toString('base64'), disposition: 'attachment' });
    hasCgv = true;
  }

  const built = buildOrderConfirmationEmail({
    order: orderWithImages,
    user: fullUser,
    baseUrl,
    meta: { hasInvoice, hasCgv },
  });
  return sendEmail({
    toEmail: fullUser.email,
    subject: built.subject,
    html: built.html,
    text: built.text,
    attachments,
  });
}

async function sendConsigneStartEmail({ order, user } = {}) {
  if (!order || !user || !user.email) return { ok: false, reason: 'missing_data' };
  const baseUrl = getBaseUrl();
  const built = buildConsigneStartEmail({ order, user, baseUrl });
  if (!built) return { ok: false, reason: 'no_consigne' };
  return sendEmail({ toEmail: user.email, subject: built.subject, html: built.html, text: built.text });
}

async function sendConsigneReceivedEmail({ order, user } = {}) {
  if (!order || !user || !user.email) return { ok: false, reason: 'missing_data' };
  const baseUrl = getBaseUrl();
  const built = buildConsigneReceivedEmail({ order, user, baseUrl });
  return sendEmail({ toEmail: user.email, subject: built.subject, html: built.html, text: built.text });
}

async function sendShipmentTrackingEmail({ order, user, shipment } = {}) {
  if (!order || !user || !user.email || !shipment) return { ok: false, reason: 'missing_data' };
  const baseUrl = getBaseUrl();

  const fullUser = await hydrateUserForEmail(user);
  const fullOrder = await hydrateOrderForEmail(order);
  const orderWithImages = await addProductImagesToOrder({ order: fullOrder, baseUrl });

  const attachments = [];
  let hasInvoice = false;
  let hasCgv = false;

  try {
    const invoiceBuffer = await buildOrderInvoicePdfBuffer({ order: orderWithImages, user: fullUser });
    if (invoiceBuffer && Buffer.isBuffer(invoiceBuffer) && invoiceBuffer.length) {
      const number = orderWithImages && orderWithImages.number ? String(orderWithImages.number).trim() : '';
      const filename = number ? `Facture-${number}.pdf` : 'Facture.pdf';
      attachments.push({ filename, content: invoiceBuffer.toString('base64'), disposition: 'attachment' });
      hasInvoice = true;
    }
  } catch (err) {
    console.warn('Facture PDF: génération impossible (expédition)');
  }

  const cgvBuffer = await getCgvPdfBuffer({ dbConnected: getDbConnected() });
  if (cgvBuffer && Buffer.isBuffer(cgvBuffer) && cgvBuffer.length) {
    attachments.push({ filename: 'CGV-CarPartsFrance.pdf', content: cgvBuffer.toString('base64'), disposition: 'attachment' });
    hasCgv = true;
  }

  const built = buildShipmentTrackingEmail({
    order: orderWithImages,
    user: fullUser,
    shipment,
    baseUrl,
    meta: { hasInvoice, hasCgv },
  });
  return sendEmail({
    toEmail: fullUser.email,
    subject: built.subject,
    html: built.html,
    text: built.text,
    attachments,
  });
}

async function sendConsigneReminderSoonEmail({ order, user } = {}) {
  if (!order || !user || !user.email) return { ok: false, reason: 'missing_data' };
  const baseUrl = getBaseUrl();
  const built = buildConsigneReminderSoonEmail({ order, user, baseUrl });
  if (!built) return { ok: false, reason: 'no_consigne' };
  return sendEmail({ toEmail: user.email, subject: built.subject, html: built.html, text: built.text });
}

async function sendConsigneOverdueEmail({ order, user } = {}) {
  if (!order || !user || !user.email) return { ok: false, reason: 'missing_data' };
  const baseUrl = getBaseUrl();
  const built = buildConsigneOverdueEmail({ order, user, baseUrl });
  if (!built) return { ok: false, reason: 'no_consigne' };
  return sendEmail({ toEmail: user.email, subject: built.subject, html: built.html, text: built.text });
}

async function sendWelcomeEmail({ user } = {}) {
  if (!user || !user.email) return { ok: false, reason: 'missing_data' };
  const baseUrl = getBaseUrl();
  const built = buildWelcomeEmail({ user, baseUrl });
  return sendEmail({ toEmail: user.email, subject: built.subject, html: built.html, text: built.text });
}

async function sendResetPasswordEmail({ user, resetUrl } = {}) {
  if (!user || !user.email) return { ok: false, reason: 'missing_data' };
  const url = getTrimmedString(resetUrl);
  if (!url) return { ok: false, reason: 'missing_reset_url' };
  const baseUrl = getBaseUrl();
  const built = buildResetPasswordEmail({ user, resetUrl: url, baseUrl });
  return sendEmail({ toEmail: user.email, subject: built.subject, html: built.html, text: built.text });
}

module.exports = {
  sendEmail,
  sendOrderConfirmationEmail,
  sendConsigneStartEmail,
  sendConsigneReceivedEmail,
  sendShipmentTrackingEmail,
  sendConsigneReminderSoonEmail,
  sendConsigneOverdueEmail,
  sendWelcomeEmail,
  sendResetPasswordEmail,
};
