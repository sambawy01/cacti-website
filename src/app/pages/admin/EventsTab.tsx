import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import {
  fetchEventsFromSupabase,
  updateEventInSupabase,
  getStoredPassword,
  SupabaseEvent,
} from '@/services/adminService';
import { toast } from 'sonner';
import { Loader2, Check, X, RefreshCw, DollarSign, Link2 } from 'lucide-react';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800 border-green-200' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-800 border-red-200' },
  completed: { label: 'Completed', className: 'bg-blue-100 text-blue-800 border-blue-200' },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

export function EventsTab() {
  const [events, setEvents] = useState<SupabaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');
  const [editingLink, setEditingLink] = useState<string | null>(null);
  const [linkValue, setLinkValue] = useState('');

  const fetchEvents = useCallback(async () => {
    const pw = getStoredPassword();
    if (!pw) { setLoading(false); return; }
    try {
      const data = await fetchEventsFromSupabase(pw);
      setEvents(data);
    } catch (err) {
      toast.error('Failed to load event bookings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  async function changeStatus(evt: SupabaseEvent, status: string) {
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyId(evt.id);
    try {
      await updateEventInSupabase(pw, evt.id, { status });
      toast.success(`Event → ${STATUS_BADGE[status]?.label ?? status}`);
      await fetchEvents();
    } catch {
      toast.error('Failed to update event');
    } finally {
      setBusyId(null);
    }
  }

  async function savePrice(evt: SupabaseEvent) {
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyId(evt.id);
    try {
      await updateEventInSupabase(pw, evt.id, { quoted_price: parseInt(priceValue) || null });
      toast.success('Price updated');
      setEditingPrice(null);
      await fetchEvents();
    } catch {
      toast.error('Failed to save price');
    } finally {
      setBusyId(null);
    }
  }

  async function saveLink(evt: SupabaseEvent) {
    const pw = getStoredPassword();
    if (!pw) return;
    setBusyId(evt.id);
    try {
      await updateEventInSupabase(pw, evt.id, { paymob_link: linkValue || null });
      toast.success('Paymob link saved');
      setEditingLink(null);
      await fetchEvents();
    } catch {
      toast.error('Failed to save link');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const pendingCount = events.filter(e => e.status === 'pending').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Event Enquiries ({events.length})
          {pendingCount > 0 && (
            <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200">{pendingCount} pending</Badge>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchEvents(); }}>
          <RefreshCw className="size-3 mr-1" /> Refresh
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Party</TableHead>
            <TableHead>Internal (staff only)</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map(evt => {
            const badge = STATUS_BADGE[evt.status];
            return (
              <TableRow key={evt.id} className={evt.status === 'pending' ? 'bg-amber-50/50' : undefined}>
                <TableCell className="text-sm font-medium">{formatDate(evt.event_date)}</TableCell>
                <TableCell className="text-sm">{evt.event_type || '—'}</TableCell>
                <TableCell className="font-medium text-sm">
                  {evt.customer_name}
                  <div className="text-xs text-muted-foreground">{evt.customer_phone}</div>
                  <div className="text-xs text-muted-foreground">{evt.customer_email}</div>
                </TableCell>
                <TableCell className="text-sm">{evt.party_size ? `${evt.party_size} guests` : '—'}</TableCell>
                <TableCell className="text-sm">
                  {/* Quoted price — staff only */}
                  {editingPrice === evt.id ? (
                    <div className="flex items-center gap-1 mb-1">
                      <input
                        type="number"
                        value={priceValue}
                        onChange={e => setPriceValue(e.target.value)}
                        placeholder="EGP"
                        className="w-20 p-1 rounded border border-gray-200 text-xs"
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => savePrice(evt)}>
                        <Check className="size-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditingPrice(null)}>
                        <X className="size-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingPrice(evt.id); setPriceValue(evt.quoted_price?.toString() || ''); }}
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-[#0a4d4d]"
                    >
                      <DollarSign className="size-3" />
                      {evt.quoted_price ? `EGP ${evt.quoted_price}` : 'Set price'}
                    </button>
                  )}
                  {/* Paymob link — staff only */}
                  {editingLink === evt.id ? (
                    <div className="flex items-center gap-1 mt-1">
                      <input
                        type="text"
                        value={linkValue}
                        onChange={e => setLinkValue(e.target.value)}
                        placeholder="Paymob URL"
                        className="w-32 p-1 rounded border border-gray-200 text-xs"
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => saveLink(evt)}>
                        <Check className="size-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditingLink(null)}>
                        <X className="size-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingLink(evt.id); setLinkValue(evt.paymob_link || ''); }}
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-[#0a4d4d] mt-1"
                    >
                      <Link2 className="size-3" />
                      {evt.paymob_link ? 'Paymob link set' : 'Set Paymob link'}
                    </button>
                  )}
                  {evt.notes && (
                    <p className="text-xs text-gray-400 mt-1 max-w-xs truncate" title={evt.notes}>
                      📝 {evt.notes}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  {badge
                    ? <Badge className={badge.className}>{badge.label}</Badge>
                    : <Badge variant="outline">{evt.status}</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  {busyId === evt.id ? (
                    <Loader2 className="size-4 animate-spin inline-block" />
                  ) : evt.status === 'pending' ? (
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => changeStatus(evt, 'approved')}>
                        <Check className="size-4 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => changeStatus(evt, 'declined')}>
                        <X className="size-4 mr-1" />Decline
                      </Button>
                    </div>
                  ) : evt.status === 'approved' ? (
                    <Button size="sm" variant="outline" onClick={() => changeStatus(evt, 'completed')}>
                      Mark Completed
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {events.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No event enquiries yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}