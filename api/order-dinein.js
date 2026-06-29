import https from 'https';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendOrderConfirmationEmail } from './email.js';

// ── Supabase client (server-side) ─────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

/**
 * Check if a phone number was verified recently (within 30 minutes).
 */
async function isPhoneVerified(phone) {
  if (!supabase || !phone) return false;
  const phoneClean = phone.replace(/[\s\-\(\)]/g, '');
  const { data } = await supabase
    .from('verified_phones')
    .select('phone, verified_at')
    .eq('phone', phoneClean)
    .gte('verified_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .maybeSingle();
  return !!data;
}

/**
 * Push order to Foodics POS (fire-and-forget, non-blocking).
 * Logs success/failure but doesn't block the order response.
 */
async function pushToFoodics(orderData) {
  try {
    const foodicsUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/foodics-push`
      : null;

    // In production, call the foodics-push API directly
    // For now, we just log — the foodics-push.js route handles the actual API call
    if (foodicsUrl) {
      const https = require('https');
      const url = new URL(foodicsUrl);
      const postData = JSON.stringify(orderData);
      return new Promise((resolve) => {
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        }, (response) => {
          let data = '';
          response.on('data', chunk => { data += chunk; });
          response.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve({ ok: false }); }
          });
        });
        req.on('error', () => resolve({ ok: false }));
        req.write(postData);
        req.end();
      });
    }
    return { ok: false, dev_mode: true };
  } catch (e) {
    console.error('[DineIn] Foodics push error:', e.message);
    return { ok: false };
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tableId, items, name, phone, note, paymentMethod } = req.body;

    if (!tableId) {
      return res.status(400).json({ ok: false, error: 'Missing table ID' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items in order' });
    }

    // ── Phone verification gate ──────────────────────────────────────────
    if (phone) {
      const verified = await isPhoneVerified(phone);
      if (!verified) {
        return res.status(403).json({
          ok: false,
          code: 'phone_not_verified',
          error: 'Phone number not verified. Please complete OTP verification first.',
        });
      }
    }

    // ── Look up the table ────────────────────────────────────────────────
    let tableLabel = 'Unknown Table';
    let tableZone = 'dining';
    if (supabase) {
      const { data: tableData, error: tableError } = await supabase
        .from('tables')
        .select('label, zone')
        .eq('id', tableId)
        .single();

      if (!tableError && tableData) {
        tableLabel = tableData.label;
        tableZone = tableData.zone;
      }
    }

    // ── Calculate totals (same as delivery: subtotal + 14% VAT + 12% service) ──
    const subtotal = items.reduce((sum, it) => sum + (it.price * it.quantity), 0);
    const vat = Math.round(subtotal * 0.14);
    const service = Math.round(subtotal * 0.12);
    const total = subtotal + vat + service;

    const orderId = `D${Date.now().toString(36).toUpperCase()}`;
    const trackingToken = crypto.randomUUID();

    // ── Save to Supabase ──────────────────────────────────────────────────
    let dbId = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('orders')
        .insert({
          order_ref: orderId,
          mode: 'dine_in',
          status: 'pending_approval',
          customer_name: name || `Table ${tableLabel} guest`,
          customer_phone: phone || '',
          customer_email: '',  // not required for dine-in
          table_id: tableId,
          items: items.map(it => ({
            name: it.name,
            price: it.price,
            quantity: it.quantity,
          })),
          subtotal,
          vat_amount: vat,
          service_amount: service,
          total,
          payment_method: paymentMethod || 'cash_on_site',
          tracking_token: trackingToken,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Supabase insert error:', error.message);
      } else if (data) {
        dbId = data.id;
      }
    }

    // ── Push to Foodics POS (non-blocking) ─────────────────────────────────
    const foodicsResult = await pushToFoodics({
      orderRef: orderId,
      orderDbId: dbId,
      tableId,
      tableLabel,
      items,
      subtotal,
      vatAmount: vat,
      serviceAmount: service,
      total,
      customerName: name,
      customerPhone: phone,
      note,
    });
    if (foodicsResult?.ok) {
      console.log('[DineIn] Foodics sync OK for', orderId);
    }

    // ── Telegram notification ─────────────────────────────────────────────
    const itemList = items.map(it =>
      `  • ${it.quantity}x ${it.name} — EGP ${it.price * it.quantity}`
    ).join('\n');

    const zoneEmoji = tableZone === 'bar' ? '🍸' : tableZone === 'daybed' ? '🏖️' : '🍽️';

    const message = [
      `${zoneEmoji} DINE-IN ORDER — ${orderId}`,
      dbId ? `DB: ${dbId}` : '',
      ``,
      `Table: ${tableLabel} (${tableZone})`,
      name ? `👤 ${name}` : '',
      phone ? `📞 ${phone}` : '',
      ``,
      `Items:`,
      itemList,
      ``,
      `Subtotal: EGP ${subtotal}`,
      `VAT (14%): EGP ${vat}`,
      `Service (12%): EGP ${service}`,
      `Total: EGP ${total}`,
      note ? `📝 Notes: ${note}` : '',
    ].filter(Boolean).join('\n');

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID || '1412831908';

    if (botToken) {
      try {
        await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            chat_id: chatId,
            text: message,
          });

          const request = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${botToken}/sendMessage`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
          }, (response) => {
            let data = '';
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => {
              try { resolve(JSON.parse(data)); }
              catch { resolve({ raw: data }); }
            });
          });

          request.on('error', reject);
          request.write(payload);
          request.end();
        });
      } catch (tgErr) {
        console.error('Telegram send error:', tgErr);
      }
    }

    // ── Send confirmation email to customer (if email provided) ────────
    if (phone || name) {
      // Dine-in may not have email — only send if we have one
      // For now, skip email for dine-in unless we add email collection later
    }

    return res.status(200).json({
      ok: true,
      status: 'confirmed',
      trackingToken,
      orderId,
      dbId,
      tableLabel,
      total,
      paymentMethod: paymentMethod || 'cash_on_site',
    });
  } catch (err) {
    console.error('Dine-in order API error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to place order' });
  }
}