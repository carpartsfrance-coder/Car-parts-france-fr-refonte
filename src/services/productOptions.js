const crypto = require('crypto');

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function slugifyKey(value) {
  const input = getTrimmedString(value);
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function normalizeInt(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

function normalizeProductOptions(options) {
  const list = Array.isArray(options) ? options : [];

  const out = [];

  for (let i = 0; i < list.length; i += 1) {
    const g = list[i] && typeof list[i] === 'object' ? list[i] : null;
    if (!g) continue;

    const label = getTrimmedString(g.label);
    const keyRaw = getTrimmedString(g.key) || slugifyKey(label) || `option_${i + 1}`;
    const key = slugifyKey(keyRaw) || `option_${i + 1}`;

    const type = getTrimmedString(g.type) === 'text' ? 'text' : 'choice';
    const required = g.required === true;

    const placeholder = getTrimmedString(g.placeholder);
    const helpText = getTrimmedString(g.helpText);

    const priceDeltaCents = normalizeInt(g.priceDeltaCents, 0);

    const group = {
      key,
      label: label || key,
      type,
      required,
      placeholder,
      helpText,
      priceDeltaCents,
      choices: [],
    };

    if (type === 'choice') {
      const choices = Array.isArray(g.choices) ? g.choices : [];
      const seen = new Set();

      for (let j = 0; j < choices.length; j += 1) {
        const c = choices[j] && typeof choices[j] === 'object' ? choices[j] : null;
        if (!c) continue;

        const choiceLabel = getTrimmedString(c.label);
        const choiceKeyRaw = getTrimmedString(c.key) || slugifyKey(choiceLabel) || `choix_${j + 1}`;
        const choiceKey = slugifyKey(choiceKeyRaw) || `choix_${j + 1}`;
        if (seen.has(choiceKey)) continue;
        seen.add(choiceKey);

        group.choices.push({
          key: choiceKey,
          label: choiceLabel || choiceKey,
          priceDeltaCents: normalizeInt(c.priceDeltaCents, 0),
        });
      }

      if (group.required && group.choices.length === 0) {
        group.required = false;
      }
    }

    out.push(group);
  }

  return out;
}

function parseProductOptionsJson(jsonValue) {
  const raw = getTrimmedString(jsonValue);
  if (!raw) return { ok: true, options: [] };

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: 'Options: JSON invalide.' };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Options: le JSON doit être une liste.' };
  }

  return { ok: true, options: normalizeProductOptions(parsed) };
}

function buildSelectionFromBody(body, productOptions) {
  const source = body && typeof body === 'object' ? body : {};
  const opts = normalizeProductOptions(productOptions);

  const selection = {};
  const errors = [];

  for (const g of opts) {
    const key = g && g.key ? String(g.key) : '';
    if (!key) continue;

    const fieldName = `opt_${key}`;

    if (g.type === 'choice') {
      const rawValue = getTrimmedString(source[fieldName]);
      const exists = g.choices.some((c) => c && String(c.key) === rawValue);
      const value = exists ? rawValue : '';

      if (!value && g.required) {
        errors.push(`Merci de choisir : ${g.label}`);
      }

      if (value) selection[key] = value;
      continue;
    }

    if (g.type === 'text') {
      const rawValue = getTrimmedString(source[fieldName]);
      if (!rawValue && g.required) {
        errors.push(`Merci de renseigner : ${g.label}`);
      }

      if (rawValue) selection[key] = rawValue;
      continue;
    }
  }

  return {
    ok: errors.length === 0,
    selection,
    errors,
    options: opts,
  };
}

function buildVariantKey(selection) {
  const sel = selection && typeof selection === 'object' ? selection : {};
  const keys = Object.keys(sel).sort();
  if (!keys.length) return '';

  return keys
    .map((k) => {
      const v = sel[k];
      return `${k}=${typeof v === 'string' ? v : String(v)}`;
    })
    .join('&');
}

function buildCartLineId(productId, selection) {
  const pid = getTrimmedString(productId);
  const variantKey = buildVariantKey(selection);
  const base = `${pid}|${variantKey}`;

  const hash = crypto.createHash('sha1').update(base).digest('hex').slice(0, 12);
  return {
    lineId: `${pid}__${hash}`,
    variantKey,
  };
}

function computeUnitPriceCents(product, selection) {
  const opts = normalizeProductOptions(product && product.options ? product.options : []);
  const sel = selection && typeof selection === 'object' ? selection : {};

  const base = Number.isFinite(product && product.priceCents) ? product.priceCents : 0;
  let total = base;

  for (const g of opts) {
    const value = Object.prototype.hasOwnProperty.call(sel, g.key) ? sel[g.key] : '';

    if (g.type === 'choice') {
      const choice = g.choices.find((c) => c && String(c.key) === String(value));
      if (choice) total += normalizeInt(choice.priceDeltaCents, 0);
      continue;
    }

    if (g.type === 'text') {
      const hasValue = typeof value === 'string' ? value.trim() : String(value || '').trim();
      if (hasValue) total += normalizeInt(g.priceDeltaCents, 0);
    }
  }

  return Math.max(0, Math.trunc(total));
}

function buildOptionsDisplay(productOptions, selection) {
  const opts = normalizeProductOptions(productOptions);
  const sel = selection && typeof selection === 'object' ? selection : {};

  const lines = [];

  for (const g of opts) {
    if (!g || !g.key) continue;

    const rawValue = Object.prototype.hasOwnProperty.call(sel, g.key) ? sel[g.key] : '';

    if (g.type === 'choice') {
      const choice = g.choices.find((c) => c && String(c.key) === String(rawValue));
      if (!choice) continue;
      lines.push({
        key: g.key,
        label: g.label,
        value: choice.label,
        priceDeltaCents: normalizeInt(choice.priceDeltaCents, 0),
      });
      continue;
    }

    if (g.type === 'text') {
      const value = getTrimmedString(rawValue);
      if (!value) continue;
      lines.push({
        key: g.key,
        label: g.label,
        value,
        priceDeltaCents: normalizeInt(g.priceDeltaCents, 0),
      });
    }
  }

  const optionsSummary = lines.length
    ? lines.map((x) => `${x.label} : ${x.value}`).join(' • ')
    : '';

  return { lines, optionsSummary };
}

module.exports = {
  normalizeProductOptions,
  parseProductOptionsJson,
  buildSelectionFromBody,
  buildVariantKey,
  buildCartLineId,
  computeUnitPriceCents,
  buildOptionsDisplay,
};
