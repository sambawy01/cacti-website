import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Plus, Minus, ShoppingBag, ArrowLeft, Check, Loader2, Search, Phone, ChevronRight, CreditCard, Wallet, Banknote, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useMenuData } from '../data/useMenuData';
import { placeDineInOrder, DineInOrderResult } from '../../services/orderService';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────
interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

type FlowStep = 'table_loading' | 'table_error' | 'otp' | 'menu' | 'success';
type PaymentMethod = 'cash_on_site' | 'card' | 'instapay' | 'apple_pay';

const VAT_RATE = 0.14;
const SERVICE_RATE = 0.12;

// ── Order status timeline ──────────────────────────────────────────────────
const STATUS_STEPS = [
  { key: 'pending_approval', label: 'Order Placed', icon: '📋' },
  { key: 'confirmed', label: 'Confirmed', icon: '✅' },
  { key: 'preparing', label: 'Preparing', icon: '👨‍🍳' },
  { key: 'served', label: 'Served', icon: '🍽️' },
];

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================
export function DineInOrderPage() {
  const [searchParams] = useSearchParams();
  const tableParam = searchParams.get('table') || '';
  const { menuItems, loading } = useMenuData();

  const [step, setStep] = useState<FlowStep>('table_loading');
  const [tableId, setTableId] = useState(tableParam);
  const [tableLabel, setTableLabel] = useState('');
  const [tableZone, setTableZone] = useState('');

  // Guest info (set during OTP, used for order)
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [note, setNote] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash_on_site');
  const [paymobIframeUrl, setPaymobIframeUrl] = useState<string | null>(null);

  // Order
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<DineInOrderResult | null>(null);

  // ── Fetch table info from Supabase ──────────────────────────────────────
  useEffect(() => {
    if (!tableParam) {
      setStep('table_error');
      return;
    }
    supabase
      .from('tables')
      .select('id, label, zone, capacity')
      .eq('id', tableParam)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          supabase
            .from('tables')
            .select('id, label, zone, capacity')
            .eq('label', tableParam)
            .single()
            .then(({ data: data2, error: err2 }) => {
              if (err2 || !data2) {
                setStep('table_error');
                return;
              }
              setTableId(data2.id);
              setTableLabel(data2.label);
              setTableZone(data2.zone);
              setStep('otp');
            });
          return;
        }
        setTableId(data.id);
        setTableLabel(data.label);
        setTableZone(data.zone);
        setStep('otp');
      });
  }, [tableParam]);

  // ── Cart helpers ────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = Array.from(new Set(menuItems.map(i => i.category)));
    return ['All', ...cats];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      const matchesCat = activeCategory === 'All' || item.category === activeCategory;
      const matchesSearch = !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [menuItems, activeCategory, searchQuery]);

  const subtotal = cart.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const vatAmount = Math.round(subtotal * VAT_RATE);
  const serviceAmount = Math.round(subtotal * SERVICE_RATE);
  const grandTotal = subtotal + vatAmount + serviceAmount;

  function addToCart(item: typeof menuItems[0]) {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) {
        return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, quantity: 1, image: item.image }];
    });
    toast.success(`${item.name} added`);
  }

  function updateQty(id: string, delta: number) {
    setCart(prev => prev.map(c => {
      if (c.id === id) {
        const newQty = c.quantity + delta;
        if (newQty <= 0) return c;
        return { ...c, quantity: newQty };
      }
      return c;
    }));
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(c => c.id !== id));
  }

  // ── Handle order submission ─────────────────────────────────────────────
  async function handleOrder() {
    if (cart.length === 0 || !tableId) return;
    setSubmitting(true);

    let orderPaymentMethod = paymentMethod;

    // If Paymob payment selected, create payment intent first
    if (paymentMethod !== 'cash_on_site') {
      try {
        const tempOrderRef = `D${Date.now().toString(36).toUpperCase()}`;
        const intentRes = await fetch('/api/paymob-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: tempOrderRef,
            amount: grandTotal,
            method: paymentMethod,
            billing: {
              first_name: guestName,
              phone_number: guestPhone,
            },
            phone: guestPhone,
          }),
        }).then(r => r.json());

        if (intentRes.ok && intentRes.iframe_url) {
          if (intentRes.dev_mode) {
            toast.info('Dev mode: Payment skipped. Order will be placed as cash on site.');
            orderPaymentMethod = 'cash_on_site';
          } else {
            setPaymobIframeUrl(intentRes.iframe_url);
            setSubmitting(false);
            return;
          }
        } else {
          toast.error(intentRes.error || 'Payment initialization failed');
          setSubmitting(false);
          return;
        }
      } catch {
        toast.error('Payment setup failed. Try cash on site.');
        setSubmitting(false);
        return;
      }
    }

    // Place the order
    const result = await placeDineInOrder({
      tableId,
      items: cart.map(c => ({ name: c.name, quantity: c.quantity, price: c.price })),
      note: note.trim() || undefined,
      guestName: guestName.trim() || undefined,
      guestPhone: guestPhone.trim() || undefined,
      paymentMethod: orderPaymentMethod,
    });
    setSubmitting(false);
    if (result.ok) {
      setOrderResult(result);
      setCart([]);
      setStep('success');
    } else {
      toast.error(result.error || 'Failed to place order');
    }
  }

  // ── Handle Paymob iframe callback ───────────────────────────────────────
  async function handlePaymentComplete(success: boolean) {
    setPaymobIframeUrl(null);
    if (success) {
      toast.success('Payment successful! Placing your order...');
      const result = await placeDineInOrder({
        tableId,
        items: cart.map(c => ({ name: c.name, quantity: c.quantity, price: c.price })),
        note: note.trim() || undefined,
        guestName: guestName.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        paymentMethod,
      });
      setSubmitting(false);
      if (result.ok) {
        setOrderResult(result);
        setCart([]);
        setStep('success');
      } else {
        toast.error('Payment succeeded but order failed. Staff will assist.');
      }
    } else {
      setSubmitting(false);
      toast.error('Payment failed. Please try again or choose cash on site.');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const zoneEmoji = tableZone === 'bar' ? '🍸' : tableZone === 'daybed' ? '🏖️' : '🍽️';
  const zoneLabel = tableZone === 'bar' ? 'Bar' : tableZone === 'daybed' ? 'Daybed' : 'Dining';

  // ── Table loading ───────────────────────────────────────────────────────
  if (step === 'table_loading') {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#0a4d4d]" />
      </div>
    );
  }

  // ── Table error ─────────────────────────────────────────────────────────
  if (step === 'table_error') {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">Table Not Found</h1>
          <p className="text-gray-500 mb-6">No table specified in QR code. Please scan the QR code again or call a waiter.</p>
          <a href="https://cacti.restaurant" className="inline-flex items-center gap-2 text-[#0a4d4d] font-semibold">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </a>
        </div>
      </div>
    );
  }

  // ── OTP gate ────────────────────────────────────────────────────────────
  if (step === 'otp') {
    return (
      <OtpGate
        tableLabel={tableLabel}
        zoneEmoji={zoneEmoji}
        zoneLabel={zoneLabel}
        onVerified={(name, phone) => {
          setGuestName(name);
          setGuestPhone(phone);
          setStep('menu');
        }}
      />
    );
  }

  // ── Order success ───────────────────────────────────────────────────────
  if (step === 'success' && orderResult && orderResult.ok) {
    return (
      <OrderStatusTracker
        orderRef={orderResult.orderId || ''}
        tableLabel={orderResult.tableLabel || tableLabel}
        total={orderResult.total || grandTotal}
        trackingToken={orderResult.trackingToken || ''}
        onPlaceAnother={() => {
          setOrderResult(null);
          setStep('menu');
        }}
      />
    );
  }

  // ── Paymob iframe overlay ───────────────────────────────────────────────
  if (paymobIframeUrl) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        <div className="bg-[#0a0a0a] px-4 py-3 flex items-center justify-between">
          <h2 className="text-white font-semibold">Payment</h2>
          <button
            onClick={() => handlePaymentComplete(false)}
            className="text-white/60 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <iframe
          src={paymobIframeUrl}
          className="flex-1 w-full border-0"
          title="Paymob Payment"
          onLoad={(e) => {
            try {
              const url = (e.target as HTMLIFrameElement).contentWindow?.location?.href || '';
              if (url.includes('success')) {
                handlePaymentComplete(true);
              } else if (url.includes('error') || url.includes('cancel')) {
                handlePaymentComplete(false);
              }
            } catch {
              // Cross-origin — can't read URL, payment page is still loading
            }
          }}
        />
      </div>
    );
  }

  // ── Menu + Cart + Checkout ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-[#0a0a0a] sticky top-0 z-40 shadow-lg">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{zoneEmoji}</span>
            <div>
              <h1 className="font-montserrat font-bold text-lg text-white leading-tight">
                Table {tableLabel}
              </h1>
              <p className="text-white/50 text-xs">{zoneLabel} · Cacti</p>
            </div>
          </div>
          <button
            onClick={() => {
              const el = document.getElementById('dinein-cart');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="relative bg-[#0a4d4d] text-white rounded-full px-4 py-2 flex items-center gap-2 text-sm font-semibold"
          >
            <ShoppingBag className="w-4 h-4" />
            {cart.reduce((s, c) => s + c.quantity, 0)} items
            {subtotal > 0 && (
              <span className="ml-1 bg-white/20 rounded-full px-2 py-0.5 text-xs">
                EGP {subtotal}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Search + Category filter ──────────────────────────────────────── */}
      <div className="sticky top-[60px] z-30 bg-[#f5f5f0]/95 backdrop-blur-md border-b border-[#0a4d4d]/10">
        <div className="container mx-auto px-4 py-3">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search the menu..."
              className="w-full pl-10 pr-4 py-2.5 rounded-full border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-[#0a4d4d] text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-[#0a4d4d]/30'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Menu items grid ──────────────────────────────────────────────── */}
      <div className="container mx-auto px-4 py-6 max-w-3xl">
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-[#0a4d4d] mx-auto" />
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {filteredItems.map(item => {
              const inCart = cart.find(c => c.id === item.id);
              return (
                <motion.div
                  key={item.id}
                  layout
                  className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm flex"
                >
                  <img src={item.image} alt={item.name} className="w-24 h-24 object-cover bg-gray-100 shrink-0" />
                  <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                    <div>
                      <h3 className="font-bold text-gray-800 text-sm leading-tight mb-1">{item.name}</h3>
                      <p className="text-gray-400 text-xs line-clamp-2 mb-1">{item.description}</p>
                      <p className="text-[#0a4d4d] font-bold text-sm">EGP {item.price}</p>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {inCart ? (
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-1">
                          <button
                            onClick={() => updateQty(item.id, -1)}
                            disabled={inCart.quantity <= 1}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-gray-600"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{inCart.quantity}</span>
                          <button
                            onClick={() => updateQty(item.id, 1)}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => addToCart(item)}
                          className="bg-[#0a4d4d] hover:bg-[#067373] text-white rounded-lg"
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ── Cart + checkout section ────────────────────────────────────── */}
        <div id="dinein-cart" className="mt-8 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-4 flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#0a4d4d]" />
            Your Order
          </h2>

          {cart.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">Browse the menu above and add items to your order.</p>
          ) : (
            <>
              <div className="space-y-2 mb-4">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-gray-800">{item.quantity}x {item.name}</span>
                    </div>
                    <span className="font-semibold text-gray-600 ml-2">EGP {item.price * item.quantity}</span>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="ml-2 text-gray-300 hover:text-red-500 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="border-t border-gray-100 pt-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span><span>EGP {subtotal}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>VAT (14%)</span><span>EGP {vatAmount}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Service (12%)</span><span>EGP {serviceAmount}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-800 pt-1">
                  <span>Total</span><span className="text-[#0a4d4d]">EGP {grandTotal}</span>
                </div>
              </div>

              {/* Guest info display */}
              <div className="mt-4 bg-[#0a4d4d]/5 rounded-lg p-3 flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-[#0a4d4d]" />
                <span className="text-gray-600">{guestName}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-600">{guestPhone}</span>
              </div>

              {/* Notes */}
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Notes for the kitchen (allergies, special requests...)"
                rows={2}
                className="w-full mt-3 p-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] resize-none"
              />

              {/* ── Payment method selector ─────────────────────────────── */}
              <div className="mt-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  <PaymentOption
                    selected={paymentMethod === 'cash_on_site'}
                    onClick={() => setPaymentMethod('cash_on_site')}
                    icon={<Banknote className="w-5 h-5" />}
                    label="Cash on Site"
                  />
                  <PaymentOption
                    selected={paymentMethod === 'card'}
                    onClick={() => setPaymentMethod('card')}
                    icon={<CreditCard className="w-5 h-5" />}
                    label="Card"
                  />
                  <PaymentOption
                    selected={paymentMethod === 'instapay'}
                    onClick={() => setPaymentMethod('instapay')}
                    icon={<Wallet className="w-5 h-5" />}
                    label="InstaPay"
                  />
                  <PaymentOption
                    selected={paymentMethod === 'apple_pay'}
                    onClick={() => setPaymentMethod('apple_pay')}
                    icon={<CreditCard className="w-5 h-5" />}
                    label="Apple Pay"
                  />
                </div>
              </div>

              {/* Submit */}
              <Button
                onClick={handleOrder}
                disabled={submitting || cart.length === 0}
                className="w-full h-14 mt-4 text-lg font-bold rounded-xl shadow-lg shadow-[#0a4d4d]/20 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
                ) : (
                  `Order & Pay · EGP ${grandTotal}`
                )}
              </Button>
              <p className="text-center text-xs text-gray-400 mt-2">
                Table {tableLabel} · {paymentMethod === 'cash_on_site' ? 'Pay on site' : 'Pay online'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// OTP GATE COMPONENT
// ===========================================================================
function OtpGate({ tableLabel, zoneEmoji, zoneLabel, onVerified }: {
  tableLabel: string;
  zoneEmoji: string;
  zoneLabel: string;
  onVerified: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+20');
  const [disclaimer, setDisclaimer] = useState(false);
  const [otpStep, setOtpStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [devMode, setDevMode] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  async function sendCode() {
    setError('');
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (!phone.trim() || phone.length < 8) { setError('Please enter a valid phone number'); return; }
    if (!disclaimer) { setError('Please accept the terms to continue'); return; }

    setSending(true);
    try {
      const res = await fetch('/api/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      }).then(r => r.json());

      if (res.ok) {
        setOtpStep('code');
        setResendCooldown(30);
        if (res.dev_mode) {
          setDevMode(true);
          toast.info('Dev mode: Enter any 4-6 digit code');
        }
      } else {
        setError(res.error || 'Failed to send code');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSending(false);
  }

  async function verifyCode() {
    setError('');
    if (!code.trim() || !/^\d{4,6}$/.test(code)) {
      setError('Enter a 4-6 digit code');
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch('/api/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      }).then(r => r.json());

      if (res.ok && res.verified) {
        toast.success('Phone verified!');
        onVerified(name.trim(), phone.trim());
      } else {
        setError(res.error || 'Invalid code. Try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setVerifying(false);
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">{zoneEmoji}</div>
          <h1 className="font-montserrat font-bold text-2xl text-gray-800">Table {tableLabel}</h1>
          <p className="text-gray-500 text-sm">{zoneLabel} · Cacti</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          {otpStep === 'phone' ? (
            <>
              <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-1">Welcome to Cacti</h2>
              <p className="text-gray-500 text-sm mb-6">Enter your details to start ordering.</p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+201XXXXXXXXX"
                  className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                />
                <p className="text-xs text-gray-400 mt-1">We'll send a verification code via SMS</p>
              </div>

              <div className="mb-6">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disclaimer}
                    onChange={e => setDisclaimer(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-gray-300 text-[#0a4d4d] focus:ring-[#0a4d4d]/20"
                  />
                  <span className="text-xs text-gray-600">
                    I agree to Cacti's ordering terms and confirm that the information provided is accurate.
                  </span>
                </label>
              </div>

              {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

              <Button
                onClick={sendCode}
                disabled={sending}
                className="w-full h-12 font-semibold rounded-xl"
              >
                {sending ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending code...</>
                ) : (
                  <>Send Verification Code <ChevronRight className="w-4 h-4 ml-1" /></>
                )}
              </Button>
            </>
          ) : (
            <>
              <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-1">Enter Verification Code</h2>
              <p className="text-gray-500 text-sm mb-6">
                We sent a code to <span className="font-semibold">{phone}</span>
              </p>

              {devMode && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  Dev mode active — enter any 4-6 digit code to continue.
                </div>
              )}

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full p-4 text-center text-2xl font-bold tracking-[0.5em] rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                autoFocus
              />

              {error && <p className="text-red-500 text-sm mt-4 text-center">{error}</p>}

              <Button
                onClick={verifyCode}
                disabled={verifying || code.length < 4}
                className="w-full h-12 mt-4 font-semibold rounded-xl"
              >
                {verifying ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Verifying...</>
                ) : (
                  'Verify & Continue'
                )}
              </Button>

              <div className="flex items-center justify-between mt-4 text-sm">
                <button
                  onClick={() => { setOtpStep('phone'); setCode(''); setError(''); }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Change number
                </button>
                <button
                  onClick={sendCode}
                  disabled={resendCooldown > 0 || sending}
                  className="text-[#0a4d4d] font-semibold disabled:opacity-50"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          By ordering, you agree to our terms of service.
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// PAYMENT OPTION BUTTON
// ===========================================================================
function PaymentOption({ selected, onClick, icon, label }: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${
        selected
          ? 'border-[#0a4d4d] bg-[#0a4d4d]/5'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <span className={selected ? 'text-[#0a4d4d]' : 'text-gray-400'}>{icon}</span>
      <span className={`text-sm font-medium ${selected ? 'text-[#0a4d4d]' : 'text-gray-600'}`}>{label}</span>
      {selected && <Check className="w-4 h-4 text-[#0a4d4d] ml-auto" />}
    </button>
  );
}

// ===========================================================================
// ORDER STATUS TRACKER (Real-time via polling + Supabase Realtime)
// ===========================================================================
function OrderStatusTracker({ orderRef, tableLabel, total, trackingToken, onPlaceAnother }: {
  orderRef: string;
  tableLabel: string;
  total: number;
  trackingToken: string;
  onPlaceAnother: () => void;
}) {
  const [currentStatus, setCurrentStatus] = useState<string>('pending_approval');
  const [paymobPaid, setPaymobPaid] = useState(false);

  useEffect(() => {
    if (!trackingToken) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/track?token=${encodeURIComponent(trackingToken)}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.status) setCurrentStatus(data.status);
          if (data?.paymobPaid) setPaymobPaid(true);
        }
      } catch { /* ignore */ }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [trackingToken]);

  const currentStepIndex = STATUS_STEPS.findIndex(s => s.key === currentStatus);

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="font-montserrat font-bold text-3xl text-gray-800 mb-2">Order Sent!</h1>
          <p className="text-gray-500 mb-1">Your order has been sent to the kitchen.</p>
          <p className="text-[#0a4d4d] font-semibold">Table {tableLabel}</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-500">Order Ref</span>
            <span className="font-mono font-semibold">{orderRef}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-500">Total (incl. VAT + service)</span>
            <span className="font-bold text-[#0a4d4d]">EGP {total}</span>
          </div>
          {paymobPaid && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Payment</span>
              <span className="font-semibold text-green-600">Paid online</span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-montserrat font-bold text-lg text-gray-800 mb-4">Order Status</h3>
          <div className="space-y-1">
            {STATUS_STEPS.map((step, index) => {
              const isDone = index <= currentStepIndex;
              const isCurrent = index === currentStepIndex;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${
                      isDone ? 'bg-[#0a4d4d] text-white' : 'bg-gray-100 text-gray-400'
                    } ${isCurrent ? 'ring-4 ring-[#0a4d4d]/20' : ''}`}>
                      {isDone ? <Check className="w-4 h-4" /> : step.icon}
                    </div>
                    {index < STATUS_STEPS.length - 1 && (
                      <div className={`w-0.5 h-8 ${index < currentStepIndex ? 'bg-[#0a4d4d]' : 'bg-gray-200'}`} />
                    )}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isDone ? 'text-gray-800' : 'text-gray-400'}`}>
                      {step.label}
                    </p>
                    {isCurrent && (
                      <p className="text-xs text-[#0a4d4d] animate-pulse">In progress...</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          onClick={onPlaceAnother}
          className="w-full h-14 text-lg font-bold rounded-xl"
        >
          Place Another Order
        </Button>
      </div>
    </div>
  );
}