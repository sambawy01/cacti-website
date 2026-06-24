import React from 'react';
import { useCart } from '../context/CartContext';
import { Button } from './ui/button';
import { Minus, Plus, Trash2, ShoppingBag, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// WhatsApp number for orders — Cacti's contact
const WHATSAPP_NUMBER = '201000254242';

function buildWhatsAppMessage(items: { name: string; quantity: number; price: number }[], total: number): string {
  let msg = '*New Order — Cacti*\n\n';
  msg += '*Items:*\n';
  items.forEach((item, i) => {
    msg += `${i + 1}. ${item.name} x${item.quantity} — EGP ${item.price * item.quantity}\n`;
  });
  msg += `\n*Total: EGP ${total}*\n\n`;
  msg += '_Sent from cacti.restaurant_`;
  return msg;
}

export function CartDrawer() {
  const { items, removeItem, updateQuantity, clearCart, totalPrice, isCartOpen, toggleCart } = useCart();

  const handleWhatsAppOrder = () => {
    const message = buildWhatsAppMessage(items, totalPrice);
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
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
            className="fixed right-0 top-0 h-full w-full sm:max-w-md bg-white z-50 shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b flex items-center justify-between bg-[#f5f5f0]">
              <h2 className="font-bold text-xl flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#0a4d4d]" />
                Your Order
              </h2>
              <button onClick={toggleCart} className="p-2 hover:bg-black/5 rounded-full">
                <span className="sr-only">Close</span>
                ✕
              </button>
            </div>

            {/* Items */}
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
                        <p className="text-[#0a4d4d] font-bold text-sm">EGP {item.price}</p>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            disabled={item.quantity <= 1}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm disabled:opacity-50 text-gray-600 hover:text-[#0a4d4d]"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-[#0a4d4d]"
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

            {/* Checkout */}
            {items.length > 0 && (
              <div className="p-6 border-t bg-[#f5f5f0]">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-gray-600">Total</span>
                  <span className="font-bold text-2xl text-[#0a4d4d]">EGP {totalPrice}</span>
                </div>
                <Button
                  onClick={handleWhatsAppOrder}
                  className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-[#0a4d4d]/20 bg-[#0a4d4d] hover:bg-[#06b6d4] transition-all"
                >
                  <MessageCircle className="w-5 h-5 mr-2" />
                  Order via WhatsApp
                </Button>
                <p className="text-center text-xs text-gray-500 mt-4">
                  Your order details will be sent to our team on WhatsApp
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}