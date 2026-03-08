const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

function normalizeEnvString(value) {
  if (typeof value !== 'string') return '';
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function slugify(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function compactSpaces(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function stripMarkdownInline(value) {
  return String(value || '')
    .replace(/!?\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '')
    .replace(/\(\s*(?:https?:\/\/|www\.)[^)]*\)/gi, '')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.[^\s)]+/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\((?:\s*[,;:]\s*)+\)/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripMarkdownMultiline(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .map((line) => line.replace(/^#{1,6}\s+/g, ''))
    .map((line) => line.replace(/^>\s+/g, ''))
    .map((line) => line.replace(/^\d+[).]\s+/g, '- '))
    .filter((line) => !/^(source|sources|lien|liens|reference source|references sources)\s*[:\-]/i.test(line))
    .map((line) => stripMarkdownInline(line))
    .join('\n');
}

function normalizeText(value, { maxLength = 0 } = {}) {
  const text = compactSpaces(stripMarkdownInline(value));
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trim() + '…';
}

function normalizeMultilineText(value, { maxLength = 0 } = {}) {
  const text = stripMarkdownMultiline(value)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trim() + '…';
}

function normalizeArrayOfStrings(value, { maxItems = 20, maxLength = 180 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item, { maxLength }))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeCompatibility(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const src = item && typeof item === 'object' ? item : {};
      return {
        make: normalizeText(src.make, { maxLength: 80 }),
        model: normalizeText(src.model, { maxLength: 120 }),
        years: normalizeText(src.years, { maxLength: 40 }),
        engine: normalizeText(src.engine, { maxLength: 120 }),
      };
    })
    .filter((item) => item.make || item.model || item.years || item.engine)
    .slice(0, 20);
}

function normalizeFaqs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const src = item && typeof item === 'object' ? item : {};
      return {
        question: normalizeText(src.question, { maxLength: 220 }),
        answer: normalizeText(src.answer, { maxLength: 400 }),
      };
    })
    .filter((item) => item.question || item.answer)
    .slice(0, 12);
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const src = item && typeof item === 'object' ? item : {};
      return {
        title: normalizeText(src.title, { maxLength: 80 }),
        description: normalizeText(src.description, { maxLength: 240 }),
      };
    })
    .filter((item) => item.title || item.description)
    .slice(0, 4);
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option, index) => {
      const src = option && typeof option === 'object' ? option : {};
      const label = normalizeText(src.label, { maxLength: 120 });
      const key = slugify(String(src.key || '').trim()) || slugify(label) || `option-${index + 1}`;
      const type = String(src.type || '').trim() === 'text' ? 'text' : 'choice';
      const normalized = {
        key,
        label: label || `Option ${index + 1}`,
        type,
        required: src.required === true,
        placeholder: normalizeText(src.placeholder, { maxLength: 160 }),
        helpText: normalizeText(src.helpText, { maxLength: 220 }),
        priceDeltaCents: Number.isFinite(Number(src.priceDeltaCents)) ? Math.max(0, Math.round(Number(src.priceDeltaCents))) : 0,
        choices: [],
      };

      if (type === 'choice') {
        normalized.choices = Array.isArray(src.choices)
          ? src.choices
              .map((choice, choiceIndex) => {
                const choiceSrc = choice && typeof choice === 'object' ? choice : {};
                const choiceLabel = normalizeText(choiceSrc.label, { maxLength: 120 });
                return {
                  key: slugify(String(choiceSrc.key || '').trim()) || slugify(choiceLabel) || `choix-${choiceIndex + 1}`,
                  label: choiceLabel,
                  priceDeltaCents: Number.isFinite(Number(choiceSrc.priceDeltaCents))
                    ? Math.max(0, Math.round(Number(choiceSrc.priceDeltaCents)))
                    : 0,
                };
              })
              .filter((choice) => choice.label)
              .slice(0, 12)
          : [];
        normalized.priceDeltaCents = 0;
      } else {
        normalized.choices = [];
      }

      if (type === 'choice' && !normalized.choices.length) return null;
      return normalized;
    })
    .filter(Boolean)
    .slice(0, 8);
}

