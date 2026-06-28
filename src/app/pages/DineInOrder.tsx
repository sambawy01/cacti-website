import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Minus, ShoppingBag, UtensilsCrossed, ArrowLeft, Check, Loader2, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useMenuData } from '../data/useMenuData';
import { placeDineInOrder, DineInOrderResult } from '../../services/orderService';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

const VAT_RATE = 0.14;
const SERVICE_RATE = 0.12;

export function DineInOrderPage() {
  const [searchParams] = useSearchParams();
  const tableParam = searchParams.get('table') || '';
  const { menuItems, loading } = useMenuData();

  const [tableId, setTableId] = useState(tableParam);
  const [tableLabel, setTableLabel] = useState('');
  const [tableZone, setTableZone] = useState('');
  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState('');

  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<DineInOrderResult | null>(null);

  // ── Fetch table info from Supabase ──────────────────────────────────────
  useEffect(() => {
    if (!tableId) { setTableLoading(false); setTableError('No table specified in QR code.'); return; }
    setTableLoading(true);
    supabase
      .from('tables')
      .select('label, zone, capacity')
      .eq('id', tableId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          // Try by label as fallback
          supabase
            .from('tables')
            .select('id, label, zone, capacity')
            .eq('label', tableId)
            .single()
            .then(({ data: data2, error: err2 }) => {
              if (err2 || !data2) {
                setTableError('Table not found. Please scan the QR code again or call a waiter.');
                setTableLoading(false);
                return;
              }
              setTableId(data2.id);
              setTableLabel(data2.label);
              setTableZone(data2.zone);
              setTableLoading(false);
            });
          return;
        }
        setTableLabel(data.label);
        setTableZone(data.zone);
        setTableLoading(false);
      });
  }, [tableId]);

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
        if (newQty <= 0) return c; // don't go below 1, use remove
        return { ...c, quantity: newQty };
      }
      return c;
    }));
  }

  function removeFromCart(id: string) {
    setCart(prev => prev.filter(c => c.id !== id));
  }

  async function handleOrder() {
    if (cart.length === 0) return;
    if (!tableId) return;
    setSubmitting(true);
    const result = await placeDineInOrder({
      tableId,
      items: cart.map(c => ({ name: c.name, quantity: c.quantity, price: c.price })),
      note: note.trim() || undefined,
      guestName: guestName.trim() || undefined,
      guestPhone: guestPhone.trim() || undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      setOrderResult(result);
      setCart([]);
    } else {
      toast.error(result.error || 'Failed to place order');
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────
  if (tableLoading) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#0a4d4d]" />
      </div>
    );
  }

  // ── Table error ────────────────────────────────────────────────────────
  if (tableError) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">Table Not Found</h1>
          <p className="text-gray-500 mb-6">{tableError}</p>
          <a href="https://cacti.restaurant" className="inline-flex items-center gap-2 text-[#0a4d4d] font-semibold">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </a>
        </div>
      </div>
    );
  }

  // ── Order success ──────────────────────────────────────────────────────
  if (orderResult && orderResult.ok) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="font-montserrat font-bold text-3xl text-gray-800 mb-2">Order Sent!</h1>
          <p className="text-gray-500 mb-1">Your order has been sent to the kitchen.</p>
          <p className="text-[#0a4d4d] font-semibold mb-6">Table {orderResult.tableLabel}</p>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6 text-left">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-500">Order Ref</span>
              <span className="font-mono font-semibold">{orderResult.orderId}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-500">Total (incl. VAT + service)</span>
              <span className="font-bold text-[#0a4d4d]">EGP {orderResult.total}</span>
            </div>
          </div>
          <Button
            onClick={() => setOrderResult(null)}
            className="w-full h-14 text-lg font-bold rounded-xl"
          >
            Place Another Order
          </Button>
        </div>
      </div>
    );
  }

  const zoneEmoji = tableZone === 'bar' ? '🍸' : tableZone === 'daybed' ? '🏖️' : '🍽️';
  const zoneLabel = tableZone === 'bar' ? 'Bar' : tableZone === 'daybed' ? 'Daybed' : 'Dining';

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
          {/* Cart badge */}
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

              {/* Optional guest info */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder="Your name (optional)"
                  className="p-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                />
                <input
                  type="tel"
                  value={guestPhone}
                  onChange={e => setGuestPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="p-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                />
              </div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Notes for the kitchen (allergies, special requests...)"
                rows={2}
                className="w-full mt-2 p-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] resize-none"
              />

              <Button
                onClick={handleOrder}
                disabled={submitting || cart.length === 0}
                className="w-full h-14 mt-4 text-lg font-bold rounded-xl shadow-lg shadow-[#0a4d4d]/20 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending...</>
                ) : (
                  `Send Order to Kitchen · EGP ${grandTotal}`
                )}
              </Button>
              <p className="text-center text-xs text-gray-400 mt-2">
                Pay on site · Table {tableLabel}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}