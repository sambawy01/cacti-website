import { createClient } from '@supabase/supabase-js';

// ── Public (anon) client — safe for frontend ─────────────────────────────
const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://mmjjphgzzhdifvkrokxz.supabase.co';

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'sb_publishable_zTlTthqL1VchTCAT7vQuCg_88C4SgdA';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// ── Types ─────────────────────────────────────────────────────────────────
export type OrderMode = 'delivery' | 'dine_in';
export type OrderStatus =
  | 'pending_approval'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'served'
  | 'declined'
  | 'cancelled';
export type ReservationType = 'beach' | 'restaurant';
export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'no_show';
export type PaymentMethod = 'cod' | 'card_on_delivery' | 'instapay' | 'paymob' | 'cash_on_site';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  section: string;
  dietary: string[];
  image_url: string;
  is_active: boolean;
  sort_order: number;
}

export interface OrderItemInput {
  name: string;
  price: number;
  quantity: number;
  section?: string;
}

export interface OrderInsert {
  order_ref: string;
  mode: OrderMode;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  delivery_address?: string;
  delivery_location?: string;
  delivery_date?: string;
  delivery_slot?: string;
  note?: string;
  table_id?: string;
  items: OrderItemInput[];
  subtotal: number;
  vat_amount: number;
  service_amount: number;
  total: number;
  payment_method?: PaymentMethod;
  tracking_token: string;
}

export interface ReservationInsert {
  type: ReservationType;
  status: ReservationStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  res_date: string;
  res_time: string;
  party_size?: number;
  sunbeds?: number;
  notes?: string;
}

export interface EventBookingInsert {
  status: 'pending';
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  event_type?: string;
  event_date?: string;
  party_size?: number;
  notes?: string;
}