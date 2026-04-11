/*
 * SAV — Inbound Email Processing
 * Handles incoming emails forwarded by MailerSend inbound routing.
 * Reply-to addresses follow the pattern: sav+{ticketNumero}@{domain}
 *
 * Webhook: POST /api/sav/public/inbound-email
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SavTicket = require('../models/SavTicket');

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'sav-emails.log');

function ensureLogDir() {
  try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}
ensureLogDir();

function log(line) {
  try {
    fs.appendFile(LOG_FILE, `${new Date().toISOString()} [sav-inbound] ${line}\n`, () => {});
  } catch (_) {}
}

// ============================================================
// Address helpers
// ============================================================

/**
 * Build the reply-to address for a given ticket numero.
 * E.g. sav+SAV-2026-0042@carpartsfrance.fr
 */
function buildReplyToAddress(ticketNumero) {
  const domain = (process.env.SAV_INBOUND_DOMAIN || 'carpartsfrance.fr').trim();
  return `sav+${ticketNumero}@${domain}`;
}

/**
 * Extract the ticket numero from a reply-to address.
 * Accepts formats like: sav+SAV-2026-0042@carpartsfrance.fr
 * Returns null if no match.
 */
function extractTicketNumero(toAddress) {
  if (!toAddress || typeof toAddress !== 'string') return null;
  const addr = toAddress.trim().toLowerCase();
  // Match sav+XXXX@ pattern
  const match = addr.match(/^sav\+([^@]+)@/i);
  if (match && match[1]) return match[1].toUpperCase();
  return null;
}

// ============================================================
// Email quote stripping
// ============================================================

/**
 * Remove quoted reply text from an email body.
 * Handles common patterns from Gmail, Outlook, Apple Mail, Thunderbird, etc.
 */
function stripEmailQuotes(text) {
  if (!text || typeof text !== 'string') return '';

  const lines = text.split('\n');
  const cleanLines = [];
  let hitSeparator = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at common separator patterns
    if (
      /^-{3,}$/.test(trimmed) ||                                        // ---
      /^_{10,}$/.test(trimmed) ||                                        // ________________________________
      /^On .+ wrote:$/i.test(trimmed) ||                                 // On Mon, 1 Jan 2026, X wrote:
      /^Le .+ a écrit\s*:$/i.test(trimmed) ||                            // Le 1 janv. 2026, X a écrit :
      /^From:/i.test(trimmed) ||                                         // From: header
      /^Envoyé\s*:/i.test(trimmed) ||                                    // Envoyé : (Outlook FR)
      /^De\s*:/i.test(trimmed) ||                                        // De : (Outlook FR)
      /^Sent:/i.test(trimmed) ||                                         // Sent: (Outlook EN)
      /^>+\s*On .+ wrote:/i.test(trimmed) ||                             // > On ... wrote:
      /^-{2,}\s*Original Message\s*-{2,}/i.test(trimmed) ||              // -- Original Message --
      /^-{2,}\s*Message d'origine\s*-{2,}/i.test(trimmed)                // -- Message d'origine --
    ) {
      hitSeparator = true;
      break;
    }

    // Skip lines starting with > (quoted text)
    if (/^>/.test(trimmed)) continue;

    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}

// ============================================================
// Webhook signature verification
// ============================================================

function verifyWebhookSignature(req) {
  const secret = (process.env.MAILERSEND_INBOUND_SECRET || '').trim();
  if (!secret) {
    // No secret configured — skip verification (dev/test mode)
    return true;
  }

  const signature = req.headers['x-mailersend-signature']
    || req.headers['signature']
    || '';
  if (!signature) {
    log('WARN signature header missing');
    return false;
  }

  try {
    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch (err) {
    log(`ERROR signature verification failed: ${err.message}`);
    return false;
  }
}

// ============================================================
// Attachment saving
// ============================================================

function saveAttachments(ticket, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return [];

  const uploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'sav', ticket.numero);
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (_) {}

  const saved = [];

  for (const att of attachments) {
    try {
      if (!att) continue;
      const content = att.content || att.data || att.base64;
      const filename = att.filename || att.name || `attachment_${Date.now()}`;
      if (!content) continue;

      const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const fullPath = path.join(uploadDir, safeName);

      // Content may be base64-encoded or raw
      const buffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(content, 'base64');
      fs.writeFileSync(fullPath, buffer);

      const url = `/uploads/sav/${ticket.numero}/${safeName}`;
      const entry = {
        kind: 'email_attachment',
        url,
        originalName: filename,
        size: buffer.length,
        mime: att.type || att.content_type || att.mimetype || 'application/octet-stream',
        uploadedAt: new Date(),
      };

      if (!ticket.documentsList) ticket.documentsList = [];
      ticket.documentsList.push(entry);
      saved.push(entry);
    } catch (err) {
      log(`ERROR saving attachment for ${ticket.numero}: ${err.message}`);
    }
  }

  return saved;
}

