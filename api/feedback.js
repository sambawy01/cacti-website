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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderRef, trackingToken, name, email, rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: 'Rating must be between 1 and 5' });
    }

    // Save to Supabase
    if (supabase) {
      const { error } = await supabase
        .from('feedback')
        .insert({
          order_ref: orderRef || null,
          tracking_token: trackingToken || null,
          customer_name: name || null,
          customer_email: email || null,
          rating: Math.round(rating),
          comment: comment || '',
        });

      if (error) {
        console.error('Feedback insert error:', error.message);
        return res.status(500).json({ ok: false, error: 'Could not save feedback' });
      }
    } else {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not set — feedback not saved to DB');
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Feedback API error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to submit feedback' });
  }
}