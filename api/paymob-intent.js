import https from 'https';
import { createClient } from '@supabase/supabase-js';

// ── Supabase ──────────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

// ── Paymob config ─────────────────────────────────────────────────────────
const PAYMOB_API_KEY = process.env.PAYMOB_API_KEY || '';
const PAYMOB_BASE_URL = process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com';
const PAYMOB_IFRAME_ID = process.env.PAYMOB_IFRAME_ID || '';

function getIntegrationId(method) {
  switch (method) {
    case 'card': return process.env.PAYMOB_INTEGRATION_ID_CARD || '';
    case 'instapay': return process.env.PAYMOB_INTEGRATION_ID_INSTAPAY || '';
    case 'apple_pay': return process.env.PAYMOB_INTEGRATION_ID_APPLE_PAY || '';
    default: return '';
  }
}

function isPaymobConfigured() {
  return !!(PAYMOB_API_KEY && PAYMOB_IFRAME_ID);
}

/** Convert EGP to piasters (cents) */
function toCents(amount) {
  return Math.round(amount * 100);
}

/** Fill billing data with Paymob's required "NA" defaults */
function normaliseBilling(billing) {
  const NA = 'NA';
  return {
    first_name: billing?.first_name || NA,
    last_name: billing?.last_name || NA,
    email: billing?.email || 'guest@cacti.restaurant',
    phone_number: billing?.phone_number || NA,
    apartment: billing?.apartment || NA,
    floor: billing?.floor || NA,
    street: billing?.street || NA,
    building: billing?.building || NA,
    city: billing?.city || NA,
    state: billing?.state || NA,
    country: billing?.country || NA,
    postal_code: billing?.postal_code || NA,
  };
}

/** Generic POST to Paymob API via https */
function paymobPost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(PAYMOB_BASE_URL + path);
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from Paymob: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { orderId, orderDbId, amount, method, billing, phone } = req.body || {};

    // ── Validate ──────────────────────────────────────────────────────────
    if (!orderId || typeof amount !== 'number' || amount <= 0 || !method) {
      return res.status(400).json({
        ok: false,
        error: 'orderId, positive amount, and method are required',
      });
    }

    if (!['card', 'instapay', 'apple_pay'].includes(method)) {
      return res.status(400).json({ ok: false, error: 'Unsupported payment method: ' + method });
    }

    // ── Check phone is verified (if phone provided) ──────────────────────
    if (phone && supabase) {
      const phoneClean = phone.replace(/[\s\-\(\)]/g, '');
      const { data: verified } = await supabase
        .from('verified_phones')
        .select('phone, verified_at')
        .eq('phone', phoneClean)
        .gte('verified_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .maybeSingle();

      if (!verified) {
        return res.status(403).json({
          ok: false,
          error: 'Phone verification required to make a payment',
        });
      }
    }

    // ── Dev mode: Paymob not configured ──────────────────────────────────
    if (!isPaymobConfigured()) {
      console.log('[Paymob] Dev mode — Paymob not configured, returning mock iframe URL');
      return res.status(200).json({
        ok: true,
        dev_mode: true,
        iframe_url: '/payment-dev-mode',
        message: 'Dev mode: Paymob not configured. Payment is simulated.',
      });
    }

    const integrationId = getIntegrationId(method);
    if (!integrationId) {
      return res.status(503).json({
        ok: false,
        error: 'No Paymob integration configured for method: ' + method,
      });
    }

    const amountCents = toCents(amount);

    // ── Step 1: Authenticate ─────────────────────────────────────────────
    const authRes = await paymobPost('/api/auth/tokens', {
      api_key: PAYMOB_API_KEY,
    });
    if (!authRes.token) {
      console.error('[Paymob] Auth failed:', JSON.stringify(authRes));
      return res.status(400).json({ ok: false, error: 'Paymob authentication failed' });
    }
    const authToken = authRes.token;

    // ── Step 2: Create Paymob order ──────────────────────────────────────
    const orderRes = await paymobPost('/api/ecommerce/orders', {
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: 'EGP',
      merchant_order_id: orderId,
      items: [{
        name: 'Cacti order ' + orderId,
        amount_cents: amountCents,
        quantity: 1,
        description: 'Payment for Cacti dine-in order ' + orderId,
      }],
    });
    if (!orderRes.id) {
      console.error('[Paymob] Create order failed:', JSON.stringify(orderRes));
      return res.status(400).json({ ok: false, error: 'Failed to create Paymob order' });
    }
    const paymobOrderId = orderRes.id;

    // ── Step 3: Get payment key ──────────────────────────────────────────
    const keyRes = await paymobPost('/api/acceptance/payment_keys', {
      auth_token: authToken,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: paymobOrderId,
      currency: 'EGP',
      integration_id: Number(integrationId),
      billing_data: normaliseBilling(billing),
      lock_order_when_paid: true,
    });
    if (!keyRes.token) {
      console.error('[Paymob] Payment key failed:', JSON.stringify(keyRes));
      return res.status(400).json({ ok: false, error: 'Failed to generate payment key' });
    }
    const paymentKey = keyRes.token;

    // ── Build iframe URL ─────────────────────────────────────────────────
    const iframeUrl = `${PAYMOB_BASE_URL}/api/acceptance/iframes/${PAYMOB_IFRAME_ID}?payment_token=${paymentKey}`;

    // ── Store intent in Supabase for webhook settlement ──────────────────
    if (supabase) {
      await supabase.from('payment_intents').insert({
        paymob_order_id: String(paymobOrderId),
        order_id: orderId,
        order_db_id: orderDbId || null,
        amount: amount,
        method: method,
        settled: false,
      });
    }

    return res.status(200).json({
      ok: true,
      paymob_order_id: paymobOrderId,
      payment_key: paymentKey,
      iframe_url: iframeUrl,
      method,
      amount,
    });
  } catch (err) {
    console.error('[Paymob] intent error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to create payment intent' });
  }
}