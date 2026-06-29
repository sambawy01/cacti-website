const ADMIN_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzN-s2iKeyjIC_k-wyNzj6QHOO5eoW14EqWo7fC4kYzYzqyMOygZpCDPpyqPVxhFA/exec';
import { API_BASE } from '../lib/apiConfig';
const STORAGE_KEY = 'bc-admin-pw';
const ROLE_KEY = 'bc-admin-role';

export type Role = 'admin' | 'chef' | 'accounting';

export interface AdminItem {
  _rowIndex: number;
  id: number | string;
  name: string;
  description: string;
  price: number | string;
  category: string;
  image: string;
  dietary: string;
  status: string;
  hidden?: string;
}

export interface OrderItem {
  _rowIndex: number;
  [key: string]: string | number;
}

export function getStoredPassword(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredPassword(pw: string) {
  localStorage.setItem(STORAGE_KEY, pw);
}

export function clearStoredPassword() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getStoredRole(): Role | null {
  return localStorage.getItem(ROLE_KEY) as Role | null;
}

export function setStoredRole(role: Role) {
  localStorage.setItem(ROLE_KEY, role);
}

export function clearStoredRole() {
  localStorage.removeItem(ROLE_KEY);
}

/**
 * All requests use GET to avoid the Google Apps Script 302 redirect problem.
 * POST requests lose their body during the 302 redirect from script.google.com
 * to script.googleusercontent.com. GET params survive the redirect.
 */
async function apiGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${ADMIN_ENDPOINT}?${qs}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function verifyPassword(password: string): Promise<{ valid: boolean; role?: Role }> {
  try {
    const res = await apiGet<{ success: boolean; role?: Role }>({
      action: 'verify',
      password,
    });
    if (res.success && res.role) {
      return { valid: true, role: res.role };
    }
    return { valid: res.success === true };
  } catch {
    return { valid: false };
  }
}

export async function getMenuItems(password: string): Promise<AdminItem[]> {
  const res = await apiGet<{ success: boolean; items?: AdminItem[]; error?: string }>({
    action: 'getMenu',
    password,
  });
  if (!res.success) throw new Error(res.error || 'Failed to fetch menu');
  return res.items || [];
}

export async function getPantryItems(password: string): Promise<AdminItem[]> {
  const res = await apiGet<{ success: boolean; items?: AdminItem[]; error?: string }>({
    action: 'getPantry',
    password,
  });
  if (!res.success) throw new Error(res.error || 'Failed to fetch pantry');
  return res.items || [];
}

export async function addPantryItem(password: string, item: Record<string, string>): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'addPantryItem',
    password,
    item: JSON.stringify(item),
  });
  if (!res.success) throw new Error(res.error || 'Failed to add pantry item');
}

export async function editPantryItem(password: string, rowIndex: number, item: Record<string, string>): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'editPantryItem',
    password,
    rowIndex: String(rowIndex),
    item: JSON.stringify(item),
  });
  if (!res.success) throw new Error(res.error || 'Failed to update pantry item');
}

export async function deletePantryItem(password: string, rowIndex: number): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'deletePantryItem',
    password,
    rowIndex: String(rowIndex),
  });
  if (!res.success) throw new Error(res.error || 'Failed to delete pantry item');
}

export async function togglePantryVisibility(password: string, rowIndex: number, newStatus: string): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'togglePantryVisibility',
    password,
    rowIndex: String(rowIndex),
    status: newStatus,
  });
  if (!res.success) throw new Error(res.error || 'Failed to toggle visibility');
}

export async function getOrders(password: string): Promise<OrderItem[]> {
  const res = await apiGet<{ success: boolean; orders?: OrderItem[]; error?: string }>({
    action: 'getOrders',
    password,
  });
  if (!res.success) throw new Error(res.error || 'Failed to fetch orders');
  return res.orders || [];
}

export async function addMenuItem(password: string, item: Record<string, string>): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'addItem',
    password,
    item: JSON.stringify(item),
  });
  if (!res.success) throw new Error(res.error || 'Failed to add item');
}

export async function editMenuItem(password: string, rowIndex: number, item: Record<string, string>): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'editItem',
    password,
    rowIndex: String(rowIndex),
    item: JSON.stringify(item),
  });
  if (!res.success) throw new Error(res.error || 'Failed to update item');
}

