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

    // Validate required fields
    if (!name || !phone || !email || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Format date nicely
    const dateObj = new Date(date);
    const dateLabel = dateObj.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    // Build the Telegram message
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

    // Send to Telegram
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1412831908';

    if (BOT_TOKEN) {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML',
          }),
        }
      );

      if (!tgRes.ok) {
        console.error('Telegram API error:', await tgRes.text());
        // Still return success to user — the request was received
      }
    } else {
      console.warn('TELEGRAM_BOT_TOKEN not set — reservation not sent to Telegram');
    }

    // TODO: When Supabase is set up, also store the reservation in the database

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Reservation API error:', err);
    return res.status(500).json({ error: 'Failed to process reservation' });
  }
}