function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEuro(totalCents) {
  if (!Number.isFinite(totalCents)) return '—';
  return `${(totalCents / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDateFR(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatShippingMethod(method) {
  const key = getTrimmedString(method);
  if (key === 'domicile') return 'Livraison à domicile';
  if (key === 'relais') return 'Point relais';
  if (key === 'magasin') return 'Retrait magasin';
  return key ? `Livraison (${key})` : 'Livraison';
}

function computeOrderTotals(order) {
  const shippingCostCents = order && Number.isFinite(order.shippingCostCents) ? order.shippingCostCents : 0;

  const fallbackItemsSubtotalCents = Array.isArray(order && order.items)
    ? order.items.reduce((sum, it) => {
        if (!it || !Number.isFinite(it.lineTotalCents)) return sum;
        return sum + it.lineTotalCents;
      }, 0)
    : 0;

  const itemsSubtotalCents = order && Number.isFinite(order.itemsSubtotalCents)
    ? order.itemsSubtotalCents
    : fallbackItemsSubtotalCents;

  const clientDiscountCents = order && Number.isFinite(order.clientDiscountCents) ? order.clientDiscountCents : 0;
  const promoDiscountCents = order && Number.isFinite(order.promoDiscountCents) ? order.promoDiscountCents : 0;

  const itemsTotalAfterDiscountCents = order && Number.isFinite(order.itemsTotalAfterDiscountCents)
    ? order.itemsTotalAfterDiscountCents
    : Math.max(0, itemsSubtotalCents - clientDiscountCents - promoDiscountCents);

  const totalCents = order && Number.isFinite(order.totalCents)
    ? order.totalCents
    : itemsTotalAfterDiscountCents + shippingCostCents;

  const htCents = Math.round(totalCents / 1.2);
  const vatCents = totalCents - htCents;

  return {
    shippingCostCents,
    itemsSubtotalCents,
    clientDiscountCents,
    promoDiscountCents,
    itemsTotalAfterDiscountCents,
    totalCents,
    htCents,
    vatCents,
  };
}

function renderAddressBlock(title, address) {
  if (!address) {
    return `<div style="padding:12px 14px;border:1px solid #e5e7eb;background:#ffffff;border-radius:14px;">
      <div style="font-weight:900;color:#0f172a;">${escapeHtml(title)}</div>
      <div style="margin-top:6px;font-size:13px;color:#64748b;">Non renseignée</div>
    </div>`;
  }

  const lines = [
    address.fullName,
    address.line1,
    address.line2,
    `${getTrimmedString(address.postalCode)} ${getTrimmedString(address.city)}`.trim(),
    address.country,
  ].filter((v) => getTrimmedString(v));

  const phone = getTrimmedString(address.phone);

  return `<div style="padding:12px 14px;border:1px solid #e5e7eb;background:#ffffff;border-radius:14px;">
    <div style="font-weight:900;color:#0f172a;">${escapeHtml(title)}</div>
    <div style="margin-top:8px;font-size:13px;color:#334155;line-height:1.5;white-space:pre-line;">${escapeHtml(lines.join('\n'))}</div>
    ${phone ? `<div style="margin-top:6px;font-size:12px;color:#64748b;">Téléphone : <strong style="color:#0f172a;">${escapeHtml(phone)}</strong></div>` : ''}
  </div>`;
}

function renderEmailLayout({ title, preheader, bodyHtml, baseUrl } = {}) {
  const safeTitle = escapeHtml(getTrimmedString(title) || 'CarPartsFrance');
  const safePreheader = escapeHtml(getTrimmedString(preheader) || '');
  const safeBody = String(bodyHtml || '');
  const safeBaseUrl = getTrimmedString(baseUrl);

  const brandUrl = safeBaseUrl || '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:Inter,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7fb;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 30px rgba(15,23,42,0.08);">
          <tr>
            <td style="padding:22px 24px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;line-height:1.2;">
                <span style="color:#0f172a;">CarParts</span><span style="color:#ec1313;">France</span>
              </div>
              <div style="margin-top:4px;font-size:12px;font-weight:600;color:#64748b;">Pièces auto • Catalogue • Devis</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px;">
              ${safeBody}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px;border-top:1px solid #e5e7eb;background:#ffffff;">
              <div style="font-size:12px;color:#64748b;line-height:1.5;">
                <div>Besoin d’aide ? Réponds directement à cet email.</div>
                ${brandUrl ? `<div style="margin-top:8px;"><a href="${escapeHtml(brandUrl)}" style="color:#ec1313;text-decoration:none;font-weight:700;">${escapeHtml(brandUrl.replace(/^https?:\/\//, ''))}</a></div>` : ''}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderPrimaryButton({ href, label } = {}) {
  const url = getTrimmedString(href);
  const text = getTrimmedString(label) || 'Voir';
  if (!url) return '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
  <tr>
    <td bgcolor="#ec1313" style="border-radius:12px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 16px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;border-radius:12px;">${escapeHtml(text)}</a>
    </td>
  </tr>
</table>`;
}

function buildOrderConfirmationEmail({ order, user, baseUrl, meta } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';
  const items = order && Array.isArray(order.items) ? order.items : [];
  const totals = computeOrderTotals(order);

  const firstName = user && user.firstName ? String(user.firstName).trim() : '';
  const greetingName = firstName ? escapeHtml(firstName) : 'Bonjour';

  const createdAtLabel = order && order.createdAt ? formatDateFR(order.createdAt) : '';
  const shippingMethodLabel = formatShippingMethod(order && order.shippingMethod ? order.shippingMethod : '');

  const legalBase = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const cgvUrl = legalBase ? `${legalBase}/legal/cgv` : '';

  const shippingAddressHtml = renderAddressBlock('Adresse de livraison', order && order.shippingAddress ? order.shippingAddress : null);
  const billingAddressHtml = renderAddressBlock('Adresse de facturation', order && order.billingAddress ? order.billingAddress : null);

  const linesHtml = items
    .map((it) => {
      if (!it) return '';
      const name = it.name ? escapeHtml(it.name) : 'Article';
      const qty = Number.isFinite(it.quantity) ? it.quantity : 1;
      const sku = it.sku ? escapeHtml(it.sku) : '';
      const unitTtc = Number.isFinite(it.unitPriceCents) ? it.unitPriceCents : null;
      const unitHt = unitTtc !== null ? Math.round(unitTtc / 1.2) : null;
      const lineTotal = Number.isFinite(it.lineTotalCents) ? formatEuro(it.lineTotalCents) : '—';

      const imageUrl = it.imageUrl ? getTrimmedString(it.imageUrl) : '';
      const imageCell = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${name}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:12px;" />`
        : `<div style="width:56px;height:56px;border-radius:12px;background:#f1f5f9;"></div>`;

      const unitLine = unitTtc !== null
        ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">PU TTC : <strong style="color:#0f172a;">${escapeHtml(formatEuro(unitTtc))}</strong>${unitHt !== null ? ` • PU HT : <strong style="color:#0f172a;">${escapeHtml(formatEuro(unitHt))}</strong>` : ''}</div>`
        : '';

      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:64px;">
          ${imageCell}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;">
          <div style="font-weight:900;color:#0f172a;">${name}</div>
          ${sku ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">Réf : <strong style="color:#0f172a;">${sku}</strong></div>` : ''}
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Quantité : <strong style="color:#0f172a;">${escapeHtml(qty)}</strong></div>
          ${unitLine}
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid #f1f5f9;font-weight:900;white-space:nowrap;vertical-align:top;">${escapeHtml(lineTotal)}</td>
      </tr>`;
    })
    .join('');

  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';

  const hasAnyDiscount = totals.clientDiscountCents > 0 || totals.promoDiscountCents > 0;
  const promoCode = order && typeof order.promoCode === 'string' ? order.promoCode.trim() : '';

  const hasInvoice = meta && meta.hasInvoice === true;
  const hasCgv = meta && meta.hasCgv === true;
  const attachmentsInfo = hasInvoice || hasCgv
    ? `<div style="margin-top:12px;padding:12px 14px;border:1px solid #dcfce7;background:#f0fdf4;border-radius:14px;color:#14532d;font-size:13px;line-height:1.6;">
        <div style="font-weight:900;">Pièces jointes</div>
        <div style="margin-top:6px;">${[
          hasInvoice ? 'Facture PDF' : '',
          hasCgv ? 'CGV (PDF)' : '',
        ].filter(Boolean).map((s) => `• ${escapeHtml(s)}`).join('<br/>')}</div>
      </div>`
    : '';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greetingName},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Nous confirmons la commande${number ? ` <strong>#${escapeHtml(number)}</strong>` : ''}${createdAtLabel ? ` du <strong>${escapeHtml(createdAtLabel)}</strong>` : ''}.
</div>

${attachmentsInfo}

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Livraison & facturation</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  <tr>
    <td style="width:50%;padding-right:6px;vertical-align:top;">${shippingAddressHtml}</td>
    <td style="width:50%;padding-left:6px;vertical-align:top;">${billingAddressHtml}</td>
  </tr>
</table>

<div style="margin-top:18px;padding:12px 14px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  <div style="font-weight:900;">Mode de livraison : ${escapeHtml(shippingMethodLabel)}</div>
</div>

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Articles</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  ${linesHtml || ''}
</table>

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Récapitulatif</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  <tr>
    <td style="padding:6px 0;color:#64748b;">Sous-total articles</td>
    <td align="right" style="padding:6px 0;font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totals.itemsSubtotalCents))}</td>
  </tr>
  ${totals.clientDiscountCents > 0 ? `<tr>
    <td style="padding:6px 0;color:#64748b;">Remise compte${order && Number.isFinite(order.clientDiscountPercent) && order.clientDiscountPercent > 0 ? ` (${escapeHtml(String(order.clientDiscountPercent).replace('.', ','))}%)` : ''}</td>
    <td align="right" style="padding:6px 0;font-weight:900;white-space:nowrap;">- ${escapeHtml(formatEuro(totals.clientDiscountCents))}</td>
  </tr>` : ''}
  ${totals.promoDiscountCents > 0 ? `<tr>
    <td style="padding:6px 0;color:#64748b;">Code promo${promoCode ? ` (${escapeHtml(promoCode)})` : ''}</td>
    <td align="right" style="padding:6px 0;font-weight:900;white-space:nowrap;">- ${escapeHtml(formatEuro(totals.promoDiscountCents))}</td>
  </tr>` : ''}
  ${hasAnyDiscount ? `<tr>
    <td style="padding:6px 0;color:#64748b;">Sous-total après remise</td>
    <td align="right" style="padding:6px 0;font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totals.itemsTotalAfterDiscountCents))}</td>
  </tr>` : ''}
  <tr>
    <td style="padding:6px 0;color:#64748b;">Livraison</td>
    <td align="right" style="padding:6px 0;font-weight:900;white-space:nowrap;">${totals.shippingCostCents === 0 ? 'OFFERT' : escapeHtml(formatEuro(totals.shippingCostCents))}</td>
  </tr>
  <tr>
    <td style="padding:10px 0;font-weight:900;border-top:1px solid #e5e7eb;">Total TTC</td>
    <td align="right" style="padding:10px 0;font-weight:900;white-space:nowrap;border-top:1px solid #e5e7eb;">${escapeHtml(formatEuro(totals.totalCents))}</td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#64748b;">Total HT</td>
    <td align="right" style="padding:6px 0;font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totals.htCents))}</td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:#64748b;">TVA (20%)</td>
    <td align="right" style="padding:6px 0;font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totals.vatCents))}</td>
  </tr>
</table>

${renderPrimaryButton({ href: orderUrl, label: 'Voir ma commande' })}

${cgvUrl ? `<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">CGV : <a href="${escapeHtml(cgvUrl)}" style="color:#ec1313;text-decoration:none;font-weight:800;">${escapeHtml(cgvUrl)}</a></div>` : ''}

<div style="margin-top:16px;font-size:12px;line-height:1.6;color:#64748b;">
  Si vous avez une question, répondez directement à cet email.
</div>`;

  const subject = number ? `Confirmation de commande #${number}` : 'Confirmation de commande';

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: number ? `Commande #${number} confirmée` : 'Commande confirmée',
      bodyHtml,
      baseUrl,
    }),
    text: `${firstName ? `${firstName}, ` : ''}commande confirmée${number ? ` (#${number})` : ''}. Total TTC : ${formatEuro(totals.totalCents)}. Total HT : ${formatEuro(totals.htCents)}.`,
  };
}

function buildConsigneStartEmail({ order, user, baseUrl } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';

  const lines = order && order.consigne && Array.isArray(order.consigne.lines) ? order.consigne.lines : [];
  const relevant = lines.filter((l) => l && !l.receivedAt);
  if (!relevant.length) {
    return null;
  }

  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';

  const rows = relevant
    .map((l) => {
      const name = l.name ? escapeHtml(l.name) : 'Pièce';
      const qty = Number.isFinite(l.quantity) ? l.quantity : 1;
      const amountUnit = Number.isFinite(l.amountCents) ? formatEuro(l.amountCents) : '—';
      const amountTotal = Number.isFinite(l.amountCents) && Number.isFinite(l.quantity)
        ? formatEuro(l.amountCents * l.quantity)
        : '—';
      const dueAt = l.dueAt ? formatDateFR(l.dueAt) : '—';

      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <div style="font-weight:900;color:#0f172a;">${name}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Quantité : ${escapeHtml(qty)} • Consigne : ${escapeHtml(amountUnit)} / pièce</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">À retourner avant le : <strong>${escapeHtml(dueAt)}</strong></div>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-weight:900;white-space:nowrap;">${escapeHtml(amountTotal)}</td>
      </tr>`;
    })
    .join('');

  const totalDueCents = relevant.reduce((sum, l) => {
    const qty = Number.isFinite(l && l.quantity) ? l.quantity : 0;
    const amt = Number.isFinite(l && l.amountCents) ? l.amountCents : 0;
    return sum + qty * amt;
  }, 0);

  const subject = number ? `Consigne : retour de l'ancienne pièce (commande #${number})` : "Consigne : retour de l'ancienne pièce";

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">Information consigne</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Votre commande${number ? ` <strong>#${escapeHtml(number)}</strong>` : ''} est indiquée comme <strong>livrée</strong>.
  À partir de maintenant, vous disposez d’un délai pour nous retourner votre ancienne pièce.
</div>

<div style="margin-top:12px;padding:12px 14px;border:1px solid #fee2e2;background:#fff1f2;border-radius:14px;color:#881337;font-size:13px;line-height:1.6;">
  La consigne <strong>n’est pas encaissée</strong> à l’achat.
  Par contre, si l’ancienne pièce n’est pas retournée à temps, le montant de consigne devient dû.
</div>

<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">
  ${rows}
  <tr>
    <td style="padding:12px 0;font-weight:900;">Total consigne (si non retournée à temps)</td>
    <td align="right" style="padding:12px 0;font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totalDueCents))}</td>
  </tr>
</table>

${renderPrimaryButton({ href: orderUrl, label: 'Voir le détail de ma consigne' })}

<div style="margin-top:16px;font-size:12px;line-height:1.6;color:#64748b;">
  Si vous avez déjà renvoyé la pièce, vous pouvez ignorer ce message.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Consigne : pensez à retourner votre ancienne pièce',
      bodyHtml,
      baseUrl,
    }),
    text: `Consigne : pensez à retourner votre ancienne pièce. Total consigne (si non retournée à temps) : ${formatEuro(totalDueCents)}.`,
  };
}

function buildConsigneReceivedEmail({ order, user, baseUrl } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';

  const subject = number ? `Consigne reçue - commande #${number}` : 'Consigne reçue';
  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">Merci !</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Nous confirmons avoir reçu votre ancienne pièce (consigne) pour la commande${number ? ` <strong>#${escapeHtml(number)}</strong>` : ''}.
</div>

<div style="margin-top:12px;padding:12px 14px;border:1px solid #dcfce7;background:#f0fdf4;border-radius:14px;color:#14532d;font-size:13px;line-height:1.6;">
  Votre consigne est maintenant considérée comme <strong>régularisée</strong>.
</div>

${renderPrimaryButton({ href: orderUrl, label: 'Voir ma commande' })}`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Consigne reçue',
      bodyHtml,
      baseUrl,
    }),
    text: `Nous confirmons avoir reçu votre consigne pour la commande${number ? ` #${number}` : ''}.`,
  };
}

function buildShipmentTrackingEmail({ order, user, shipment, baseUrl, meta } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';

  const totals = computeOrderTotals(order);
  const items = order && Array.isArray(order.items) ? order.items : [];

  const carrier = shipment && shipment.carrier ? String(shipment.carrier).trim() : '';
  const trackingNumber = shipment && shipment.trackingNumber ? String(shipment.trackingNumber).trim() : '';
  const label = shipment && shipment.label ? String(shipment.label).trim() : '';

  const subject = number ? `Commande #${number} expédiée` : 'Commande expédiée';
  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';

  const legalBase = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const cgvUrl = legalBase ? `${legalBase}/legal/cgv` : '';

  const recapRows = items
    .slice(0, 6)
    .map((it) => {
      if (!it) return '';
      const name = it.name ? escapeHtml(it.name) : 'Article';
      const qty = Number.isFinite(it.quantity) ? it.quantity : 1;
      const imageUrl = it.imageUrl ? getTrimmedString(it.imageUrl) : '';
      const imageCell = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${name}" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:cover;border-radius:12px;" />`
        : `<div style="width:44px;height:44px;border-radius:12px;background:#f1f5f9;"></div>`;

      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:52px;">${imageCell}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;">
          <div style="font-weight:900;color:#0f172a;">${name}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Quantité : <strong style="color:#0f172a;">${escapeHtml(qty)}</strong></div>
        </td>
      </tr>`;
    })
    .join('');

  const moreCount = items.length > 6 ? items.length - 6 : 0;

  const hasInvoice = meta && meta.hasInvoice === true;
  const hasCgv = meta && meta.hasCgv === true;
  const attachmentsInfo = hasInvoice || hasCgv
    ? `<div style="margin-top:14px;padding:12px 14px;border:1px solid #dcfce7;background:#f0fdf4;border-radius:14px;color:#14532d;font-size:13px;line-height:1.6;">
        <div style="font-weight:900;">Pièces jointes</div>
        <div style="margin-top:6px;">${[
          hasInvoice ? 'Facture PDF' : '',
          hasCgv ? 'CGV (PDF)' : '',
        ].filter(Boolean).map((s) => `• ${escapeHtml(s)}`).join('<br/>')}</div>
      </div>`
    : '';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${firstName ? `${escapeHtml(firstName)}, ` : ''}votre commande est expédiée</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  ${number ? `Commande <strong>#${escapeHtml(number)}</strong>. ` : ''}Vous pouvez suivre l’acheminement avec le numéro ci-dessous.
</div>

<div style="margin-top:14px;padding:12px 14px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  ${label ? `<div style="font-weight:800;margin-bottom:6px;">${escapeHtml(label)}</div>` : ''}
  ${carrier ? `<div>Transporteur : <strong>${escapeHtml(carrier)}</strong></div>` : ''}
  ${trackingNumber ? `<div>Numéro de suivi : <strong>${escapeHtml(trackingNumber)}</strong></div>` : ''}
</div>

${attachmentsInfo}

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Récapitulatif commande</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  ${recapRows}
</table>
${moreCount ? `<div style="margin-top:10px;font-size:12px;color:#64748b;">+ ${escapeHtml(moreCount)} autre(s) article(s) dans la commande.</div>` : ''}

<div style="margin-top:12px;padding:12px 14px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  <div style="display:flex;justify-content:space-between;gap:10px;">
    <div style="font-weight:900;">Total TTC</div>
    <div style="font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totals.totalCents))}</div>
  </div>
</div>

${renderPrimaryButton({ href: orderUrl, label: 'Voir ma commande' })}

${cgvUrl ? `<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">CGV : <a href="${escapeHtml(cgvUrl)}" style="color:#ec1313;text-decoration:none;font-weight:800;">${escapeHtml(cgvUrl)}</a></div>` : ''}

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Si le suivi met quelques heures à apparaître, c’est normal.
</div>`;

  const text = `Commande expédiée${number ? ` (#${number})` : ''}. ${carrier ? `Transporteur: ${carrier}. ` : ''}${trackingNumber ? `Suivi: ${trackingNumber}. ` : ''}`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Votre colis est en route',
      bodyHtml,
      baseUrl,
    }),
    text,
  };
}

function buildConsigneReminderSoonEmail({ order, user, baseUrl } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';

  const lines = order && order.consigne && Array.isArray(order.consigne.lines) ? order.consigne.lines : [];
  const pending = lines.filter((l) => l && !l.receivedAt && l.dueAt);
  if (!pending.length) return null;

  const soonRows = pending
    .map((l) => {
      const name = l.name ? escapeHtml(l.name) : 'Pièce';
      const qty = Number.isFinite(l.quantity) ? l.quantity : 1;
      const dueAt = l.dueAt ? formatDateFR(l.dueAt) : '—';
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <div style="font-weight:900;color:#0f172a;">${name}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Quantité : ${escapeHtml(qty)} • Date limite : <strong>${escapeHtml(dueAt)}</strong></div>
        </td>
      </tr>`;
    })
    .join('');

  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';
  const subject = number
    ? `Rappel consigne : retour à prévoir (commande #${number})`
    : 'Rappel consigne : retour à prévoir';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${firstName ? `${escapeHtml(firstName)}, ` : ''}rappel consigne</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Il vous reste peu de temps pour nous retourner votre ancienne pièce.
