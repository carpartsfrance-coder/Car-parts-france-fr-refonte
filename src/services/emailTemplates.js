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
  Si tu as une question, réponds directement à cet email.
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
  Ta commande${number ? ` <strong>#${escapeHtml(number)}</strong>` : ''} est indiquée comme <strong>livrée</strong>.
  À partir de maintenant, tu as un délai pour nous retourner ton ancienne pièce.
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
  Si tu as déjà renvoyé la pièce, tu peux ignorer ce message.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Consigne : pense à retourner ton ancienne pièce',
      bodyHtml,
      baseUrl,
    }),
    text: `Consigne : pense à retourner ton ancienne pièce. Total consigne (si non retournée à temps) : ${formatEuro(totalDueCents)}.`,
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
  Nous confirmons avoir reçu ton ancienne pièce (consigne) pour la commande${number ? ` <strong>#${escapeHtml(number)}</strong>` : ''}.
</div>

<div style="margin-top:12px;padding:12px 14px;border:1px solid #dcfce7;background:#f0fdf4;border-radius:14px;color:#14532d;font-size:13px;line-height:1.6;">
  Ta consigne est maintenant considérée comme <strong>régularisée</strong>.
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
    text: `Nous confirmons avoir reçu ta consigne pour la commande${number ? ` #${number}` : ''}.`,
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
<div style="font-size:16px;font-weight:900;">${firstName ? `${escapeHtml(firstName)}, ` : ''}ta commande est expédiée</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  ${number ? `Commande <strong>#${escapeHtml(number)}</strong>. ` : ''}Tu peux suivre l’acheminement avec le numéro ci-dessous.
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
      preheader: 'Ton colis est en route',
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
  Il te reste peu de temps pour nous retourner ton ancienne pièce.
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
    text: 'Rappel consigne : pense à retourner ton ancienne pièce avant la date limite.',
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
  Si tu as déjà renvoyé la pièce, ce message peut se croiser avec l’acheminement.
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
  Ton compte est prêt. Tu peux maintenant commander plus rapidement et suivre tes commandes.
</div>

${renderPrimaryButton({ href: accountUrl, label: 'Accéder à mon compte' })}

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Si tu n’es pas à l’origine de cette inscription, tu peux ignorer cet email.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Ton compte est prêt',
      bodyHtml,
      baseUrl,
    }),
    text: 'Bienvenue sur CarPartsFrance. Ton compte est prêt.',
  };
}

function buildResetPasswordEmail({ user, resetUrl, baseUrl } = {}) {
  const firstName = user && user.firstName ? String(user.firstName).trim() : '';
  const greeting = firstName ? escapeHtml(firstName) : 'Bonjour';

  const subject = 'Réinitialisation de ton mot de passe';

  const bodyHtml = `
<div style="font-size:16px;font-weight:900;">${greeting},</div>
<div style="margin-top:10px;font-size:14px;line-height:1.6;color:#334155;">
  Tu as demandé à réinitialiser ton mot de passe.
  Clique sur le bouton ci-dessous pour en choisir un nouveau.
</div>

${renderPrimaryButton({ href: resetUrl, label: 'Créer un nouveau mot de passe' })}

<div style="margin-top:14px;font-size:12px;line-height:1.6;color:#64748b;">
  Si tu n’as rien demandé, ignore cet email.
</div>`;

  return {
    subject,
    html: renderEmailLayout({
      title: subject,
      preheader: 'Lien de réinitialisation',
      bodyHtml,
      baseUrl,
    }),
    text: `Réinitialise ton mot de passe : ${resetUrl}`,
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
  buildResetPasswordEmail,
};
