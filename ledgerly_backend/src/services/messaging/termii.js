'use strict';

/**
 * Termii messaging provider (Nigerian SMS / WhatsApp API).
 *
 * Env vars:
 *   - TERMII_API_KEY   (required)
 *   - TERMII_SENDER_ID (sender ID for SMS channel)
 *
 * Uses built-in global fetch (Node 18+). No external HTTP deps.
 */

const TERMII_BASE_URL = 'https://api.ng.termii.com';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Normalize a phone number to international format WITHOUT a leading "+" or "00".
 * Examples:
 *   "0803 123 4567"  -> "2348031234567"  (Nigerian local, length 11 after trim)
 *   "+2348031234567" -> "2348031234567"
 *   "002348031234567"-> "2348031234567"
 *   "2348031234567"  -> "2348031234567"
 * @param {string} input
 * @returns {string}
 */
function normalizePhone(input) {
  if (input == null) return '';
  let phone = String(input).trim();

  // Strip surrounding whitespace inside the number (e.g. "0803 123 4567").
  phone = phone.replace(/\s+/g, '');

  // Strip a single leading "+".
  if (phone.startsWith('+')) {
    phone = phone.slice(1);
  }

  // Strip a leading "00" international prefix.
  if (phone.startsWith('00')) {
    phone = phone.slice(2);
  } else if (phone.startsWith('0') && phone.length === 11) {
    // Nigerian local format: 11 digits starting with "0" -> replace with "234".
    phone = '234' + phone.slice(1);
  }

  return phone;
}

/**
 * Send an SMS or WhatsApp message via Termii.
 *
 * @param { to, channel, message }
 * @returns {Promise<{success: boolean, providerMessageId?: string, error?: string}>}
 */
async function sendMessage({ to, channel, message } = {}) {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey || String(apiKey).trim() === '') {
    throw new Error('TERMII_API_KEY is not configured');
  }

  const senderId = process.env.TERMII_SENDER_ID || '';
  const normalizedTo = normalizePhone(to);

  const body = {
    api_key: apiKey,
    to: normalizedTo,
    sms: message,
    type: 'plain',
  };

  if (channel === 'whatsapp') {
    // Termii routes WhatsApp via the same /api/sms/send endpoint with channel: "whatsapp".
    body.channel = 'whatsapp';
  } else {
    // Default to SMS / generic.
    body.from = senderId;
    body.channel = 'generic';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${TERMII_BASE_URL}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_jsonErr) {
      // Non-JSON or empty body — treat as failure.
      data = {};
    }

    if (!response.ok) {
      return {
        success: false,
        error: data.message || 'Termii request failed',
      };
    }

    if (data.code === 'ok' || data.message_id) {
      return {
        success: true,
        providerMessageId: data.message_id,
      };
    }

    return {
      success: false,
      error: data.message || 'Termii request failed',
    };
  } catch (err) {
    // Network error, abort (timeout), DNS, etc.
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    return {
      success: false,
      error: aborted ? 'Termii request timed out' : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  sendMessage,
  normalizePhone,
};