</div>

<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">
  ${soonRows}
</table>

${renderPrimaryButton({ href: orderUrl, label: 'Voir le détail de ma consigne' })}

<div style="margin-top:12px;font-size:12px;line-height:1.6;color:#64748b;">
  La consigne n’est pas encaissée à l’achat, mais elle devient due si la pièce n’est pas retournée à temps.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Rappel consigne',
      bodyHtml,
      baseUrl,
    }),
    text: 'Rappel consigne : pensez à retourner votre ancienne pièce avant la date limite.',
  };
}

function buildConsigneOverdueEmail({ order, user, baseUrl } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';

  const lines = order && order.consigne && Array.isArray(order.consigne.lines) ? order.consigne.lines : [];
  const pending = lines.filter((l) => l && !l.receivedAt && l.dueAt);
  if (!pending.length) return null;

  const overdueRows = pending
    .map((l) => {
      const name = l.name ? escapeHtml(l.name) : 'Pièce';
      const qty = Number.isFinite(l.quantity) ? l.quantity : 1;
      const dueAt = l.dueAt ? formatDateFR(l.dueAt) : '—';
      const amountTotal = Number.isFinite(l.amountCents) && Number.isFinite(l.quantity)
        ? formatEuro(l.amountCents * l.quantity)
        : '—';
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <div style="font-weight:900;color:#0f172a;">${name}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Quantité : ${escapeHtml(qty)} • Date limite dépassée : <strong>${escapeHtml(dueAt)}</strong></div>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-weight:900;white-space:nowrap;">${escapeHtml(amountTotal)}</td>
      </tr>`;
    })
    .join('');

  const totalDueCents = pending.reduce((sum, l) => {
    const qty = Number.isFinite(l && l.quantity) ? l.quantity : 0;
    const amt = Number.isFinite(l && l.amountCents) ? l.amountCents : 0;
    return sum + qty * amt;
  }, 0);

  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';
  const subject = number
    ? `Consigne en retard : action requise (commande #${number})`
    : 'Consigne en retard : action requise';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${firstName ? `${escapeHtml(firstName)}, ` : ''}consigne en retard</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Nous n’avons pas encore reçu l’ancienne pièce. La date limite est dépassée.
</div>

<div style="margin-top:12px;padding:12px 14px;border:1px solid #fee2e2;background:#fff1f2;border-radius:14px;color:#881337;font-size:13px;line-height:1.6;">
  Montant total de consigne concerné : <strong>${escapeHtml(formatEuro(totalDueCents))}</strong>.
</div>

<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">
  ${overdueRows}
</table>

${renderPrimaryButton({ href: orderUrl, label: 'Voir le détail de ma commande' })}

<div style="margin-top:12px;font-size:12px;line-height:1.6;color:#64748b;">
  Si vous avez déjà renvoyé la pièce, ce message peut se croiser avec l’acheminement.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Consigne en retard',
      bodyHtml,
      baseUrl,
    }),
    text: `Consigne en retard${number ? ` (commande #${number})` : ''}.`,
  };
}

function buildWelcomeEmail({ user, baseUrl } = {}) {
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';
  const homeUrl = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  const accountUrl = homeUrl ? `${homeUrl}/compte` : '';

  const subject = 'Bienvenue sur CarPartsFrance';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Votre compte est prêt. Vous pouvez maintenant commander plus rapidement et suivre vos commandes.
</div>

${renderPrimaryButton({ href: accountUrl, label: 'Accéder à mon compte' })}

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Si vous n’êtes pas à l’origine de cette inscription, vous pouvez ignorer cet email.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Votre compte est prêt',
      bodyHtml,
      baseUrl,
    }),
    text: 'Bienvenue sur CarPartsFrance. Votre compte est prêt.',
  };
}

