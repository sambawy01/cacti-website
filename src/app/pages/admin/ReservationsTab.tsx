import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import {
  fetchReservationsFromSupabase,
  updateReservationStatusInSupabase,
  getStoredPassword,
  SupabaseReservation,
} from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, Check, X, RefreshCw, UtensilsCrossed, Umbrella } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  confirmed: { label: 'Confirmed', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  completed: { label: 'Completed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  no_show: { label: 'No show', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

export function ReservationsTab() {
  const [reservations, setReservations] = useState<SupabaseReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchReservations = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); return; }
    try {
      const data = await fetchReservationsFromSupabase(pw);
      setReservations(data);
    } catch (err) {
      toast.error('Failed to load reservations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  async function changeStatus(res: SupabaseReservation, status: string) {
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyId(res.id);
    try {
      await updateReservationStatusInSupabase(pw, res.id, status);
      toast.success(`Reservation → ${STATUS_BADGE[status]?.label ?? status}`);
      await fetchReservations();
    } catch {
      toast.error('Failed to update reservation');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const pendingCount = reservations.filter(r => r.status === 'pending').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Reservations ({reservations.length})
          {pendingCount > 0 && (
            <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending</Badge>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchReservations(); }}>
          <RefreshCw className="size-3 mr-1" /> Refresh
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reservations.map(res => {
            const badge = STATUS_BADGE[res.status];
            return (
              <TableRow key={res.id} className={res.status === 'pending' ? 'bg-amber-50/50' : undefined}>
                <TableCell>
                  {res.type === 'beach' ? (
                    <Badge className="bg-cyan-50 text-cyan-700 border-cyan-200">
                      <Umbrella className="size-3 mr-1" /> Beach
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <UtensilsCrossed className="size-3 mr-1" /> Restaurant
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm font-medium">{formatDate(res.res_date)}</TableCell>
                <TableCell className="text-sm">{res.res_time}</TableCell>
                <TableCell className="font-medium text-sm">
                  {res.customer_name}
                  <div className="text-xs text-muted-foreground">{res.customer_phone}</div>
                </TableCell>
                <TableCell className="text-sm">
                  {res.type === 'beach' ? `${res.sunbeds} sunbeds` : `${res.party_size} guests`}
                </TableCell>
                <TableCell>
                  {badge
                    ? <Badge className={badge.className}>{badge.label}</Badge>
                    : <Badge variant="outline">{res.status}</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  {busyId === res.id ? (
                    <Loader2 className="size-4 animate-spin inline-block" />
                  ) : res.status === 'pending' ? (
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => changeStatus(res, 'confirmed')}>
                        <Check className="size-4 mr-1" />Confirm
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => changeStatus(res, 'declined')}>
                        <X className="size-4 mr-1" />Decline
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {reservations.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No reservations yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}