// ============================================================
// Main webhook handler
// ============================================================

async function processInboundEmail(req) {
  const body = req.body || {};

  // 1. Verify webhook signature (if configured)
  if (!verifyWebhookSignature(req)) {
    log('REJECTED invalid webhook signature');
    return { ok: false, reason: 'invalid_signature' };
  }

  // 2. Extract data from the webhook payload
  // MailerSend inbound webhook format varies; handle common shapes
  const data = body.data || body;

  // Sender info
  const senderEmail = extractSenderEmail(data);
  if (!senderEmail) {
    log('WARN no sender email found in payload');
    return { ok: false, reason: 'no_sender' };
  }

  // Recipients (to/cc)
  const recipients = extractRecipients(data);
  const subject = data.subject || data.headers?.subject || '';

  // 3. Find ticket number from recipients or subject
  let ticketNumero = null;

  for (const addr of recipients) {
    ticketNumero = extractTicketNumero(addr);
    if (ticketNumero) break;
  }

  // Fallback: extract from subject line (e.g. "Re: [SAV-2026-0042] ...")
  if (!ticketNumero && subject) {
    const subjectMatch = subject.match(/(SAV-\d{4}-\d{4,})/i);
    if (subjectMatch) ticketNumero = subjectMatch[1].toUpperCase();
  }

  if (!ticketNumero) {
    log(`WARN no ticket numero found. recipients=${recipients.join(',')} subject=${subject}`);
    return { ok: false, reason: 'no_ticket_numero' };
  }

  // 4. Find ticket in MongoDB
  const ticket = await SavTicket.findOne({ numero: ticketNumero });
  if (!ticket) {
    log(`WARN ticket not found: ${ticketNumero}`);
    return { ok: false, reason: 'ticket_not_found', numero: ticketNumero };
  }

  // 5. Verify sender matches client email
  const clientEmail = (ticket.client && ticket.client.email || '').toLowerCase().trim();
  const senderLower = senderEmail.toLowerCase().trim();
  const senderMismatch = clientEmail && senderLower !== clientEmail;
  if (senderMismatch) {
    log(`WARN sender mismatch for ${ticketNumero}: expected=${clientEmail} got=${senderLower} (accepting anyway)`);
  }

  // 6. Extract and clean body
  const rawText = data.text || data.text_body || data.body || '';
  const rawHtml = data.html || data.html_body || '';
  let cleanBody = stripEmailQuotes(rawText);

  // If text body is empty but HTML exists, do a rough strip
  if (!cleanBody && rawHtml) {
    cleanBody = stripEmailQuotes(
      rawHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    );
  }

  // 7. Dedup: check if we already have a message with the same content within the last 5 minutes
  if (cleanBody) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const isDuplicate = (ticket.messages || []).some((m) =>
      m.canal === 'email' &&
      m.auteur === 'client' &&
      m.date > fiveMinAgo &&
      m.contenu === cleanBody
    );
    if (isDuplicate) {
      log(`DEDUP skipping duplicate message for ${ticketNumero}`);
      return { ok: true, reason: 'duplicate', numero: ticketNumero };
    }
  }

  // 8. Handle empty body
  if (!cleanBody) {
    // Check if there are attachments — if so, note it
    const attachments = extractAttachments(data);
    if (!attachments.length) {
      log(`WARN empty body and no attachments for ${ticketNumero}`);
      cleanBody = '(Message vide reçu par email)';
    } else {
      cleanBody = '(Pièces jointes reçues par email)';
    }
  }

  // 9. Handle closed tickets: reopen to pre_qualification
  const CLOSED_STATUTS = ['clos', 'clos_sans_reponse', 'refuse', 'resolu_garantie', 'resolu_facture'];
  if (CLOSED_STATUTS.includes(ticket.statut)) {
    const previousStatut = ticket.statut;
    ticket.statut = 'pre_qualification';
    ticket.addMessage('systeme', 'interne', `Ticket rouvert automatiquement (était ${previousStatut}) suite à un email client.`);
    log(`REOPEN ${ticketNumero} from ${previousStatut} to pre_qualification`);
  }

  // 10. Save attachments BEFORE adding message (so we can reference them)
  const attachments = extractAttachments(data);
  const savedAttachments = saveAttachments(ticket, attachments);

  // 11. Build message content with attachments inline
  let messageContent = cleanBody;
  if (savedAttachments.length) {
    const pjLines = savedAttachments.map((a) =>
      `📎 ${a.originalName} (${formatSize(a.size)}) — ${a.url}`
    );
    if (messageContent) {
      messageContent += '\n\n--- Pièces jointes ---\n' + pjLines.join('\n');
    } else {
      messageContent = pjLines.join('\n');
    }
  }

  // 12. Add main message to ticket
  const auteurLabel = senderMismatch ? `client (${senderLower})` : 'client';
  ticket.addMessage(auteurLabel, 'email', messageContent);

  // 13. Add system events for each attachment (for timeline / "Tout" view)
  for (const att of savedAttachments) {
    ticket.addMessage('client', 'interne',
      `Document uploadé (email_attachment) : ${att.originalName} (${att.size} octets)`
    );
  }

  // 14. Update lastClientMessageAt
  ticket.lastClientMessageAt = new Date();

  // 15. Save ticket
  await ticket.save();

  log(`OK ${ticketNumero} from=${senderLower} body=${cleanBody.length}chars attachments=${savedAttachments.length}${senderMismatch ? ' SENDER_MISMATCH' : ''}`);

  return {
    ok: true,
    numero: ticketNumero,
    messageLength: cleanBody.length,
    attachments: savedAttachments.length,
    senderMismatch,
  };
}