function buildGuestAccountCreatedEmail({ user, resetUrl, baseUrl } = {}) {
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';

  const subject = 'Votre compte a été créé';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Nous avons créé votre compte automatiquement à la suite de votre commande invité.
  Cliquez sur le bouton ci-dessous pour définir votre mot de passe et retrouver vos commandes.
</div>

${renderPrimaryButton({ href: resetUrl, label: 'Définir mon mot de passe' })}

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet email.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Définissez votre mot de passe',
      bodyHtml,
      baseUrl,
    }),
    text: `Votre compte a été créé. Définissez votre mot de passe ici : ${resetUrl}`,
  };
}

function buildResetPasswordEmail({ user, resetUrl, baseUrl } = {}) {
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';

  const subject = 'Réinitialisation de votre mot de passe';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Vous avez demandé à réinitialiser votre mot de passe.
  Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
</div>

${renderPrimaryButton({ href: resetUrl, label: 'Créer un nouveau mot de passe' })}

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Si vous n’avez rien demandé, ignorez cet email.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Lien de réinitialisation',
      bodyHtml,
      baseUrl,
    }),
    text: `Réinitialisez votre mot de passe : ${resetUrl}`,
  };
}

function buildNewBlogPostEmail({ post, baseUrl } = {}) {
  const title = getTrimmedString(post && post.title) || 'Nouvel article';
  const excerpt = getTrimmedString(post && post.excerpt) || '';
  const slug = getTrimmedString(post && post.slug);
  const coverImageUrl = getTrimmedString(post && post.coverImageUrl);
  const safeBaseUrl = getTrimmedString(baseUrl);
  const articleUrl = slug ? `${safeBaseUrl}/blog/${slug}` : `${safeBaseUrl}/blog`;
  const unsubscribeUrl = `${safeBaseUrl}/newsletter/desinscription`;

  const coverHtml = coverImageUrl
    ? `<div style="margin-bottom:16px;border-radius:12px;overflow:hidden;">
        <a href="${escapeHtml(articleUrl)}"><img src="${escapeHtml(coverImageUrl.startsWith('http') ? coverImageUrl : safeBaseUrl + coverImageUrl)}" alt="${escapeHtml(title)}" style="width:100%;max-width:552px;height:auto;display:block;border-radius:12px;" /></a>
      </div>`
    : '';

  const bodyHtml = `
    ${coverHtml}
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.3;">${escapeHtml(title)}</h1>
    ${excerpt ? `<p style="margin:0 0 16px;font-size:14px;color:#64748b;line-height:1.6;">${escapeHtml(excerpt.length > 200 ? excerpt.slice(0, 200) + '...' : excerpt)}</p>` : ''}
    ${renderPrimaryButton({ href: articleUrl, label: 'Lire l\'article' })}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8;line-height:1.5;">
      Vous recevez cet email car vous êtes inscrit à la newsletter CarParts France.<br />
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Se désinscrire</a>
    </div>
  `;

  return {
    subject: `Nouvel article : ${title}`,
    html: renderEmailLayout({ title: `Nouvel article : ${title}`, preheader: excerpt.slice(0, 100), bodyHtml, baseUrl: safeBaseUrl }),
    text: `Nouvel article sur CarParts France : ${title}\n\n${excerpt}\n\nLire l'article : ${articleUrl}\n\nSe désinscrire : ${unsubscribeUrl}`,
  };
}