export async function deleteMenuItem(password: string, rowIndex: number): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'deleteItem',
    password,
    rowIndex: String(rowIndex),
  });
  if (!res.success) throw new Error(res.error || 'Failed to delete item');
}

export async function toggleItemVisibility(password: string, rowIndex: number, newStatus: string): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'toggleVisibility',
    password,
    rowIndex: String(rowIndex),
    status: newStatus,
  });
  if (!res.success) throw new Error(res.error || 'Failed to toggle visibility');
}

export async function archiveOrder(password: string, rowIndex: number): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'archiveOrder',
    password,
    rowIndex: String(rowIndex),
  });
  if (!res.success) throw new Error(res.error || 'Failed to archive order');
}

// ── CRM Orders (capacity workflow) ──

export type OrderStatus =
  | 'New' // legacy rows
  | 'pending_approval'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'declined'
  | 'cancelled';

export interface CRMOrder {
  _rowIndex: number;
  id: number | string;
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  delivery_area: string;
  address: string;
  order_total: number | string;
  order_summary: string;
  item_count: number | string;
  delivery_date: string;
  delivery_slot: string;
  tracking_token: string;
  status: string;
  notes: string;
}

export async function getCRMOrders(password: string): Promise<CRMOrder[]> {
  const res = await apiGet<{ success: boolean; items?: CRMOrder[]; error?: string }>({
    action: 'getCRMOrders',
    password,
  });
  if (!res.success) throw new Error(res.error || 'Failed to fetch orders');
  return res.items || [];
}

export async function setOrderStatus(password: string, rowIndex: number, status: OrderStatus, orderId: string): Promise<void> {
  const res = await apiGet<{ success: boolean; error?: string }>({
    action: 'setOrderStatus',
    password,
    rowIndex: String(rowIndex),
    status,
    orderId: String(orderId),
  });
  if (!res.success) throw new Error(res.error || 'Failed to update order status');
}

// ── Supabase-backed admin operations ──────────────────────────────────────
export interface SupabaseOrder {
  id: string;
  order_ref: string;
  mode: 'delivery' | 'dine_in';
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  delivery_address: string | null;
  delivery_slot: string | null;
  table_id: string | null;
  items: { name: string; price: number; quantity: number }[];
  subtotal: number;
  vat_amount: number;
  service_amount: number;
  total: number;
  payment_method: string;
  tracking_token: string;
  note: string | null;
  created_at: string;
}

export interface SupabaseReservation {
  id: string;
  type: 'beach' | 'restaurant';
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  res_date: string;
  res_time: string;
  party_size: number;
  sunbeds: number;
  notes: string;
  created_at: string;
}

export interface SupabaseEvent {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  event_type: string | null;
  event_date: string | null;
  party_size: number | null;
  notes: string;
  quoted_price: number | null;
  paymob_link: string | null;
  created_at: string;
}

async function adminFetch<T>(password: string, action: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api/admin?action=${action}`, {
    headers: { Authorization: `Bearer ${password}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data as T;
}

async function adminUpdate(password: string, action: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin?action=${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${password}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `HTTP ${res.status}`);
  }
}

export async function fetchOrdersFromSupabase(password: string): Promise<SupabaseOrder[]> {
  return adminFetch<SupabaseOrder[]>(password, 'orders');
}

export async function updateOrderStatusInSupabase(password: string, orderId: string, status: string): Promise<void> {
  return adminUpdate(password, 'update_order', { id: orderId, status });
}

export async function fetchReservationsFromSupabase(password: string): Promise<SupabaseReservation[]> {
  return adminFetch<SupabaseReservation[]>(password, 'reservations');
}

export async function updateReservationStatusInSupabase(password: string, id: string, status: string): Promise<void> {
  return adminUpdate(password, 'update_reservation', { id, status });
}

export async function fetchEventsFromSupabase(password: string): Promise<SupabaseEvent[]> {
  return adminFetch<SupabaseEvent[]>(password, 'events');
}

export async function updateEventInSupabase(password: string, id: string, updates: { status?: string; quoted_price?: number; paymob_link?: string }): Promise<void> {
  return adminUpdate(password, 'update_event', { id, ...updates });
}
