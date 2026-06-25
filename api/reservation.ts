import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    const message = [
      `🌵 NEW RESERVATION REQUEST`,
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
      `⚠️ This is a request — needs your confirmation + payment link.`,
    ].filter(Boolean).join('\n');

    const BOT_TOKEN=proces...N;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1412831908';

    let telegramResult: any = { skipped: true, reason: 'no token' };

    if (BOT_TOKEN) {
      try {
        const https = await import('https');
        const tgData = await new Promise<any>((resolve, reject) => {
          const payload = JSON.stringify({
            chat_id: CHAT_ID,
            text: message,
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
      debug: {
        tokenSet: !!BOT_TOKEN,
        chatId: CHAT_ID,
        telegram: telegramResult,
      },
    });
  } catch (err) {
    console.error('Reservation API error:', err);
    return res.status(500).json({ error: 'Failed to process reservation' });
  }
}