function renderCartItemRows(items, baseUrl) {
  if (!Array.isArray(items) || !items.length) return '';
  const safeBaseUrl = getTrimmedString(baseUrl);

  return items
    .map((it) => {
      if (!it) return '';
      const name = it.name ? escapeHtml(it.name) : 'Article';
      const qty = Number.isFinite(it.quantity) ? it.quantity : 1;
      const price = Number.isFinite(it.price) ? formatEuro(it.price) : '';
      const lineTotal = Number.isFinite(it.price) && Number.isFinite(it.quantity)
        ? formatEuro(it.price * it.quantity)
        : '';
      const rawImage = getTrimmedString(it.image);
      const imageUrl = rawImage && safeBaseUrl && !rawImage.startsWith('http')
        ? `${safeBaseUrl}${rawImage.startsWith('/') ? '' : '/'}${rawImage}`
        : rawImage;

      const imageCell = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${name}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:12px;" />`
        : `<div style="width:56px;height:56px;border-radius:12px;background:#f1f5f9;"></div>`;

      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:64px;">
          ${imageCell}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;">
          <div style="font-weight:900;color:#0f172a;">${name}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Quantit\u00e9 : <strong style="color:#0f172a;">${escapeHtml(qty)}</strong></div>
          ${price ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">Prix : <strong style="color:#0f172a;">${escapeHtml(price)}</strong></div>` : ''}
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid #f1f5f9;font-weight:900;white-space:nowrap;vertical-align:top;">${lineTotal ? escapeHtml(lineTotal) : ''}</td>
      </tr>`;
    })
    .join('');
}

function buildAbandonedCartReminder1({ cart, baseUrl } = {}) {
  const firstName = cart && cart.firstName ? String(cart.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';
  const items = cart && Array.isArray(cart.items) ? cart.items : [];
  const totalAmountCents = cart && Number.isFinite(cart.totalAmountCents) ? cart.totalAmountCents : 0;
  const token = cart && cart.recoveryToken ? String(cart.recoveryToken) : '';
  const safeBaseUrl = getTrimmedString(baseUrl);
  const recoveryUrl = token && safeBaseUrl ? `${safeBaseUrl}/panier/recuperer/${encodeURIComponent(token)}` : '';
  const unsubscribeUrl = safeBaseUrl ? `${safeBaseUrl}/newsletter/desinscription` : '';

  const itemsHtml = renderCartItemRows(items, baseUrl);

  const subject = `${firstName ? `${firstName}, ` : ''}vous avez oubli\u00e9 quelque chose ?`;

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Vous avez ajout\u00e9 des pi\u00e8ces \u00e0 votre panier mais vous n'avez pas finalis\u00e9 votre commande.
  Pas de souci, votre panier est toujours l\u00e0.
</div>

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Votre panier</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  ${itemsHtml}
</table>

${totalAmountCents > 0 ? `
<div style="margin-top:12px;padding:12px 14px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  <div style="display:flex;justify-content:space-between;gap:10px;">
    <div style="font-weight:900;">Total</div>
    <div style="font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totalAmountCents))}</div>
  </div>
</div>` : ''}

${renderPrimaryButton({ href: recoveryUrl, label: 'Reprendre ma commande' })}

<div style="margin-top:16px;font-size:12px;line-height:1.6;color:#64748b;">
  Une question sur un produit ? R\u00e9pondez directement \u00e0 cet email, notre \u00e9quipe vous r\u00e9pond rapidement.
</div>

<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8;line-height:1.5;">
  Vous recevez cet email car vous avez un panier en attente sur CarParts France.<br />
  ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Se d\u00e9sinscrire</a>` : ''}
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Votre panier vous attend sur CarParts France',
      bodyHtml,
      baseUrl,
    }),
    text: `${firstName ? `${firstName}, ` : ''}vous avez oubli\u00e9 quelque chose dans votre panier. Total : ${formatEuro(totalAmountCents)}. Reprenez votre commande : ${recoveryUrl}`,
  };
}

