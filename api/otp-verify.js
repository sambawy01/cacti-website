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
 * Verify the code the user entered via Twilio Verify API.
 */
async function checkTwilioVerification(phone, code) {
  const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ To: phone, Code: code }).toString();

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'verify.twilio.com',
      path: `/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (response.statusCode === 200 && json.status === 'approved') {
            resolve({ success: true, status: 'approved' });
          } else {
            resolve({ success: false, status: json.status || 'pending', error: json.message || 'Verification failed' });
          }
        } catch {
          resolve({ success: false, status: 'error', error: data });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, status: 'error', error: e.message }));
    req.write(body);
    req.end();
  });
}

/**
 * Store verified phone in Supabase (30-minute TTL enforced by cleanup function).
 */
async function markPhoneVerified(phone) {
  if (!supabase) return false;
  const { error } = await supabase
    .from('verified_phones')
    .upsert({ phone, verified_at: new Date().toISOString() });
  if (error) console.error('[OTP] Failed to store verified phone:', error.message);
  return !error;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, code } = req.body || {};

    if (!phone || !code) {
      return res.status(400).json({ ok: false, error: 'Phone and code are required' });
    }

    const phoneClean = phone.replace(/[\s\-\(\)]/g, '');

    // ── Dev mode: accept any 4-6 digit code ──────────────────────────────
    if (!isTwilioConfigured()) {
      if (/^\d{4,6}$/.test(code)) {
        await markPhoneVerified(phoneClean);
        return res.status(200).json({
          ok: true,
          verified: true,
          phone: phoneClean,
          dev_mode: true,
        });
      } else {
        return res.status(400).json({ ok: false, error: 'Invalid code format' });
      }
    }

    // ── Live mode: verify via Twilio ─────────────────────────────────────
    const result = await checkTwilioVerification(phoneClean, code);

    if (result.success) {
      await markPhoneVerified(phoneClean);
      return res.status(200).json({
        ok: true,
        verified: true,
        phone: phoneClean,
      });
    } else {
      return res.status(400).json({
        ok: false,
        error: result.error || 'Verification failed',
        status: result.status,
      });
    }
  } catch (err) {
    console.error('[OTP] verify-code error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}