const PRODUCT_SHEET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    slug: { type: 'string' },
    brand: { type: 'string' },
    category: { type: 'string' },
    shippingDelayText: { type: 'string' },
    specType: { type: 'string' },
    specProgrammation: { type: 'string' },
    badgeTopLeft: { type: 'string' },
    badgeCondition: { type: 'string' },
    shortDescription: { type: 'string' },
    description: { type: 'string' },
    compatibleReferences: {
      type: 'array',
      items: { type: 'string' },
    },
    compatibility: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          make: { type: 'string' },
          model: { type: 'string' },
          years: { type: 'string' },
          engine: { type: 'string' },
        },
        required: ['make', 'model', 'years', 'engine'],
      },
    },
    faqs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['question', 'answer'],
      },
    },
    reconditioningSteps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
      },
    },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string', enum: ['choice', 'text'] },
          required: { type: 'boolean' },
          placeholder: { type: 'string' },
          helpText: { type: 'string' },
          priceDeltaCents: { type: 'integer' },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                priceDeltaCents: { type: 'integer' },
              },
              required: ['key', 'label', 'priceDeltaCents'],
            },
          },
        },
        required: ['key', 'label', 'type', 'required', 'placeholder', 'helpText', 'priceDeltaCents', 'choices'],
      },
    },
    metaTitle: { type: 'string' },
    metaDescription: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'name',
    'slug',
    'brand',
    'category',
    'shippingDelayText',
    'specType',
    'specProgrammation',
    'badgeTopLeft',
    'badgeCondition',
    'shortDescription',
    'description',
    'compatibleReferences',
    'compatibility',
    'faqs',
    'reconditioningSteps',
    'options',
    'metaTitle',
    'metaDescription',
    'warnings',
  ],
};

function getModelName() {
  return normalizeEnvString(process.env.OPENAI_PRODUCT_MODEL)
    || normalizeEnvString(process.env.OPENAI_MODEL)
    || 'gpt-4.1';
}

function getReasoningEffort() {
  const value = normalizeEnvString(process.env.OPENAI_PRODUCT_REASONING_EFFORT).toLowerCase();
  if (!value) return '';
  if (['none', 'low', 'medium', 'high', 'xhigh'].includes(value)) return value;
  return '';
}

function getOpenAiApiKey() {
  return normalizeEnvString(process.env.OPENAI_API_KEY);
}

function extractJsonCandidateStrings(node, out = []) {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => extractJsonCandidateStrings(item, out));
    return out;
  }

  if (!node || typeof node !== 'object') return out;

  Object.keys(node).forEach((key) => {
    const value = node[key];
    if (typeof value === 'string') out.push(value);
    else extractJsonCandidateStrings(value, out);
  });

  return out;
}

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {}

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const snippet = raw.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(snippet);
    } catch (err) {}
  }

  return null;
}