function buildAbandonedCartReminder2({ cart, baseUrl } = {}) {
  const firstName = cart && cart.firstName ? String(cart.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';
  const items = cart && Array.isArray(cart.items) ? cart.items : [];
  const totalAmountCents = cart && Number.isFinite(cart.totalAmountCents) ? cart.totalAmountCents : 0;
  const token = cart && cart.recoveryToken ? String(cart.recoveryToken) : '';
  const safeBaseUrl = getTrimmedString(baseUrl);
  const recoveryUrl = token && safeBaseUrl ? `${safeBaseUrl}/panier/recuperer/${encodeURIComponent(token)}` : '';
  const unsubscribeUrl = safeBaseUrl ? `${safeBaseUrl}/newsletter/desinscription` : '';

  const itemsHtml = renderCartItemRows(items, baseUrl);

  const subject = `${firstName ? `${firstName}, ` : ''}votre panier vous attend toujours`;

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Votre panier est toujours disponible avec les pi\u00e8ces que vous avez s\u00e9lectionn\u00e9es.
</div>

<div style="margin-top:12px;padding:12px 14px;border:1px solid #fef3c7;background:#fffbeb;border-radius:14px;color:#92400e;font-size:13px;line-height:1.6;">
  Nos pi\u00e8ces reconditionn\u00e9es sont disponibles en quantit\u00e9 limit\u00e9e. Chaque r\u00e9f\u00e9rence est unique et peut partir \u00e0 tout moment.
</div>

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Votre panier</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  ${itemsHtml}
</table>

${totalAmountCents > 0 ? `
<div style="margin-top:12px;padding:12px 14px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  <div style="display:flex;justify-content:space-between;gap:10px;">
    <div style="font-weight:900;">Total</div>
    <div style="font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totalAmountCents))}</div>
  </div>
</div>` : ''}

${renderPrimaryButton({ href: recoveryUrl, label: 'Finaliser ma commande' })}

<div style="margin-top:16px;font-size:12px;line-height:1.6;color:#64748b;">
  Besoin d'aide pour votre commande ? Notre \u00e9quipe est disponible par email ou au 04 65 84 54 88.
</div>

<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8;line-height:1.5;">
  Vous recevez cet email car vous avez un panier en attente sur CarParts France.<br />
  ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Se d\u00e9sinscrire</a>` : ''}
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Vos pi\u00e8ces sont encore disponibles, mais pour combien de temps ?',
      bodyHtml,
      baseUrl,
    }),
    text: `${firstName ? `${firstName}, ` : ''}votre panier vous attend toujours. Nos pi\u00e8ces reconditionn\u00e9es sont en quantit\u00e9 limit\u00e9e. Total : ${formatEuro(totalAmountCents)}. Finalisez votre commande : ${recoveryUrl}`,
  };
}

function buildAbandonedCartReminder3({ cart, baseUrl, promoCode } = {}) {
  const firstName = cart && cart.firstName ? String(cart.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';
  const items = cart && Array.isArray(cart.items) ? cart.items : [];
  const totalAmountCents = cart && Number.isFinite(cart.totalAmountCents) ? cart.totalAmountCents : 0;
  const token = cart && cart.recoveryToken ? String(cart.recoveryToken) : '';
  const safeBaseUrl = getTrimmedString(baseUrl);
  const recoveryUrl = token && safeBaseUrl ? `${safeBaseUrl}/panier/recuperer/${encodeURIComponent(token)}` : '';
  const unsubscribeUrl = safeBaseUrl ? `${safeBaseUrl}/newsletter/desinscription` : '';
  const safePromoCode = getTrimmedString(promoCode);

  const itemsHtml = renderCartItemRows(items, baseUrl);

  const subject = `${firstName ? `${firstName}, ` : ''}derni\u00e8re chance pour votre panier`;

  const promoHtml = safePromoCode
    ? `<div style="margin-top:12px;padding:12px 14px;border:1px solid #dcfce7;background:#f0fdf4;border-radius:14px;color:#14532d;font-size:13px;line-height:1.6;">
        <div style="font-weight:900;">Offre sp\u00e9ciale pour vous</div>
        <div style="margin-top:6px;">Utilisez le code <strong style="font-size:15px;letter-spacing:1px;">${escapeHtml(safePromoCode)}</strong> pour b\u00e9n\u00e9ficier de <strong>5% de r\u00e9duction</strong> sur votre commande.</div>
      </div>`
    : '';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  C'est notre dernier rappel. Votre panier sera bient\u00f4t vid\u00e9 et nous ne pouvons pas garantir la disponibilit\u00e9 de vos pi\u00e8ces.
</div>

<div style="margin-top:12px;padding:12px 14px;border:1px solid #fee2e2;background:#fff1f2;border-radius:14px;color:#881337;font-size:13px;line-height:1.6;">
  Les pi\u00e8ces reconditionn\u00e9es de votre panier sont des r\u00e9f\u00e9rences uniques. Une fois parties, elles ne seront plus disponibles.
</div>

${promoHtml}

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Votre panier</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  ${itemsHtml}
</table>

${totalAmountCents > 0 ? `
<div style="margin-top:12px;padding:12px 14px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  <div style="display:flex;justify-content:space-between;gap:10px;">
    <div style="font-weight:900;">Total</div>
    <div style="font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totalAmountCents))}</div>
  </div>
</div>` : ''}

${renderPrimaryButton({ href: recoveryUrl, label: safePromoCode ? 'Profiter de l\'offre' : 'Finaliser ma commande' })}

<div style="margin-top:16px;font-size:12px;line-height:1.6;color:#64748b;">
  Besoin d'aide ? Appelez-nous au 04 65 84 54 88 ou r\u00e9pondez \u00e0 cet email.
</div>

<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8;line-height:1.5;">
  Vous recevez cet email car vous avez un panier en attente sur CarParts France.<br />
  ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Se d\u00e9sinscrire</a>` : ''}
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: safePromoCode ? `Code promo ${safePromoCode} : 5% de r\u00e9duction sur votre panier` : 'Derni\u00e8re chance de finaliser votre commande',
      bodyHtml,
      baseUrl,
    }),
    text: `${firstName ? `${firstName}, ` : ''}derni\u00e8re chance pour votre panier. ${safePromoCode ? `Code promo ${safePromoCode} : 5% de r\u00e9duction. ` : ''}Total : ${formatEuro(totalAmountCents)}. Finalisez votre commande : ${recoveryUrl}`,
  };
}

