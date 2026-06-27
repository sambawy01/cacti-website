import https from 'https';
import { createClient } from '@supabase/supabase-js';

// ── Supabase client (server-side, uses service role key) ──────────────────
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
    const {
      type, name, phone, email, date, time,
      partySize, sunbeds, notes,
    } = req.body;

    if (!name || !phone || !email || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const dateObj = new Date(date);
    const dateLabel = dateObj.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    const typeLabel = type === 'beach' ? '🏖️ Beach (Umbrella + Sunbeds)' : '🍽️ Restaurant';
    const sizeLabel = type === 'beach'
      ? `Sunbeds: ${sunbeds}`
      : `Party Size: ${partySize}`;

    const resId = `R${Date.now().toString(36).toUpperCase()}`;

    // ── Save to Supabase ──────────────────────────────────────────────────
    let dbId = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('reservations')
        .insert({
          type: type === 'beach' ? 'beach' : 'restaurant',
          status: 'pending',
          customer_name: name,
          customer_phone: phone,
          customer_email: email,
          res_date: date,
          res_time: time,
          party_size: type === 'restaurant' ? parseInt(partySize) || 0 : 0,
          sunbeds: type === 'beach' ? parseInt(sunbeds) || 0 : 0,
          notes: notes || '',
        })
        .select('id')
        .single();

      if (error) {
        console.error('Supabase insert error:', error.message);
      } else if (data) {
        dbId = data.id;
      }
    } else {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not set — reservation not saved to DB');
    }

    // ── Send Telegram notification (keep existing behavior) ───────────────
    const message = [
      `🌵 NEW RESERVATION REQUEST`,
      `#${resId}`,
      dbId ? `DB: ${dbId}` : '',
      ``,
      `📋 Type: ${typeLabel}`,
      `👤 Name: ${name}`,
      `📞 Phone: ${phone}`,
      `✉️ Email: ${email}`,
      `📅 Date: ${dateLabel}`,
      `⏰ Time: ${time}`,
      `👥 ${sizeLabel}`,
      notes ? `📝 Notes: ${notes}` : '',
      ``,
      `⚠️ Tap a button below to action this request.`,
    ].filter(Boolean).join('\n');

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1412831908';

    let telegramResult = { skipped: true, reason: 'no token' };

    if (BOT_TOKEN) {
      try {
        const resData = JSON.stringify({ resId, type, name, phone, email, date, time, partySize, sunbeds, notes, dbId });
        const encoded = Buffer.from(resData).toString('base64url');
        const callbackConfirm = `confirm:${encoded}`;
        const callbackReject = `reject:${encoded}`;

        const tgData = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            chat_id: CHAT_ID,
            text: message,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Confirm', callback_data: callbackConfirm },
                  { text: '❌ Cannot Accommodate', callback_data: callbackReject },
                ],
              ],
            },
          });

          const request = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
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

        telegramResult = tgData;

        if (!tgData.ok) {
          console.error('Telegram API error:', tgData);
        }
      } catch (tgErr) {
        console.error('Telegram send error:', tgErr);
        telegramResult = { error: String(tgErr) };
      }
    } else {
      console.warn('TELEGRAM_BOT_TOKEN not set — reservation not sent to Telegram');
    }

    return res.status(200).json({
      success: true,
      reservationId: resId,
      dbId,
    });
  } catch (err) {
    console.error('Reservation API error:', err);
    return res.status(500).json({ error: 'Failed to process reservation' });
  }
}