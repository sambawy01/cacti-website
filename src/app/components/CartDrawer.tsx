import React from 'react'
import { useCart } from '../context/CartContext';
import { Button } from './ui/button';
import { Minus, Plus, Trash2, ShoppingBag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { submitOrder } from '../../services/crmService';
import { getAvailability, placeOrderLive, slotLabel, Availability, SlotInfo } from '../../services/orderService';

// Local fallback when the availability service is unreachable: same slot
// generation the site used before capacity control (fail open).
function fallbackSlots(): SlotInfo[] {
  const now = new Date();
  const minTime = new Date(now.getTime() + 30 * 60000);
  const slots: SlotInfo[] = [];
  for (let h = 14; h <= 20; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 20 && m > 0) continue;
      const slot = new Date();
      slot.setHours(h, m, 0, 0);
      if (slot > minTime) {
        slots.push({ time: `${h}:${m === 0 ? '00' : '30'}`, status: 'open' });
      }
    }
  }
  return slots;
}

export function CartDrawer() {
  const { items, removeItem, updateQuantity, clearCart, totalPrice, isCartOpen, toggleCart } = useCart();
  const [paymentMethod, setPaymentMethod] = React.useState('Cash on Delivery');
  const [orderNotes, setOrderNotes] = React.useState('')
  const [address, setAddress] = React.useState('');
  const [customerName, setCustomerName] = React.useState(() => localStorage.getItem('bc_name') || '');
  const [customerPhone, setCustomerPhone] = React.useState(() => localStorage.getItem('bc_phone') || '');
  const [customerEmail, setCustomerEmail] = React.useState(() => localStorage.getItem('bc_email') || '');

  const [availability, setAvailability] = React.useState<Availability | null>(null);
  const [availLoading, setAvailLoading] = React.useState(false);
  // 'asap' or a 'HH:mm' slot time
  const [selectedSlot, setSelectedSlot] = React.useState<string>('asap');

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const applyAvailability = React.useCallback((a: Availability | null) => {
    setAvailability(a);
    if (!a) { setSelectedSlot('asap'); return; }
    if (a.paused) return;
    setSelectedSlot(prev => {
      if (prev === 'asap') return a.asap ? 'asap' : (a.slots[0]?.time ?? 'asap');
      return a.slots.some(s => s.time === prev) ? prev : (a.asap ?? a.slots[0]?.time ?? 'asap');
    });
  }, []);

  React.useEffect(() => {
    if (!isCartOpen) return;
    let cancelled = false;
    setAvailLoading(true);
    getAvailability()
      .then(a => { if (!cancelled) applyAvailability(a); })
      .finally(() => { if (!cancelled) setAvailLoading(false); });
    return () => { cancelled = true; };
  }, [isCartOpen, applyAvailability]);

  const slots = availability && !availability.paused ? availability.slots : null;
  const selectedSlotInfo = slots?.find(s => s.time === selectedSlot) ?? null;
  const noSlotsLeft = !!availability && !availability.paused && availability.slots.length === 0;
  const orderingPaused = !!availability?.paused;
  const checkoutBlocked = orderingPaused || noSlotsLeft;

  const handleCheckout = async () => {
    if (isSubmitting || checkoutBlocked) return;
    setIsSubmitting(true);

    try {
      // Require name and phone before checkout
      if (!customerName.trim() || !customerPhone.trim()) {
        alert('Please enter your name and phone number to place an order.');
        return;
      }

      // Remember customer details for next time
      localStorage.setItem('bc_name', customerName.trim());
      localStorage.setItem('bc_phone', customerPhone.trim());
      if (customerEmail.trim()) localStorage.setItem('bc_email', customerEmail.trim());
      else localStorage.removeItem('bc_email');

      const orderSummary = items.map(item =>
        `${item.quantity}x ${item.name} (${item.price * item.quantity} EGP)`
      ).join('\n');
      const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

      // Open the WhatsApp tab synchronously (popup blockers require this);
      // we point it at the right URL after the capacity check completes.
      const waWindow = window.open('', '_blank');
      try { waWindow?.document.write('<p style="font-family: sans-serif; padding: 24px;">Placing your order…</p>'); } catch {}
      const navigateTo = (url: string) => {
        if (waWindow) waWindow.location.href = url;
        else window.location.href = url;
      };
      const baseText = `Hi Bistro Cloud! I'd like to place an order:\n\n${orderSummary}\n\nTotal: ${totalPrice} EGP\nPayment Method: ${paymentMethod}`;
      const contactText = `${customerName ? '\nName: ' + customerName : ''}${customerPhone ? '\nPhone: ' + customerPhone : ''}${orderNotes ? '\nNotes: ' + orderNotes : ''}`;

      if (availability && !availability.paused) {
        // ── Capacity-checked flow ──
        const slotTime = selectedSlot === 'asap' ? availability.asap : selectedSlot;
        if (!slotTime) {
          waWindow?.close();
          toast.error('No delivery times are available right now.');
          return;
        }
        const expectedStatus = selectedSlot === 'asap'
          ? 'open'
          : (selectedSlotInfo?.status ?? 'open');

        let result;
        try {
          result = await placeOrderLive({
            name: customerName.trim(),
            phone: customerPhone.trim(),
            email: customerEmail.trim(),
            address: address || orderNotes,
            deliveryArea: 'El Gouna',
            orderTotal: totalPrice,
            orderSummary,
            itemCount,
            deliverySlot: slotTime,
            expectedStatus,
          });
        } catch {
          // Network error mid-submit: fail open to the legacy flow.
          const url = `https://wa.me/201221288804?text=${encodeURIComponent(
            `${baseText}\nDelivery Time: ${slotLabel(slotTime)}${contactText}\n\nPlease confirm delivery time.`)}`;
          const legacySave = () => submitOrder({
            name: customerName, phone: customerPhone, address: address || orderNotes,
            deliveryArea: 'El Gouna', orderTotal: totalPrice, orderSummary,
          }).catch(err => console.error('CRM save failed:', err));
          clearCart();
          toggleCart();
          if (waWindow) { navigateTo(url); legacySave(); }
          else { await legacySave(); navigateTo(url); }
          return;
        }

        if (!result.success) {
          waWindow?.close();
          if (result.code === 'busy_retry') {
            toast.error("We're receiving a lot of orders right now — please try again in a few seconds.");
            return;
          }
          if (result.code === 'daily_limit') {
            toast.error("We've reached today's order limit — please WhatsApp us directly.");
            return;
          }
          // slot_full / slot_unavailable: the slot filled or vanished — refresh the picker.
          if (result.availability) applyAvailability(result.availability);
          else getAvailability().then(applyAvailability);
          toast.error('That delivery time just filled up — please pick another one.');
          return;
        }

        const label = slotLabel(result.deliverySlot);
        const timeLine = result.status === 'pending_approval'
          ? `Requested Time: ${label} (busy slot — pending your confirmation)`
          : `Delivery Time: ${label} (confirmed)`;
        const url = `https://wa.me/201221288804?text=${encodeURIComponent(
          `${baseText}\n${timeLine}${contactText}\nTrack: https://bistro-cloud.com/track?token=${result.trackingToken}`)}`;
        clearCart();
        toggleCart();
        navigateTo(url);

        if (result.status === 'pending_approval') {
          toast.success(`Order received! ${label} is busy — we'll confirm your time shortly.`);
        } else {
          toast.success(`Order confirmed for ${label}!`);
        }
      } else {
        // Reached only when availability === null (service unreachable). The paused /
        // no-slots cases never get here — checkoutBlocked disables checkout entirely.
        // ── Legacy flow (availability service unreachable) ──
        const slotTimeLabel = selectedSlot === 'asap' ? 'As soon as possible' : slotLabel(selectedSlot);
        const url = `https://wa.me/201221288804?text=${encodeURIComponent(
          `${baseText}\nDelivery Time: ${slotTimeLabel}${contactText}\n\nPlease confirm delivery time.`)}`;
        const legacySave = () => submitOrder({
          name: customerName, phone: customerPhone, address: address || orderNotes,
          deliveryArea: 'El Gouna', orderTotal: totalPrice, orderSummary,
        }).catch(err => console.error('CRM save failed:', err));
        clearCart();
        toggleCart();
        if (waWindow) { navigateTo(url); legacySave(); }
        else { await legacySave(); navigateTo(url); }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isCartOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={toggleCart}
            className="fixed inset-0 bg-black z-50 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b flex items-center justify-between bg-[#F9F5F0]">
              <h2 className="font-montserrat font-bold text-xl flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#D94E28]" />
                Your Order
              </h2>
              <button onClick={toggleCart} className="p-2 hover:bg-black/5 rounded-full">
                <span className="sr-only">Close</span>
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
                    <ShoppingBag className="w-10 h-10" />
                  </div>
                  <p className="text-gray-500 font-medium">Your cart is empty</p>
                  <Button onClick={toggleCart} variant="outline">Browse Menu</Button>
                </div>
              ) : (
                items.map(item => (
                  <motion.div
                    layout
                    key={item.id}
                    className="flex gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm"
                  >
                    <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-lg bg-gray-100" />
                    <div className="flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-gray-800 text-sm">{item.name}</h3>
                        <p className="text-[#D94E28] font-bold text-sm">EGP {item.price}</p>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            disabled={item.quantity <= 1}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-gray-600 hover:text-[#D94E28]"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-[#D94E28]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {items.length > 0 && (
              <div className="p-6 border-t bg-[#F9F5F0] overflow-y-auto max-h-[60vh]">
                {/* Customer Info — show welcome if saved, form if not */}
                {customerName.trim() && customerPhone.trim() ? (
                  <div className="mb-6 p-4 bg-white rounded-xl border border-gray-100">
                    <p className="text-gray-800 text-sm">
                      Welcome back, <span className="font-bold text-[#D94E28]">{customerName.trim()}</span>!
                    </p>
                    <button
                      onClick={() => { setCustomerName(''); setCustomerPhone(''); localStorage.removeItem('bc_name'); localStorage.removeItem('bc_phone'); }}
                      className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                    >
                      Not you? Change details
                    </button>
                  </div>
                ) : (
                  <div className="mb-6">
                    <h3 className="font-bold text-gray-800 mb-3 text-sm">Your Details</h3>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Your Name"
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28]"
                      />
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Phone Number (e.g. +20 122 128 8804)"
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28]"
                      />
                    </div>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Email <span className="font-normal text-gray-500">(optional — for order updates)</span></h3>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28]"
                  />
                </div>

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Payment Method</h3>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28] appearance-none"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                  >
                    {['Cash on Delivery', 'Instapay', 'Credit/Debit Card'].map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">
                    Delivery Time (2:00 PM - 8:00 PM)
                    {availLoading && <span className="font-normal text-gray-400"> — checking availability…</span>}
                  </h3>
                  {orderingPaused ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Ordering is paused right now — please check back soon or{' '}
                      <a href="https://wa.me/201221288804" className="underline font-medium">WhatsApp us</a>.
                    </p>
                  ) : noSlotsLeft ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      Ordering for today has closed —{' '}
                      <a href="https://wa.me/201221288804" className="underline font-medium">WhatsApp us</a>{' '}
                      to arrange for tomorrow.
                    </p>
                  ) : (
                    <>
                      <select
                        value={selectedSlot}
                        onChange={(e) => setSelectedSlot(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28] appearance-none"
                        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                      >
                        {(availability ? availability.asap !== null : true) && (
                          <option value="asap">
                            {availability?.asap ? `As soon as possible — ${slotLabel(availability.asap)}` : 'As soon as possible'}
                          </option>
                        )}
                        {(slots ?? fallbackSlots()).map((s) => (
                          <option key={s.time} value={s.time}>
                            {slotLabel(s.time)}{s.status === 'busy' ? ' — Busy (needs confirmation)' : ''}
                          </option>
                        ))}
                      </select>
                      {selectedSlot === 'asap' && availability?.asap && (
                        <p className="text-xs text-gray-500 mt-2">
                          Your order will be scheduled for <span className="font-semibold">{slotLabel(availability.asap)}</span> — the earliest available time.
                        </p>
                      )}
                      {selectedSlotInfo?.status === 'busy' && (
                        <p className="text-xs text-amber-600 mt-2">
                          This time is busy — we'll review your order and confirm the time shortly after you place it.
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="mb-6">
                  <h3 className="font-bold text-gray-800 mb-3 text-sm">Notes / Address <span className="font-normal text-gray-500">(for first-time orders only)</span></h3>
                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Delivery address (first-time orders), allergies, special requests..."
                    rows={2}
                    className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D94E28]/20 focus:border-[#D94E28] resize-none"
                  />
                </div>
                <div className="flex justify-between items-center mb-6">
                  <span className="text-gray-600">Total</span>
                  <span className="font-montserrat font-bold text-2xl text-[#D94E28]">EGP {totalPrice}</span>
                </div>
                <Button
                  onClick={handleCheckout}
                  disabled={isSubmitting || checkoutBlocked}
                  className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-[#D94E28]/20 disabled:opacity-70"
                >
                  {isSubmitting ? 'Placing order...' : 'Checkout via WhatsApp'}
                </Button>
                <p className="text-center text-xs text-gray-500 mt-4">
                  Free delivery across all of El Gouna
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