function buildDeliveryConfirmedEmail({ order, user, baseUrl } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';
  const items = order && Array.isArray(order.items) ? order.items : [];

  const totals = computeOrderTotals(order);

  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';
  const contactUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/contact` : '';

  const recapRows = items
    .slice(0, 6)
    .map((it) => {
      if (!it) return '';
      const name = it.name ? escapeHtml(it.name) : 'Article';
      const qty = Number.isFinite(it.quantity) ? it.quantity : 1;
      const imageUrl = it.imageUrl ? getTrimmedString(it.imageUrl) : '';
      const imageCell = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${name}" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:cover;border-radius:12px;" />`
        : `<div style="width:44px;height:44px;border-radius:12px;background:#f1f5f9;"></div>`;

      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:52px;">${imageCell}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;">
          <div style="font-weight:900;color:#0f172a;">${name}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">Quantit\u00e9 : <strong style="color:#0f172a;">${escapeHtml(qty)}</strong></div>
        </td>
      </tr>`;
    })
    .join('');

  const moreCount = items.length > 6 ? items.length - 6 : 0;

  const subject = number ? `Commande #${number} livr\u00e9e` : 'Votre commande a \u00e9t\u00e9 livr\u00e9e';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting}, bonne nouvelle !</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Votre commande${number ? ` <strong>#${escapeHtml(number)}</strong>` : ''} a \u00e9t\u00e9 livr\u00e9e avec succ\u00e8s.
</div>

<div style="margin-top:12px;padding:12px 14px;border:1px solid #dcfce7;background:#f0fdf4;border-radius:14px;color:#14532d;font-size:13px;line-height:1.6;">
  <div style="font-weight:900;">Livraison confirm\u00e9e</div>
  <div style="margin-top:4px;">Votre colis a bien \u00e9t\u00e9 r\u00e9ceptionn\u00e9. Si tout est en ordre, nous vous invitons \u00e0 nous laisser un avis.</div>
</div>

<div style="margin-top:18px;font-size:12px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Articles livr\u00e9s</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
  ${recapRows}
</table>
${moreCount ? `<div style="margin-top:10px;font-size:12px;color:#64748b;">+ ${escapeHtml(moreCount)} autre(s) article(s).</div>` : ''}

<div style="margin-top:12px;padding:12px 14px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  <div style="display:flex;justify-content:space-between;gap:10px;">
    <div style="font-weight:900;">Total TTC</div>
    <div style="font-weight:900;white-space:nowrap;">${escapeHtml(formatEuro(totals.totalCents))}</div>
  </div>
</div>

${renderPrimaryButton({ href: orderUrl, label: 'Voir ma commande' })}

<div style="margin-top:18px;padding:12px 14px;border:1px solid #e5e7eb;background:#ffffff;border-radius:14px;color:#0f172a;font-size:13px;line-height:1.6;">
  <div style="font-weight:900;">Un probl\u00e8me avec votre commande ?</div>
  <div style="margin-top:4px;color:#64748b;">
    Si un article ne correspond pas ou si vous constatez un d\u00e9faut, contactez-nous rapidement.
    Notre \u00e9quipe se chargera de trouver une solution.
  </div>
  ${contactUrl ? `<div style="margin-top:6px;"><a href="${escapeHtml(contactUrl)}" style="color:#ec1313;text-decoration:none;font-weight:800;">Contacter le support</a></div>` : ''}
</div>

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Merci pour votre confiance. \u00c0 bient\u00f4t sur CarParts France !
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Votre colis a bien \u00e9t\u00e9 livr\u00e9',
      bodyHtml,
      baseUrl,
    }),
    text: `Commande${number ? ` #${number}` : ''} livr\u00e9e. Total TTC : ${formatEuro(totals.totalCents)}.`,
  };
}

