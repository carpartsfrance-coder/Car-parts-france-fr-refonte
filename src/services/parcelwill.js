const https = require('https');

const PARCELWILL_BASE_URL = 'https://wp-api.parcelwill.net';

const cache = {
  couriers: { fetchedAt: 0, list: null },
};

const defaultTimeoutMs = 8000;
const couriersCacheTtlMs = 24 * 60 * 60 * 1000;

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTrackingNumber(value) {
  return getTrimmedString(value).replace(/\s+/g, '');
}

function buildHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'PP-Api-Key': apiKey,
    'x-parcelpanel-api-key': apiKey,
  };
}

function fetchJson(path, { method = 'GET', apiKey, body, timeoutMs = defaultTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('PARCELWILL_API_KEY manquant'));
      return;
    }

    const payload = body ? JSON.stringify(body) : null;

    const headers = buildHeaders(apiKey);
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        protocol: 'https:',
        hostname: 'wp-api.parcelwill.net',
        port: 443,
        path,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          raw += chunk;
        });

        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch (err) {
            reject(new Error(`Réponse ParcelWILL invalide (${res.statusCode})`));
            return;
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            const msg = json && json.msg ? json.msg : `HTTP ${res.statusCode}`;
            reject(new Error(msg));
            return;
          }

          resolve(json);
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Timeout ParcelWILL'));
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function formatParcelwillDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function listCouriers(apiKey) {
  const now = Date.now();
  if (cache.couriers.list && now - cache.couriers.fetchedAt < couriersCacheTtlMs) {
    return cache.couriers.list;
  }

  const json = await fetchJson('/api/v1/tracking/couriers', { apiKey });
  const list = json && Array.isArray(json.data) ? json.data : [];
  cache.couriers = { fetchedAt: now, list };
  return list;
}

function guessCourierCodeFallback(carrierLabel) {
  const raw = getTrimmedString(carrierLabel).toLowerCase();
  if (!raw) return '';

  if (raw.includes('colissimo')) return 'colissimo';
  if (raw.includes('chronopost')) return 'chronopost';
  if (raw.includes('mondial') || raw.includes('relay')) return 'mondialrelay';
  if (raw.includes('la poste') || raw.includes('laposte')) return 'laposte';
  if (raw.includes('dpd')) return 'dpd';
  if (raw.includes('gls')) return 'gls';
  if (raw.includes('ups')) return 'ups';
  if (raw.includes('dhl')) return 'dhl';
  if (raw.includes('fedex') || raw.includes('fed ex')) return 'fedex';
  if (raw.includes('tnt')) return 'tnt';

  return '';
}

async function guessCourierCode(apiKey, carrierLabel) {
  const raw = getTrimmedString(carrierLabel);
  if (!raw) return '';

  try {
    const list = await listCouriers(apiKey);
    const wanted = raw.toLowerCase();
    const found = list.find((c) => {
      const name = c && c.courier_name ? String(c.courier_name).toLowerCase() : '';
      const code = c && c.courier_code ? String(c.courier_code).toLowerCase() : '';
      if (!name && !code) return false;
      return (name && (name.includes(wanted) || wanted.includes(name)))
        || (code && (code.includes(wanted) || wanted.includes(code)));
    });
    if (found && found.courier_code) return String(found.courier_code);
  } catch (err) {
    // ignore
  }

  return guessCourierCodeFallback(raw);
}

async function createTrackings(apiKey, shipments) {
  const list = Array.isArray(shipments) ? shipments.filter(Boolean) : [];
  if (!list.length) return { ok: false, error: 'Aucun tracking' };

  const json = await fetchJson('/api/v1/tracking/create', {
    method: 'POST',
    apiKey,
    body: { shipments: list },
  });

  const ok = json && Number(json.code) === 200;
  if (!ok) {
    const msg = json && json.msg ? String(json.msg) : 'Erreur ParcelWILL';
    throw new Error(msg);
  }

  return { ok: true, data: json.data || null };
}

async function getTrackingDetails(apiKey, orderId) {
  const id = orderId == null ? '' : String(orderId).trim();
  if (!id) return null;

  const json = await fetchJson('/api/v1/tracking/list', {
    method: 'POST',
    apiKey,
    body: { orders: [{ order_id: id }] },
  });

  const ok = json && Number(json.code) === 200;
  if (!ok) {
    const msg = json && json.msg ? String(json.msg) : 'Erreur ParcelWILL';
    throw new Error(msg);
  }

  return Array.isArray(json.data) ? json.data[0] : null;
}

function normalizeEventsFromTrackInfo(trackInfo) {
  const list = Array.isArray(trackInfo) ? trackInfo : [];
  return list
    .filter(Boolean)
    .map((ev) => {
      const date = ev && ev.date ? String(ev.date) : '';
      const details = ev && ev.details ? String(ev.details) : '';
      const desc = ev && ev.status_description ? String(ev.status_description) : '';
      const checkpoint = ev && ev.checkpoint_status ? String(ev.checkpoint_status) : '';

      const title = desc || checkpoint || 'Mise à jour';

      return {
        event: title,
        date,
        location: details,
        additional: '',
      };
    });
}

function mapShipmentStatusToStatusCode(status) {
  const raw = typeof status === 'string' ? status.toLowerCase() : '';
  if (!raw) return null;

  if (raw === 'delivered' || raw === 'completed') return 0;
  if (raw.includes('out') && raw.includes('delivery')) return 4;
  if (raw.includes('exception') || raw.includes('failed') || raw.includes('error')) return 6;
  if (raw === 'pre_transit' || raw === 'info_received') return 8;

  if (raw === 'transit' || raw === 'in_transit' || raw === 'pickup') return 2;

  return 3;
}

function normalizeParcelwillToParcelDelivery(trackingDoc, preferredTrackingNumber) {
  if (!trackingDoc || !Array.isArray(trackingDoc.shipments)) return null;

  const normalizedPreferred = normalizeTrackingNumber(preferredTrackingNumber);

  const shipments = trackingDoc.shipments.filter(Boolean);
  const chosen = normalizedPreferred
    ? shipments.find((s) => normalizeTrackingNumber(s && s.tracking_number) === normalizedPreferred)
    : null;

  const shipment = chosen || shipments[0] || null;
  if (!shipment) return null;

  const statusCode = mapShipmentStatusToStatusCode(shipment.status);
  const events = normalizeEventsFromTrackInfo(shipment.track_info);

  return {
    status_code: Number.isFinite(statusCode) ? statusCode : null,
    events,
    timestamp_expected: null,
    timestamp_expected_end: null,
  };
}

module.exports = {
  PARCELWILL_BASE_URL,
  normalizeTrackingNumber,
  formatParcelwillDateTime,
  listCouriers,
  guessCourierCode,
  createTrackings,
  getTrackingDetails,
  normalizeParcelwillToParcelDelivery,
};
