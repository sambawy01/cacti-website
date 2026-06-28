import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import {
  fetchOrdersFromSupabase,
  updateOrderStatusInSupabase,
  getStoredPassword,
  SupabaseOrder,
} from '@/services/adminService';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import { Loader2, Check, X, ChefHat, Bike, PackageCheck, Ban, RefreshCw, UtensilsCrossed } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending_approval: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  preparing: { label: 'Preparing', className: 'bg-purple-100 text-purple-800 border-purple-200' },
  out_for_delivery: { label: 'Out for delivery', className: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  delivered: { label: 'Delivered', className: 'bg-green-100 text-green-800 border-green-200' },
  served: { label: 'Served', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const STATUS_ORDER: Record<string, number> = {
  pending_approval: 0, confirmed: 1, preparing: 1, out_for_delivery: 1,
  delivered: 3, served: 3, declined: 4, cancelled: 4,
};

function slotLabel12h(slot: string | null): string {
  if (!slot || !/^\d{1,2}:\d{2}$/.test(slot)) return slot || '—';
  const [hStr, mStr] = slot.split(':');
  const h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

function timeAgo(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function OrdersTab({ l }: { l: AdminLang }) {
  const { tr } = l;
  const [orders, setOrders] = useState<SupabaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); return; }
    try {
      const data = await fetchOrdersFromSupabase(pw);
      data.sort((a, b) => {
        const oa = STATUS_ORDER[a.status] ?? 2;
        const ob = STATUS_ORDER[b.status] ?? 2;
        if (oa !== ob) return oa - ob;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setOrders(data);
    } catch (err) {
      toast.error('Failed to load orders from database');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  async function changeStatus(order: SupabaseOrder, status: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyId(order.id);
    try {
      await updateOrderStatusInSupabase(pw, order.id, status);
      toast.success(`Order → ${STATUS_BADGE[status]?.label ?? status}`);
      await fetchOrders();
    } catch {
      toast.error('Failed to update order');
    } finally {
      setBusyId(null);
    }
  }

  function rowActions(order: SupabaseOrder) {
    const busy = busyId === order.id;
    if (busy) return <Loader2 className="size-4 animate-spin inline-block" />;

    const isDineIn = order.mode === 'dine_in';

    switch (order.status) {
      case 'pending_approval':
        return (
          <div className="flex gap-1 justify-end">
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => changeStatus(order, 'confirmed')}>
              <Check className="size-4 mr-1" />Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => changeStatus(order, 'declined', 'Decline this order? The customer will be notified.')}>
              <X className="size-4 mr-1" />Decline
            </Button>
          </div>
        );
      case 'confirmed':
        return (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'preparing')}>
              <ChefHat className="size-4 mr-1" />Preparing
            </Button>
            <Button size="sm" variant="ghost" onClick={() => changeStatus(order, 'cancelled', 'Cancel this order?')}>
              <Ban className="size-4" />
            </Button>
          </div>
        );
      case 'preparing':
        return (
          <div className="flex gap-1 justify-end">
            {isDineIn ? (
              <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'served')}>
                <PackageCheck className="size-4 mr-1" />Served
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'out_for_delivery')}>
                <Bike className="size-4 mr-1" />Out for delivery
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => changeStatus(order, 'cancelled', 'Cancel this order?')}>
              <Ban className="size-4" />
            </Button>
          </div>
        );
      case 'out_for_delivery':
        return (
          <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'delivered')}>
            <PackageCheck className="size-4 mr-1" />Delivered
          </Button>
        );
      default:
        return null;
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const pendingCount = orders.filter(o => o.status === 'pending_approval').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Orders ({orders.length})
          {pendingCount > 0 && (
            <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending</Badge>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchOrders(); }}>
          <RefreshCw className="size-3 mr-1" /> Refresh
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map(order => {
            const badge = STATUS_BADGE[order.status];
            const itemCount = (order.items || []).reduce((s, it) => s + it.quantity, 0);
            const itemSummary = (order.items || []).map(it => `${it.quantity}x ${it.name}`).join(', ');
            return (
              <TableRow key={order.id} className={order.status === 'pending_approval' ? 'bg-amber-50/50' : undefined}>
                <TableCell>
                  {order.mode === 'dine_in' ? (
                    <Badge className="bg-[#0a4d4d]/10 text-[#0a4d4d] border-[#0a4d4d]/20">
                      <UtensilsCrossed className="size-3 mr-1" /> Dine-in
                    </Badge>
                  ) : (
                    <Badge variant="outline">Delivery</Badge>
                  )}
                </TableCell>
                <TableCell className="font-medium whitespace-nowrap text-sm">
                  {order.mode === 'dine_in' ? timeAgo(order.created_at) : slotLabel12h(order.delivery_slot)}
                  <div className="text-xs text-muted-foreground">{order.order_ref}</div>
                </TableCell>
                <TableCell className="font-medium text-sm">
                  {order.customer_name || '—'}
                  <div className="text-xs text-muted-foreground">{order.customer_phone || '—'}</div>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground" title={itemSummary}>
                  {itemCount} items
                  <div className="text-xs truncate" title={itemSummary}>{itemSummary}</div>
                </TableCell>
                <TableCell className="font-semibold text-sm">EGP {order.total}</TableCell>
                <TableCell>
                  {badge
                    ? <Badge className={badge.className}>{badge.label}</Badge>
                    : <Badge variant="outline">{order.status}</Badge>}
                </TableCell>
                <TableCell className="text-right">{rowActions(order)}</TableCell>
              </TableRow>
            );
          })}
          {orders.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No orders yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}