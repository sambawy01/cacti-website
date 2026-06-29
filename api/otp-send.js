import https from 'https';
import { createClient } from '@supabase/supabase-js';

// ── Supabase client (server-side) ─────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

// ── Twilio config ─────────────────────────────────────────────────────────
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';

function isTwilioConfigured() {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID);
}

/**
 * Send a verification code via Twilio Verify API.
 * Twilio generates and sends the code — we never see it.
 */
async function sendTwilioVerification(phone, channel = 'sms') {
  const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ To: phone, Channel: channel }).toString();

  return new Promise((resolve) => {
    const postData = body;
    const req = https.request({
      hostname: 'verify.twilio.com',
      path: `/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (response.statusCode === 201) {
            resolve({ success: true, sid: json.sid });
          } else {
            resolve({ success: false, error: json.message || data });
          }
        } catch {
          resolve({ success: false, error: data });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.write(postData);
    req.end();
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, channel } = req.body || {};

    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Phone number is required' });
    }

    // Validate E.164 format
    const phoneClean = phone.replace(/[\s\-\(\)]/g, '');
    if (!/^\+\d{8,15}$/.test(phoneClean)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid phone format. Use international format: +201XXXXXXXXX',
      });
    }

    // ── Dev mode: Twilio not configured ──────────────────────────────────
    if (!isTwilioConfigured()) {
      console.log('[OTP] Dev mode — Twilio not configured, skipping SMS. Any 4-6 digit code will work.');
      return res.status(200).json({
        ok: true,
        dev_mode: true,
        message: 'Dev mode: OTP skipped. Enter any 4-6 digit code to continue.',
      });
    }

    // ── Live mode: send via Twilio ───────────────────────────────────────
    const result = await sendTwilioVerification(phoneClean, channel || 'sms');

    if (result.success) {
      return res.status(200).json({ ok: true, sid: result.sid });
    } else {
      console.error('[OTP] Twilio send failed:', result.error);
      return res.status(400).json({ ok: false, error: result.error || 'Failed to send verification code' });
    }
  } catch (err) {
    console.error('[OTP] send-code error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}