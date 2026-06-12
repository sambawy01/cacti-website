import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, ChefHat, Bike, PackageCheck, Clock, XCircle } from 'lucide-react';
import { getOrderStatus, slotLabel, TrackedOrder } from '../../services/orderService';

const STEPS = [
  { key: 'confirmed', label: 'Confirmed', Icon: CheckCircle2 },
  { key: 'preparing', label: 'Being prepared', Icon: ChefHat },
  { key: 'out_for_delivery', label: 'Out for delivery', Icon: Bike },
  { key: 'delivered', label: 'Delivered', Icon: PackageCheck },
];

const POLL_MS = 20000;

export function TrackPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [order, setOrder] = React.useState<TrackedOrder | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'notfound'>('loading');

  React.useEffect(() => {
    if (!token) { setState('notfound'); return; }
    let cancelled = false;
    const load = async () => {
      const o = await getOrderStatus(token);
      if (cancelled) return;
      if (o) { setOrder(o); setState('ready'); }
      else setState(s => (s === 'loading' ? 'notfound' : s));
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#D94E28]" />
      </div>
    );
  }

  if (state === 'notfound' || !order) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
        <h1 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">Order not found</h1>
        <p className="text-gray-500 mb-6">This tracking link doesn't match any order.</p>
        <a href="https://wa.me/201221288804" className="bg-[#D94E28] text-white font-bold px-6 py-3 rounded-xl">
          Chat with us on WhatsApp
        </a>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex(s => s.key === order.status);
  const isPending = order.status === 'pending_approval';
  const isDead = order.status === 'declined' || order.status === 'cancelled';

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <h1 className="font-montserrat font-bold text-3xl text-gray-800 mb-1">
        {order.name ? `${order.name}'s order` : 'Your order'}
      </h1>
      {!isDead && (
        <p className="text-gray-500 mb-8">
          Scheduled for today at <span className="font-semibold text-gray-700">{order.deliverySlot ? slotLabel(order.deliverySlot) : '—'}</span>
        </p>
      )}

      {isPending && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
          <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            That time slot is busy — we're reviewing your order and will confirm your delivery time shortly. This page updates automatically.
          </p>
        </div>
      )}

      {isDead && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-8">
          <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-800">
            {order.status === 'declined'
              ? "We're sorry — we couldn't fit this order in. Check your email for available times, or WhatsApp us."
              : 'This order has been cancelled. WhatsApp us if that doesn\'t look right.'}
          </p>
        </div>
      )}

      {!isDead && (
        <ol className="space-y-0 mb-10">
          {STEPS.map((step, i) => {
            const done = stepIndex >= i;
            const current = stepIndex === i;
            return (
              <li key={step.key} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                    done ? 'bg-[#D94E28] border-[#D94E28] text-white' : 'bg-white border-gray-200 text-gray-300'
                  }`}>
                    <step.Icon className="w-5 h-5" />
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`w-0.5 h-8 ${stepIndex > i ? 'bg-[#D94E28]' : 'bg-gray-200'}`} />
                  )}
                </div>
                <div className="pt-2">
                  <p className={`font-semibold ${done ? 'text-gray-800' : 'text-gray-400'}`}>
                    {step.label}{current ? ' ●' : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="bg-[#F9F5F0] rounded-xl p-5">
        <h2 className="font-bold text-sm text-gray-800 mb-2">Order summary</h2>
        <p className="text-sm text-gray-600 whitespace-pre-line">{order.orderSummary || '—'}</p>
        {order.orderTotal ? (
          <p className="text-sm font-bold text-[#D94E28] mt-2">Total: {order.orderTotal} EGP</p>
        ) : null}
      </div>
    </div>
  );
}
