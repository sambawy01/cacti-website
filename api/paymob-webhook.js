import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ── Supabase ──────────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

const PAYMOB_WEBHOOK_HMAC_SECRET = process.env.PAYMOB_WEBHOOK_HMAC_SECRET || '';

/**
 * Verify Paymob webhook HMAC signature.
 * Paymob concatenates a fixed, lexicographically-ordered subset of the
 * transaction object fields, SHA-512 HMACs it with the merchant secret.
 */
function verifyWebhook(hmac, obj) {
  if (!PAYMOB_WEBHOOK_HMAC_SECRET || !hmac) return false;

  const keys = [
    'amount_cents', 'created_at', 'currency', 'error_occured',
    'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
    'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
    'is_voided', 'order.id', 'owner', 'pending',
    'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
  ];

  const concatenated = keys.map((keyPath) => {
    const value = keyPath.split('.').reduce((acc, part) => {
      if (acc && typeof acc === 'object') return acc[part];
      return undefined;
    }, obj);
    if (value === true) return 'true';
    if (value === false) return 'false';
    if (value === null || value === undefined) return '';
    return String(value);
  }).join('');

  const computed = crypto
    .createHmac('sha512', PAYMOB_WEBHOOK_HMAC_SECRET)
    .update(concatenated)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hmac, 'hex'));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Paymob sends the transaction data in the body and the HMAC in query params
    const hmac = req.query.hmac || '';
    const obj = req.body;

    if (!obj || typeof obj !== 'object') {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // ── Dev mode: no HMAC secret ─────────────────────────────────────────
    if (!PAYMOB_WEBHOOK_HMAC_SECRET) {
      console.log('[Paymob Webhook] Dev mode — no HMAC secret, accepting without verification');
    } else {
      // Verify HMAC
      if (!verifyWebhook(hmac, obj)) {
        console.error('[Paymob Webhook] HMAC verification failed');
        return res.status(403).json({ error: 'HMAC verification failed' });
      }
    }

    // Check if transaction was successful
    const success = obj.success === true || obj.success === 'true';
    if (!success) {
      console.log('[Paymob Webhook] Transaction not successful, ignoring');
      return res.status(200).json({ ok: true, success: false });
    }

    const paymobOrderId = obj.order?.id ? String(obj.order.id) : null;
    const txnRef = obj.id ? String(obj.id) : null;

    if (!paymobOrderId || !supabase) {
      return res.status(200).json({ ok: true, settled: false });
    }

    // ── Look up the payment intent ───────────────────────────────────────
    const { data: intent, error: intentError } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('paymob_order_id', paymobOrderId)
      .maybeSingle();

    if (intentError || !intent) {
      console.error('[Paymob Webhook] No matching intent for paymob_order_id:', paymobOrderId);
      return res.status(200).json({ ok: true, settled: false });
    }

    if (intent.settled) {
      console.log('[Paymob Webhook] Intent already settled:', paymobOrderId);
      return res.status(200).json({ ok: true, already_settled: true });
    }

    // ── Mark intent as settled ───────────────────────────────────────────
    await supabase
      .from('payment_intents')
      .update({ settled: true, settled_at: new Date().toISOString() })
      .eq('paymob_order_id', paymobOrderId);

    // ── Update the order in Supabase ─────────────────────────────────────
    if (intent.order_db_id) {
      await supabase
        .from('orders')
        .update({
          paymob_paid: true,
          paymob_ref: txnRef,
          paymob_order_id: paymobOrderId,
          paid_at: new Date().toISOString(),
          status: 'confirmed',
          status_timeline: [
            { status: 'pending_approval', at: new Date().toISOString() },
            { status: 'confirmed', at: new Date().toISOString(), note: 'Payment confirmed via Paymob' },
          ],
        })
        .eq('id', intent.order_db_id);
    }

    console.log('[Paymob Webhook] Payment settled for order:', intent.order_id);

    return res.status(200).json({
      ok: true,
      settled: true,
      order_id: intent.order_id,
      amount: intent.amount,
    });
  } catch (err) {
    console.error('[Paymob Webhook] error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}