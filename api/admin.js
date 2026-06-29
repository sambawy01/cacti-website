import { createClient } from '@supabase/supabase-js';

// Note: We no longer send status-update emails. The customer gets a single
// confirmation email at order placement with a tracking link and feedback
// link. They use the tracking link to see live status updates.

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || 'cacti2025';

const supabase = supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

function checkAuth(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token !== adminPassword) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  const action = req.query.action;

  try {
    // ── GET: list operations ────────────────────────────────────────────
    if (req.method === 'GET') {
      switch (action) {
        case 'orders': {
          const { data, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true, data });
        }
        case 'reservations': {
          const { data, error } = await supabase
            .from('reservations')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true, data });
        }
        case 'events': {
          const { data, error } = await supabase
            .from('event_bookings')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true, data });
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }

    // ── PATCH: update operations ────────────────────────────────────────
    if (req.method === 'PATCH' || req.method === 'POST') {
      const body = req.body || {};
      switch (action) {
        case 'update_order': {
          const { id, status } = body;
          if (!id || !status) return res.status(400).json({ error: 'Missing id or status' });
          const updates = { status, updated_at: new Date().toISOString() };
          if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
          if (status === 'delivered') updates.delivered_at = new Date().toISOString();
          if (status === 'served') updates.served_at = new Date().toISOString();
          const { error } = await supabase.from('orders').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });

          // No status-update email — customer tracks via /track?token=...
          return res.status(200).json({ ok: true });
        }
        case 'update_reservation': {
          const { id, status } = body;
          if (!id || !status) return res.status(400).json({ error: 'Missing id or status' });
          const updates = { status, updated_at: new Date().toISOString() };
          if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
          if (status === 'declined') updates.declined_at = new Date().toISOString();
          if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();
          const { error } = await supabase.from('reservations').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true });
        }
        case 'update_event': {
          const { id, status, quoted_price, paymob_link } = body;
          if (!id) return res.status(400).json({ error: 'Missing id' });
          const updates = { updated_at: new Date().toISOString() };
          if (status) updates.status = status;
          if (quoted_price !== undefined) updates.quoted_price = quoted_price;
          if (paymob_link !== undefined) updates.paymob_link = paymob_link;
          const { error } = await supabase.from('event_bookings').update(updates).eq('id', id);
          if (error) return res.status(500).json({ error: error.message });
          return res.status(200).json({ ok: true });
        }
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}