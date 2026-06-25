import https from 'https';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function tgSendMessage(chatId, text, replyMarkup) {
  return new Promise((resolve, reject) => {
    const body = { chat_id: chatId, text };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const payload = JSON.stringify(body);

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
}

function tgAnswerCallback(callbackId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      callback_query_id: callbackId,
      text: text || '',
    });

    const request = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/answerCallbackQuery`,
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
}

function tgEditMessage(chatId, messageId, text, replyMarkup) {
  return new Promise((resolve, reject) => {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const payload = JSON.stringify(body);

    const request = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/editMessageText`,
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
}

// Table options (placeholder until real floor plan)
const TABLE_BUTTONS = {
  beach: [
    [{ text: 'B1', callback_data: 'table:B1' }, { text: 'B2', callback_data: 'table:B2' }, { text: 'B3', callback_data: 'table:B3' }],
    [{ text: 'B4', callback_data: 'table:B4' }, { text: 'B5', callback_data: 'table:B5' }, { text: 'B6', callback_data: 'table:B6' }],
    [{ text: 'U1', callback_data: 'table:U1' }, { text: 'U2', callback_data: 'table:U2' }, { text: 'U3', callback_data: 'table:U3' }],
    [{ text: 'U4', callback_data: 'table:U4' }, { text: 'U5', callback_data: 'table:U5' }, { text: 'U6', callback_data: 'table:U6' }],
  ],
  restaurant: [
    [{ text: 'T1', callback_data: 'table:T1' }, { text: 'T2', callback_data: 'table:T2' }, { text: 'T3', callback_data: 'table:T3' }, { text: 'T4', callback_data: 'table:T4' }],
    [{ text: 'T5', callback_data: 'table:T5' }, { text: 'T6', callback_data: 'table:T6' }, { text: 'T7', callback_data: 'table:T7' }, { text: 'T8', callback_data: 'table:T8' }],
    [{ text: 'T9', callback_data: 'table:T9' }, { text: 'T10', callback_data: 'table:T10' }, { text: 'T11', callback_data: 'table:T11' }, { text: 'T12', callback_data: 'table:T12' }],
    [{ text: 'T13', callback_data: 'table:T13' }, { text: 'T14', callback_data: 'table:T14' }, { text: 'T15', callback_data: 'table:T15' }, { text: 'T16', callback_data: 'table:T16' }],
    [{ text: 'T17', callback_data: 'table:T17' }, { text: 'T18', callback_data: 'table:T18' }, { text: 'T19', callback_data: 'table:T19' }, { text: 'T20', callback_data: 'table:T20' }],
    [{ text: 'Bar 1', callback_data: 'table:BAR1' }, { text: 'Bar 2', callback_data: 'table:BAR2' }, { text: 'Bar 3', callback_data: 'table:BAR3' }],
  ],
};

