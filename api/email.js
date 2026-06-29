/**
 * Email service for Cacti — sends a single order confirmation email.
 * Uses Resend (https://resend.com) — free tier: 100 emails/day.
 *
 * The confirmation email includes:
 *   - Order summary (items, totals, delivery info)
 *   - Tracking link (/track?token=...)
 *   - Feedback link (/feedback?token=...&ref=...)
 *
 * No separate status-update emails are sent. The customer uses the
 * tracking link to see live status updates on the /track page.
 *
 * Env vars needed on Vercel:
 *   RESEND_API_KEY = re_...        (get from resend.com)
 *   CACTI_EMAIL_FROM = Cacti <orders@cacti.restaurant>
 *
 * If RESEND_API_KEY is not set, emails are skipped silently (fail open).
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[email] RESEND_API_KEY not set — skipping email to', to);
    return null;
  }

  const from = process.env.CACTI_EMAIL_FROM || 'Cacti <noreply@resend.dev>';

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[email] Resend error:', data);
      return null;
    }
    console.log('[email] Sent to', to, '— id:', data.id);
    return data.id;
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    return null;
  }
}

// ── Order confirmation (the only email sent to the customer) ──────────────
export async function sendOrderConfirmationEmail(order) {
  const { customer_email, customer_name, order_ref, total, delivery_slot, delivery_address, items, tracking_token, mode, table_label } = order;

  if (!customer_email) return null;

  const itemList = (items || []).map(it =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">${it.quantity}x ${it.name}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;">EGP ${it.price * it.quantity}</td></tr>`
  ).join('');

  const subject = mode === 'dine_in'
    ? `Order received — Table ${table_label || ''} (${order_ref})`
    : `Order received — ${order_ref}`;

  const trackingUrl = `https://cacti.restaurant/track?token=${tracking_token}`;
  const feedbackUrl = `https://cacti.restaurant/feedback?token=${tracking_token}&ref=${order_ref}`;

  // Logo hosted on the deployed site — referenced by absolute URL so it
  // renders inside email clients. Using the Vercel domain (stable).
  const logoUrl = 'https://cacti-website-mauve.vercel.app/cacti-logo-header-white.png';

  const html = `
  <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;">
    <div style="background:#0a0a0a;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <img src="${logoUrl}" alt="Cacti" style="max-width:180px;height:auto;margin:0 auto 4px;display:block;" />
      <p style="color:#0a4d4d;margin:0;font-size:14px;">Mediterranean · Marsa Baghush</p>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
      <h2 style="font-size:18px;margin:0 0 4px;">${mode === 'dine_in' ? '🍽️ Order sent to kitchen!' : '🛒 Order received!'}</h2>
      <p style="color:#666;margin:0 0 16px;font-size:14px;">Hi ${customer_name}, we've received your order${mode === 'dine_in' ? ' at Table ' + (table_label || '') : ''}.</p>

      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        ${itemList}
        <tr><td style="padding:8px 0;color:#666;">Subtotal</td><td style="padding:8px 0;text-align:right;">EGP ${order.subtotal}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">VAT (14%)</td><td style="padding:4px 0;text-align:right;">EGP ${order.vat_amount}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Service (12%)</td><td style="padding:4px 0;text-align:right;">EGP ${order.service_amount}</td></tr>
        <tr><td style="padding:8px 0;border-top:2px solid #0a4d4d;font-weight:700;color:#0a4d4d;">Total</td><td style="padding:8px 0;border-top:2px solid #0a4d4d;text-align:right;font-weight:700;color:#0a4d4d;font-size:18px;">EGP ${total}</td></tr>
      </table>

      ${mode === 'delivery' && delivery_address ? `<p style="color:#666;font-size:13px;margin:12px 0;">📍 <strong>Delivery to:</strong> ${delivery_address}</p>` : ''}
      ${mode === 'delivery' && delivery_slot ? `<p style="color:#666;font-size:13px;margin:4px 0;">⏰ <strong>Time:</strong> ${delivery_slot}</p>` : ''}

      <!-- Tracking + Feedback buttons -->
      <div style="margin:24px 0 8px;">
        <a href="${trackingUrl}" style="display:block;text-align:center;background:#0a4d4d;color:#fff;text-decoration:none;padding:14px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:10px;">Track your order →</a>
        <a href="${feedbackUrl}" style="display:block;text-align:center;background:#fff;color:#0a4d4d;text-decoration:none;padding:14px;border:2px solid #0a4d4d;border-radius:8px;font-weight:600;font-size:14px;">⭐ Leave feedback</a>
      </div>

      <p style="color:#999;font-size:12px;text-align:center;margin:16px 0 0;">
        Order ref: ${order_ref}<br/>
        Use the tracking link to follow your order status in real time.
      </p>
    </div>
  </div>`;

  return sendEmail(customer_email, subject, html);
}