function extractStructuredOutput(data) {
  if (data && data.output_parsed && typeof data.output_parsed === 'object') {
    return data.output_parsed;
  }

  const candidates = extractJsonCandidateStrings(data, []);
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseOpenAiError(data, response) {
  const errorCode = data && data.error && typeof data.error.code === 'string'
    ? data.error.code.trim().toLowerCase()
    : '';
  const errorType = data && data.error && typeof data.error.type === 'string'
    ? data.error.type.trim().toLowerCase()
    : '';
  const errorMessage = data && data.error && typeof data.error.message === 'string'
    ? data.error.message.trim()
    : '';

  const quotaExceeded = errorCode === 'insufficient_quota'
    || errorType === 'insufficient_quota'
    || /quota/i.test(errorMessage)
    || /billing/i.test(errorMessage);

  if (quotaExceeded) {
    return 'Le compte OpenAI a dépassé son quota ou la facturation API n’est pas active. Va dans Platform OpenAI > Billing pour ajouter du crédit ou activer la facturation, puis réessaie.';
  }

  if (errorMessage) {
    return errorMessage;
  }
  return `Erreur OpenAI (${response.status}).`;
}

function buildSystemInstruction() {
  return [
    'Tu es un expert e-commerce automobile B2C/B2B pour CarParts France.',
    'Tu dois impérativement utiliser la recherche web disponible avant de rédiger la fiche.',
    'Tu travailles en français.',
    'Objectif : produire une fiche produit claire, crédible, utile pour le client et optimisée SEO.',
    'Règles strictes :',
    '- Ne jamais inventer une donnée technique précise si elle n’est pas suffisamment confirmée.',
    '- Si une information est incertaine, laisse le champ vide ou ajoute un avertissement dans warnings.',
    '- Ne propose pas de prix, de stock, de SKU, de classe d’expédition ou de données internes non vérifiables.',
    '- Les meta title et meta description doivent être naturellement optimisés SEO, sans sur-optimisation.',
    '- La description doit être rédigée en texte simple, sans HTML complexe.',
    '- N’utilise jamais de syntaxe Markdown visible dans les champs texte : pas de **, pas de __, pas de #, pas de liens [texte](url).',
    '- N’insère jamais de source, d’URL, de lien, de citation, de nom de site ou de référence bibliographique dans les champs texte.',
    '- Les compatibilités véhicules doivent rester prudentes : seulement si des sources sérieuses permettent de les déduire.',
    '- Les FAQ doivent répondre à de vraies questions client.',
    '- Les options doivent rester sobres, réalistes et utiles pour un vendeur de pièces auto.',
  ].join('\n');
}

function buildUserPrompt(payload) {
  const sourceNotes = normalizeMultilineText(payload && payload.sourceNotes ? payload.sourceNotes : '', { maxLength: 4000 });
  const compatibleReferences = normalizeArrayOfStrings(payload && payload.compatibleReferences ? payload.compatibleReferences : [], { maxItems: 20, maxLength: 120 });

  return [
    'Prépare une fiche produit complète en te basant sur une recherche web.',
    '',
    'Contexte fourni par l’utilisateur :',
    `- Nom du produit : ${normalizeText(payload && payload.name ? payload.name : '', { maxLength: 220 })}`,
    `- Référence / SKU principal : ${normalizeText(payload && payload.sku ? payload.sku : '', { maxLength: 120 })}`,
    `- Marque connue : ${normalizeText(payload && payload.brand ? payload.brand : '', { maxLength: 120 })}`,
    `- Catégorie connue : ${normalizeText(payload && payload.category ? payload.category : '', { maxLength: 120 })}`,
    `- Références compatibles déjà connues : ${compatibleReferences.length ? compatibleReferences.join(', ') : 'Aucune'}`,
    `- Notes libres : ${sourceNotes || 'Aucune'}`,
    '',
    'Consignes de rédaction :',
    '- Produis un nom de produit vendable, propre et naturel.',
    '- Génère un slug SEO simple.',
    '- Génère un résumé court et une description détaillée orientée bénéfices + usages + vérifications utiles.',
    '- La description doit être directement lisible dans un textarea admin : texte clair, paragraphes simples, puces simples, sans Markdown.',
    '- N’ajoute aucune source, aucun lien, aucune URL et aucun nom de site dans la réponse finale.',
    '- Génère des champs Type, Programmation, Garantie et État cohérents.',
    '- Propose une meta title et une meta description solides pour Google.',
    '- Propose des FAQ utiles.',
    '- Propose jusqu’à 4 étapes de reconditionnement si cela a du sens.',
    '- Si tu n’es pas sûr d’une donnée, préfère un avertissement dans warnings.',
    '- Si aucune source fiable n’est trouvée, signale-le clairement dans warnings.',
  ].join('\n');
}

function normalizeGeneratedSheet(raw, payload) {
  const sourceName = normalizeText(raw && raw.name ? raw.name : '', { maxLength: 220 })
    || normalizeText(payload && payload.name ? payload.name : '', { maxLength: 220 });
  const sourceBrand = normalizeText(raw && raw.brand ? raw.brand : '', { maxLength: 120 })
    || normalizeText(payload && payload.brand ? payload.brand : '', { maxLength: 120 });
  const sourceCategory = normalizeText(raw && raw.category ? raw.category : '', { maxLength: 120 })
    || normalizeText(payload && payload.category ? payload.category : '', { maxLength: 120 });
  const slug = slugify(raw && raw.slug ? raw.slug : sourceName);

  const compatibleReferencesFromPayload = normalizeArrayOfStrings(payload && payload.compatibleReferences ? payload.compatibleReferences : [], { maxItems: 20, maxLength: 120 });
  const compatibleReferences = Array.from(new Set([
    ...compatibleReferencesFromPayload,
    ...normalizeArrayOfStrings(raw && raw.compatibleReferences ? raw.compatibleReferences : [], { maxItems: 20, maxLength: 120 }),
  ]));

  return {
    name: sourceName,
    slug,
    brand: sourceBrand,
    category: sourceCategory,
    shippingDelayText: normalizeText(raw && raw.shippingDelayText ? raw.shippingDelayText : '', { maxLength: 120 }),
    specType: normalizeText(raw && raw.specType ? raw.specType : '', { maxLength: 120 }),
    specProgrammation: normalizeText(raw && raw.specProgrammation ? raw.specProgrammation : '', { maxLength: 120 }),
    badgeTopLeft: normalizeText(raw && raw.badgeTopLeft ? raw.badgeTopLeft : '', { maxLength: 120 }),
    badgeCondition: normalizeText(raw && raw.badgeCondition ? raw.badgeCondition : '', { maxLength: 120 }),
    shortDescription: normalizeText(raw && raw.shortDescription ? raw.shortDescription : '', { maxLength: 320 }),
    description: normalizeMultilineText(raw && raw.description ? raw.description : '', { maxLength: 7000 }),
    compatibleReferences,
    compatibility: normalizeCompatibility(raw && raw.compatibility ? raw.compatibility : []),
    faqs: normalizeFaqs(raw && raw.faqs ? raw.faqs : []),
    reconditioningSteps: normalizeSteps(raw && raw.reconditioningSteps ? raw.reconditioningSteps : []),
    options: normalizeOptions(raw && raw.options ? raw.options : []),
    metaTitle: normalizeText(raw && raw.metaTitle ? raw.metaTitle : '', { maxLength: 70 }),
    metaDescription: normalizeText(raw && raw.metaDescription ? raw.metaDescription : '', { maxLength: 180 }),
    warnings: normalizeArrayOfStrings(raw && raw.warnings ? raw.warnings : [], { maxItems: 12, maxLength: 280 }),
  };
}

async function generateProductSheet(payload) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY manquante.');
    err.code = 'OPENAI_API_KEY_MISSING';
    throw err;
  }

  const safePayload = {
    name: normalizeText(payload && payload.name ? payload.name : '', { maxLength: 220 }),
    sku: normalizeText(payload && payload.sku ? payload.sku : '', { maxLength: 120 }),
    brand: normalizeText(payload && payload.brand ? payload.brand : '', { maxLength: 120 }),
    category: normalizeText(payload && payload.category ? payload.category : '', { maxLength: 120 }),
    compatibleReferences: normalizeArrayOfStrings(payload && payload.compatibleReferences ? payload.compatibleReferences : [], { maxItems: 20, maxLength: 120 }),
    sourceNotes: normalizeMultilineText(payload && payload.sourceNotes ? payload.sourceNotes : '', { maxLength: 4000 }),
  };

  const body = {
    model: getModelName(),
    tools: [
      {
        type: 'web_search_preview',
      },
    ],
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: buildSystemInstruction(),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: buildUserPrompt(safePayload),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'product_sheet',
        strict: true,
        schema: PRODUCT_SHEET_SCHEMA,
      },
    },
  };

  const reasoningEffort = getReasoningEffort();
  if (reasoningEffort) {
    body.reasoning = {
      effort: reasoningEffort,
    };
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(parseOpenAiError(data, response));
    err.code = 'OPENAI_API_ERROR';
    err.status = response.status;
    err.details = data;
    throw err;
  }

  const parsed = extractStructuredOutput(data);
  if (!parsed) {
    const err = new Error('Réponse OpenAI impossible à lire.');
    err.code = 'OPENAI_INVALID_RESPONSE';
    err.details = data;
    throw err;
  }

  return {
    model: body.model,
    draft: normalizeGeneratedSheet(parsed, safePayload),
    raw: data,
  };
}

module.exports = {
  generateProductSheet,
  getModelName,
};