function getOrderStatusLabelFR(status) {
  const labels = {
    en_attente: 'En attente de validation',
    validee: 'Valid\u00e9e',
    en_preparation: 'En pr\u00e9paration',
    expediee: 'Exp\u00e9di\u00e9e',
    livree: 'Livr\u00e9e',
    annulee: 'Annul\u00e9e',
  };
  return labels[status] || String(status || '').replace(/_/g, ' ');
}

function getStatusIcon(status) {
  const icons = {
    en_attente: { icon: 'hourglass_top', color: '#d97706', bg: '#fffbeb', border: '#fef3c7' },
    validee: { icon: 'check_circle', color: '#059669', bg: '#f0fdf4', border: '#dcfce7' },
    en_preparation: { icon: 'inventory_2', color: '#2563eb', bg: '#eff6ff', border: '#dbeafe' },
    expediee: { icon: 'local_shipping', color: '#7c3aed', bg: '#f5f3ff', border: '#ede9fe' },
    livree: { icon: 'done_all', color: '#059669', bg: '#f0fdf4', border: '#dcfce7' },
    annulee: { icon: 'cancel', color: '#dc2626', bg: '#fff1f2', border: '#fee2e2' },
  };
  return icons[status] || { icon: 'info', color: '#64748b', bg: '#f8fafc', border: '#e5e7eb' };
}

