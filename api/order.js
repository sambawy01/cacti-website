import https from 'https';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      items, name, phone, email,
      address, location, note, deliverySlot, paymentMethod,
    } = req.body;

    if (!name || !phone || !email || !address) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    // Calculate totals: menu price + 14% VAT + 12% service
    const subtotal = (items || []).reduce((sum, it) => sum + (it.price * it.quantity), 0);
    const vat = Math.round(subtotal * 0.14);
    const service = Math.round(subtotal * 0.12);
    const total = subtotal + vat + service;

    const orderId = `O${Date.now().toString(36).toUpperCase()}`;

    const itemList = (items || []).map(it =>
      `  • ${it.quantity}x ${it.name} — EGP ${it.price * it.quantity}`
    ).join('\n');

    const paymentLabels = {
      cod: 'Cash on Delivery',
      card_on_delivery: 'Card on Delivery',
      instapay: 'InstaPay (bank transfer)',
    };

    const message = [
      `🛒 NEW ORDER — ${orderId}`,
      ``,
      `👤 ${name}`,
      `📞 ${phone}`,
      `✉️ ${email}`,
      `📍 ${address}`,
      location ? `🗺️ ${location}` : '',
      ``,
      `Items:`,
      itemList,
      ``,
      `Subtotal: EGP ${subtotal}`,
      `VAT (14%): EGP ${vat}`,
      `Service (12%): EGP ${service}`,
      `Total: EGP ${total}`,
      ``,
      `⏰ Delivery: ${deliverySlot}`,
      `💳 ${paymentLabels[paymentMethod] || paymentMethod}`,
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

    return res.status(200).json({
      ok: true,
      status: 'confirmed',
      trackingToken: orderId,
      deliverySlot,
      paymentMethod,
      total,
    });
  } catch (err) {
    console.error('Order API error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to place order' });
  }
}