import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { getCRMOrders, setOrderStatus, getStoredPassword, CRMOrder, OrderStatus } from '@/services/adminService';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import { Loader2, Check, X, ChefHat, Bike, PackageCheck, Ban } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending_approval: { label: 'Pending approval', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  preparing: { label: 'Being prepared', className: 'bg-purple-100 text-purple-800 border-purple-200' },
  out_for_delivery: { label: 'Out for delivery', className: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  delivered: { label: 'Delivered', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  New: { label: 'Legacy', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

// Sort: pending first, then active statuses by slot, then finished rows.
const STATUS_ORDER: Record<string, number> = {
  pending_approval: 0, confirmed: 1, preparing: 1, out_for_delivery: 1,
  New: 2, delivered: 3, declined: 4, cancelled: 4,
};

function slotLabel12h(slot: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(slot)) return slot || '—';
  const [hStr, mStr] = slot.split(':');
  const h = Number(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mStr} ${ampm}`;
}

export function OrdersTab({ l }: { l: AdminLang }) {
  const { tr } = l;
  const [orders, setOrders] = useState<CRMOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRow, setBusyRow] = useState<number | null>(null);

  const fetchOrders = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); return; }
    try {
      const data = await getCRMOrders(pw);
      data.sort((a, b) => {
        const oa = STATUS_ORDER[a.status] ?? 2;
        const ob = STATUS_ORDER[b.status] ?? 2;
        if (oa !== ob) return oa - ob;
        // slots are zero-padded HH:mm; lexicographic = chronological
        return String(a.delivery_slot).localeCompare(String(b.delivery_slot));
      });
      setOrders(data);
    } catch (err) {
      toast.error(tr('failed_load_orders'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  async function changeStatus(order: CRMOrder, status: OrderStatus, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyRow(order._rowIndex);
    try {
      await setOrderStatus(pw, order._rowIndex, status, String(order.id));
      toast.success(`Order → ${STATUS_BADGE[status]?.label ?? status}`);
      await fetchOrders();
    } catch {
      toast.error('Failed to update order');
    } finally {
      setBusyRow(null);
    }
  }

  function rowActions(order: CRMOrder) {
    const busy = busyRow === order._rowIndex;
    if (busy) return <Loader2 className="size-4 animate-spin inline-block" />;
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
            <Button size="sm" variant="ghost" onClick={() => changeStatus(order, 'cancelled', 'Cancel this order? Its slot capacity will be freed.')}>
              <Ban className="size-4" />
            </Button>
          </div>
        );
      case 'preparing':
        return (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="outline" onClick={() => changeStatus(order, 'out_for_delivery')}>
              <Bike className="size-4 mr-1" />Out for delivery
            </Button>
            <Button size="sm" variant="ghost" onClick={() => changeStatus(order, 'cancelled', 'Cancel this order? Its slot capacity will be freed.')}>
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
            <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending approval</Badge>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchOrders(); }}>Refresh</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Slot</TableHead>
            <TableHead>{tr('name')}</TableHead>
            <TableHead>{tr('contact')}</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>{tr('details')}</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">{tr('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map(order => {
            const badge = STATUS_BADGE[order.status];
            return (
              <TableRow key={order._rowIndex} className={order.status === 'pending_approval' ? 'bg-amber-50/50' : undefined}>
                <TableCell className="font-medium whitespace-nowrap">
                  {slotLabel12h(String(order.delivery_slot))}
                  {order.delivery_date ? <div className="text-xs text-muted-foreground">{String(order.delivery_date)}</div> : null}
                </TableCell>
                <TableCell className="font-medium">{order.name || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{order.phone || order.email || '—'}</TableCell>
                <TableCell>{order.item_count || '—'}</TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground" title={String(order.order_summary)}>
                  {order.order_summary || '—'}
                  {order.order_total ? <span className="block text-xs font-medium text-foreground">{order.order_total} EGP</span> : null}
                </TableCell>
                <TableCell>
                  {badge
                    ? <Badge className={badge.className}>{badge.label}</Badge>
                    : <Badge variant="outline">{order.status || '—'}</Badge>}
                </TableCell>
                <TableCell className="text-right">{rowActions(order)}</TableCell>
              </TableRow>
            );
          })}
          {orders.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{tr('no_orders')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
