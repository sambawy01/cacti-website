import https from 'https';
import { createClient } from '@supabase/supabase-js';

// ── Supabase ──────────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

// ── Foodics config ────────────────────────────────────────────────────────
const FOODICS_BASE_URL=process.env.FOODICS_BASE_URL || 'https://api.foodics.com/v5';
const FOODICS_ACCESS_TOKEN=process.env.KEN || '';
const FOODICS_BRANCH_ID=process.env.FOODICS_BRANCH_ID || '';

function isFoodicsConfigured() {
  return !!(FOODICS_ACCESS_TOKEN && FOODICS_BRANCH_ID);
}

/** Generic Foodics API call */
function foodicsRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(FOODICS_BASE_URL + path);
    const postData = body ? JSON.stringify(body) : '';
    const headers = {
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + FOODICS_ACCESS_TOKEN,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: response.statusCode, data: { raw: data } }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(postData);
    req.end();
  });
}

/**
 * Push a Cacti dine-in order to Foodics POS.
 * Called after the order is saved to Supabase.
 */
async function pushOrderToFoodics(orderData) {
  const {
    orderRef, tableId, tableLabel, items, subtotal, vatAmount,
    serviceAmount, total, customerName, customerPhone, note,
  } = orderData;

  // Map Cacti items to Foodics products format
  // Note: Foodics expects product_id. Since Cacti menu items may not have
  // Foodics product IDs yet, we send them as custom items with name + price.
  // In production, you'd map menu_items.foodics_product_id.
  const products = items.map((it) => ({
    name: it.name,
    quantity: it.quantity,
    unit_price: Number(it.price.toFixed(2)),
    total_price: Number((it.price * it.quantity).toFixed(2)),
  }));

  const foodicsOrder = {
    type: 1, // DineIn
    branch_id: FOODICS_BRANCH_ID,
    table_id: tableId, // Foodics table ID (if mapped)
    guests: 1,
    customer_notes: note || '',
    kitchen_notes: note || '',
    products,
    meta: {
      source: 'cacti_website',
      order_ref: orderRef,
      customer_name: customerName || '',
      customer_phone: customerPhone || '',
    },
  };

  const result = await foodicsRequest('POST', '/orders', foodicsOrder);
  return result;
}

/**
 * Update order status in Foodics.
 */
async function updateFoodicsOrderStatus(foodicsOrderId, status) {
  const statusMap = {
    'pending_approval': 1, // Open
    'confirmed': 2,        // Sent
    'preparing': 3,        // Preparing
    'served': 5,           // Served
    'cancelled': 7,        // Cancelled
  };

  const foodicsStatus = statusMap[status] || 2;
  return foodicsRequest('PUT', '/orders/' + foodicsOrderId, {
    status: foodicsStatus,
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const orderData = req.body;

    if (!orderData || !orderData.orderRef) {
      return res.status(400).json({ ok: false, error: 'orderRef is required' });
    }

    // ── Dev mode: Foodics not configured ─────────────────────────────────
    if (!isFoodicsConfigured()) {
      console.log('[Foodics] Dev mode — not configured, skipping POS push for', orderData.orderRef);

      // Mark as not_configured in Supabase
      if (supabase && orderData.orderDbId) {
        await supabase
          .from('orders')
          .update({
            foodics_sync_status: 'not_configured',
            foodics_synced_at: new Date().toISOString(),
          })
          .eq('id', orderData.orderDbId);
      }

      return res.status(200).json({
        ok: true,
        dev_mode: true,
        synced: false,
        message: 'Foodics not configured — order saved to Supabase only',
      });
    }

    // ── Push to Foodics ──────────────────────────────────────────────────
    const result = await pushOrderToFoodics(orderData);

    if (result.status === 200 || result.status === 201) {
      const foodicsOrderId = result.data?.data?.id || result.data?.id || null;

      // Update Supabase with Foodics order ID
      if (supabase && orderData.orderDbId) {
        await supabase
          .from('orders')
          .update({
            foodics_order_id: foodicsOrderId,
            foodics_sync_status: 'synced',
            foodics_synced_at: new Date().toISOString(),
          })
          .eq('id', orderData.orderDbId);
      }

      console.log('[Foodics] Order pushed successfully:', orderData.orderRef, '→ Foodics ID:', foodicsOrderId);
      return res.status(200).json({
        ok: true,
        synced: true,
        foodics_order_id: foodicsOrderId,
      });
    } else {
      console.error('[Foodics] Push failed:', result.status, JSON.stringify(result.data));

      // Mark as failed in Supabase
      if (supabase && orderData.orderDbId) {
        await supabase
          .from('orders')
          .update({
            foodics_sync_status: 'failed',
            foodics_synced_at: new Date().toISOString(),
          })
          .eq('id', orderData.orderDbId);
      }

      return res.status(200).json({
        ok: false,
        synced: false,
        error: 'Foodics API returned status ' + result.status,
      });
    }
  } catch (err) {
    console.error('[Foodics] push error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to push to Foodics' });
  }
}

export { updateFoodicsOrderStatus };