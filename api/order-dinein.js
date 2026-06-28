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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tableId, items, name, phone, note } = req.body;

    if (!tableId) {
      return res.status(400).json({ ok: false, error: 'Missing table ID' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items in order' });
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
          payment_method: 'cash_on_site',
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
    });
  } catch (err) {
    console.error('Dine-in order API error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to place order' });
  }
}