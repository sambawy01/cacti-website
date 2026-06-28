import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Missing tracking token' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data, error } = await supabase
      .from('orders')
      .select('customer_name, status, delivery_date, delivery_slot, items, total')
      .eq('tracking_token', token)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Return only customer-safe fields
    const itemList = (data.items || []).map(it =>
      `${it.quantity}x ${it.name}`
    ).join(', ');

    return res.status(200).json({
      name: data.customer_name,
      status: data.status,
      deliveryDate: data.delivery_date || '',
      deliverySlot: data.delivery_slot || '',
      orderSummary: itemList,
      orderTotal: data.total ?? 0,
    });
  } catch (err) {
    console.error('Track API error:', err);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
}