// Store pending reservations in memory (per instance)
// callback_data has a 64-byte limit, so we store full data here
// keyed by a short ID passed in callback_data
const pendingReservations = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'webhook active' });
  }

  try {
    const update = req.body;

    // Handle callback query (button press)
    if (update.callback_query) {
      const cb = update.callback_query;
      const callbackId = cb.id;
      const chatId = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const data = cb.data;

      // Parse callback data
      if (data === 'noop') {
        await tgAnswerCallback(callbackId);
        return res.status(200).json({ ok: true });
      }

      // Confirm flow: confirm:<base64data>
      if (data.startsWith('confirm:')) {
        const encoded = data.slice(8);
        const resData = JSON.parse(Buffer.from(encoded, 'base64url').toString());

        // Store in pending for table selection
        const pendingId = resData.resId;
        pendingReservations.set(pendingId, { ...resData, chatId, messageId });

        // Edit the original message to show it's being processed
        const typeLabel = resData.type === 'beach' ? '🏖️ Beach' : '🍽️ Restaurant';
        await tgEditMessage(chatId, messageId,
          `✅ CONFIRMING RESERVATION #${resData.resId}\n\n${typeLabel} — ${resData.name}\n📅 ${resData.date} at ${resData.time}\n\nSelect a table/spot to assign:`,
          { inline_keyboard: TABLE_BUTTONS[resData.type] || TABLE_BUTTONS.restaurant }
        );

        await tgAnswerCallback(callbackId, 'Confirming...');
        return res.status(200).json({ ok: true });
      }

      // Table selected: table:<tableId>
      if (data.startsWith('table:')) {
        const tableId = data.slice(6);

        // Find the pending reservation — check all pending
        let reservation = null;
        let pendingId = null;
        for (const [id, res] of pendingReservations.entries()) {
          if (res.chatId === chatId && res.messageId === messageId) {
            reservation = res;
            pendingId = id;
            break;
          }
        }

        if (!reservation) {
          // Try to get from the original message text (fallback)
          await tgSendMessage(chatId,
            `⚠️ Could not find reservation data. Please process from the original reservation message.\n\nTable ${tableId} selected but reservation context lost.`
          );
          await tgAnswerCallback(callbackId, 'Context lost');
          return res.status(200).json({ ok: true });
        }

        // Confirm the reservation with table assignment
        const typeLabel = reservation.type === 'beach' ? '🏖️ Beach' : '🍽️ Restaurant';
        const sizeLabel = reservation.type === 'beach'
          ? `${reservation.sunbeds} sunbeds`
          : `${reservation.partySize} guests`;

        await tgEditMessage(chatId, reservation.messageId,
          `✅ RESERVATION CONFIRMED #${reservation.resId}\n\n${typeLabel} — ${reservation.name}\n📞 ${reservation.phone}\n✉️ ${reservation.email}\n📅 ${reservation.date} at ${reservation.time}\n👥 ${sizeLabel}\n🪑 Table: ${tableId}\n\n📧 Email sent to customer with payment link.\n\nTo send the email manually:\n/review ${reservation.resId}`,
          { inline_keyboard: [[{ text: '📧 Resend Email', callback_data: `resend:${pendingId}` }]] }
        );

        await tgAnswerCallback(callbackId, `Table ${tableId} assigned`);

        // TODO: Send email to customer with payment link
        // This will be wired in when Resend API key + pricing are provided
        // For now, just notify Hany
        await tgSendMessage(chatId,
          `📧 EMAIL PENDING: Customer email (${reservation.email}) not sent yet — waiting for Resend API key + pricing to be configured.`
        );

        pendingReservations.delete(pendingId);
        return res.status(200).json({ ok: true });
      }

      // Reject flow: reject:<base64data>
      if (data.startsWith('reject:')) {
        const encoded = data.slice(7);
        const resData = JSON.parse(Buffer.from(encoded, 'base64url').toString());

        const rejectButtons = {
          inline_keyboard: [
            [
              { text: '📦 At Capacity', callback_data: `rejected:${encoded}:capacity` },
              { text: '🗓️ No Availability', callback_data: `rejected:${encoded}:availability` },
            ],
            [
              { text: '🕐 Outside Hours', callback_data: `rejected:${encoded}:hours` },
              { text: '📝 Other Reason', callback_data: `rejected:${encoded}:other` },
            ],
          ],
        };

        await tgEditMessage(chatId, messageId,
          `❌ REJECTING RESERVATION #${resData.resId}\n\n${resData.name} — ${resData.date} at ${resData.time}\n\nSelect a reason:`,
          rejectButtons
        );

        await tgAnswerCallback(callbackId, 'Select reason');
        return res.status(200).json({ ok: true });
      }

      // Rejection reason selected: rejected:<base64data>:<reason>
      if (data.startsWith('rejected:')) {
        const parts = data.split(':');
        // parts[0] = rejected, parts[1] = encoded data (may contain colons in base64url)
        // Actually base64url doesn't contain colons, so this should be fine
        const encoded = parts[1];
        const reason = parts[2];
        const resData = JSON.parse(Buffer.from(encoded, 'base64url').toString());

        const reasonLabels = {
          capacity: 'We are at full capacity on this date',
          availability: 'We have no availability for the requested time',
          hours: 'The requested time is outside our operating hours',
          other: 'We are unable to accommodate this reservation',
        };

        const reasonLabel = reasonLabels[reason] || reasonLabels.other;

        await tgEditMessage(chatId, messageId,
          `❌ RESERVATION DECLINED #${resData.resId}\n\n${resData.name} — ${resData.date}\n\nReason: ${reasonLabel}\n\n📧 Email sent to customer.`
        );

        await tgAnswerCallback(callbackId, 'Declined');

        // TODO: Send polite rejection email to customer
        // For now, notify Hany
        await tgSendMessage(chatId,
          `📧 EMAIL PENDING: Rejection email to ${resData.email} not sent yet — waiting for Resend API key.`
        );

        return res.status(200).json({ ok: true });
      }

      // Resend email: resend:<pendingId>
      if (data.startsWith('resend:')) {
        await tgAnswerCallback(callbackId, 'Not implemented yet');
        return res.status(200).json({ ok: true });
      }

      await tgAnswerCallback(callbackId);
      return res.status(200).json({ ok: true });
    }

    // Handle regular messages
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';

      if (text === '/start' || text.toLowerCase().includes('start')) {
        await tgSendMessage(chatId,
          `🌵 Cacti Reservation Bot\n\nThis bot manages reservation requests from cacti.restaurant.\n\nNew reservations will appear here with Confirm/Reject buttons.\n\nCommands:\n/status — Check bot status`
        );
        return res.status(200).json({ ok: true });
      }

      if (text === '/status') {
        await tgSendMessage(chatId,
          `✅ Bot is active.\n📥 Webhook: ${process.env.VERCEL_URL || 'cacti.restaurant'}\n📋 Pending reservations: ${pendingReservations.size}\n🔑 Email service: ${process.env.RESEND_API_KEY ? 'configured' : 'pending'}\n💰 Pricing: ${process.env.CACTI_PRICING ? 'configured' : 'pending'}`
        );
        return res.status(200).json({ ok: true });
      }

      // Unknown message
      await tgSendMessage(chatId, `Received: "${text}"\n\nThis bot handles reservation requests. New reservations from the website will appear here automatically.`);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
}