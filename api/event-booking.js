import https from 'https';
import { createClient } from '@supabase/supabase-js';

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
    const { name, phone, email, eventType, eventDate, partySize, notes } = req.body;

    if (!name || !phone || !email) {
      return res.status(400).json({ ok: false, error: 'Name, phone, and email are required' });
    }

    // ── Save to Supabase ──────────────────────────────────────────────────
    let dbId = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('event_bookings')
        .insert({
          status: 'pending',
          customer_name: name,
          customer_phone: phone,
          customer_email: email,
          event_type: eventType || null,
          event_date: eventDate || null,
          party_size: partySize ? parseInt(partySize) : null,
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
      console.warn('SUPABASE_SERVICE_ROLE_KEY not set — booking not saved to DB');
    }

    // ── Telegram notification ─────────────────────────────────────────────
    const dateLabel = eventDate
      ? new Date(eventDate).toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        })
      : 'Date TBD';

    const message = [
      `🎉 EVENT ENQUIRY`,
      dbId ? `DB: ${dbId}` : '',
      ``,
      `👤 ${name}`,
      `📞 ${phone}`,
      `✉️ ${email}`,
      `📋 Type: ${eventType || 'Not specified'}`,
      `📅 Date: ${dateLabel}`,
      `👥 Party Size: ${partySize || 'TBD'}`,
      notes ? `📝 Notes: ${notes}` : '',
      ``,
      `Review and send a quote + Paymob link.`,
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

    return res.status(200).json({
      ok: true,
      bookingId: dbId,
    });
  } catch (err) {
    console.error('Event booking API error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to submit enquiry' });
  }
}