// ============================================================
// Size formatting
// ============================================================

function formatSize(bytes) {
  if (!bytes || bytes < 1024) return (bytes || 0) + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

// ============================================================
// Payload extraction helpers (accommodate various MailerSend formats)
// ============================================================

function extractSenderEmail(data) {
  // MailerSend may provide sender in different fields
  if (data.from && typeof data.from === 'string') return data.from;
  if (data.from && data.from.email) return data.from.email;
  if (data.sender && typeof data.sender === 'string') return data.sender;
  if (data.sender && data.sender.email) return data.sender.email;
  if (data.from_email) return data.from_email;
  // Check envelope
  if (data.envelope && data.envelope.from) return data.envelope.from;
  // Check headers
  if (data.headers) {
    if (data.headers.from) {
      const match = data.headers.from.match(/<([^>]+)>/);
      return match ? match[1] : data.headers.from;
    }
  }
  return null;
}

function extractRecipients(data) {
  const addrs = [];

  // to field
  if (Array.isArray(data.to)) {
    for (const r of data.to) {
      if (typeof r === 'string') addrs.push(r);
      else if (r && r.email) addrs.push(r.email);
      else if (r && r.address) addrs.push(r.address);
    }
  } else if (data.to && typeof data.to === 'string') {
    addrs.push(data.to);
  } else if (data.to && data.to.email) {
    addrs.push(data.to.email);
  }

  // cc field
  if (Array.isArray(data.cc)) {
    for (const r of data.cc) {
      if (typeof r === 'string') addrs.push(r);
      else if (r && r.email) addrs.push(r.email);
      else if (r && r.address) addrs.push(r.address);
    }
  }

  // recipients field (alternative format)
  if (Array.isArray(data.recipients)) {
    for (const r of data.recipients) {
      if (typeof r === 'string') addrs.push(r);
      else if (r && r.email) addrs.push(r.email);
      else if (r && r.address) addrs.push(r.address);
    }
  }

  // envelope.to
  if (data.envelope && Array.isArray(data.envelope.to)) {
    for (const addr of data.envelope.to) addrs.push(addr);
  }

  return addrs;
}

function extractAttachments(data) {
  if (Array.isArray(data.attachments)) return data.attachments;
  if (Array.isArray(data.files)) return data.files;
  return [];
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  buildReplyToAddress,
  extractTicketNumero,
  stripEmailQuotes,
  processInboundEmail,
};