function buildOrderStatusChangeEmail({ order, user, newStatus, message, baseUrl } = {}) {
  const number = order && order.number ? String(order.number) : '';
  const orderId = order && order._id ? String(order._id) : '';
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';

  const statusLabel = getOrderStatusLabelFR(newStatus);
  const si = getStatusIcon(newStatus);

  const orderUrl = baseUrl && orderId ? `${baseUrl.replace(/\/$/, '')}/compte/commandes/${encodeURIComponent(orderId)}` : '';
  const safeMessage = message ? getTrimmedString(message) : '';

  const subject = number
    ? `Commande #${number} : ${statusLabel}`
    : `Mise \u00e0 jour de votre commande : ${statusLabel}`;

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Le statut de votre commande${number ? ` <strong>#${escapeHtml(number)}</strong>` : ''} a \u00e9t\u00e9 mis \u00e0 jour.
</div>

<div style="margin-top:14px;padding:16px;border:1px solid ${si.border};background:${si.bg};border-radius:14px;color:${si.color};font-size:14px;line-height:1.6;">
  <div style="font-weight:900;font-size:16px;">${escapeHtml(statusLabel)}</div>
</div>

${safeMessage ? `
<div style="margin-top:14px;padding:12px 14px;border:1px solid #e5e7eb;background:#ffffff;border-radius:14px;color:#334155;font-size:13px;line-height:1.6;">
  <div style="font-weight:900;color:#0f172a;margin-bottom:6px;">Message</div>
  ${escapeHtml(safeMessage)}
</div>` : ''}

${renderPrimaryButton({ href: orderUrl, label: 'Voir ma commande' })}

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Si vous avez une question, r\u00e9pondez directement \u00e0 cet email.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: `Commande${number ? ` #${number}` : ''} : ${statusLabel}`,
      bodyHtml,
      baseUrl,
    }),
    text: `Commande${number ? ` #${number}` : ''} : statut mis \u00e0 jour \u2192 ${statusLabel}.${safeMessage ? ` Message : ${safeMessage}` : ''}`,
  };
}

module.exports = {
  buildOrderConfirmationEmail,
  buildConsigneStartEmail,
  buildConsigneReceivedEmail,
  buildShipmentTrackingEmail,
  buildConsigneReminderSoonEmail,
  buildConsigneOverdueEmail,
  buildWelcomeEmail,
  buildGuestAccountCreatedEmail,
  buildResetPasswordEmail,
  buildNewBlogPostEmail,
  buildAbandonedCartReminder1,
  buildAbandonedCartReminder2,
  buildAbandonedCartReminder3,
  buildDeliveryConfirmedEmail,
  buildOrderStatusChangeEmail,
};
