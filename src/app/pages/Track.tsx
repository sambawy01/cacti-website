import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Check, Clock, ChefHat, Bike, PackageCheck, X, Loader2, ArrowLeft } from 'lucide-react';
import { getOrderStatus, slotLabel, TrackedOrder } from '../../services/orderService';

const STATUS_STEPS = [
  { key: 'pending_approval', label: 'Order Received', icon: Clock },
  { key: 'confirmed', label: 'Confirmed', icon: Check },
  { key: 'preparing', label: 'Preparing', icon: ChefHat },
  { key: 'out_for_delivery', label: 'Out for Delivery', icon: Bike },
  { key: 'delivered', label: 'Delivered', icon: PackageCheck },
];

const STEP_ORDER = ['pending_approval', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const DECLINED_STATUSES = ['declined', 'cancelled'];

export function TrackPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    getOrderStatus(token)
      .then(data => {
        if (!data) { setNotFound(true); setOrder(null); }
        else { setOrder(data); setNotFound(false); }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (!order || DECLINED_STATUSES.includes(order.status)) return;
    const interval = setInterval(() => {
      getOrderStatus(token).then(data => { if (data) setOrder(data); });
    }, 15000);
    return () => clearInterval(interval);
  }, [token, order]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#0a4d4d]" />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-200 flex items-center justify-center">
            <X className="w-8 h-8 text-gray-400" />
          </div>
          <h1 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">Order Not Found</h1>
          <p className="text-gray-500 mb-6">
            We couldn't find an order with this tracking link. It may have expired or the link is incomplete.
          </p>
          <Link to="/menu" className="inline-flex items-center gap-2 text-[#0a4d4d] font-semibold hover:underline">
            <ArrowLeft className="w-4 h-4" /> Back to Menu
          </Link>
        </div>
      </div>
    );
  }

  const isDeclined = DECLINED_STATUSES.includes(order.status);
  const currentStepIndex = STEP_ORDER.indexOf(order.status);

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* Header */}
      <div className="bg-[#0a0a0a] py-12">
        <div className="container mx-auto px-4 max-w-2xl text-center">
          <h1 className="font-serif text-3xl font-bold text-white mb-2">Track Your Order</h1>
          <p className="text-white/60 text-sm">
            {order.name} · {order.deliveryDate}
            {order.deliverySlot ? ` · ${slotLabel(order.deliverySlot)}` : ''}
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-2xl py-8">
        {/* Status timeline */}
        {!isDeclined ? (
          <div className="mb-8">
            <div className="flex items-center justify-between relative">
              {/* Progress line background */}
              <div className="absolute left-0 right-0 top-5 h-0.5 bg-gray-200" />
              {/* Progress line fill */}
              <div
                className="absolute left-0 top-5 h-0.5 bg-[#0a4d4d] transition-all duration-500"
                style={{ width: `${(currentStepIndex / (STATUS_STEPS.length - 1)) * 100}%` }}
              />
              {STATUS_STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isDone = idx <= currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                return (
                  <div key={step.key} className="relative z-10 flex flex-col items-center" style={{ width: '64px' }}>
                    <motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                        isDone
                          ? 'bg-[#0a4d4d] border-[#0a4d4d] text-white'
                          : 'bg-white border-gray-200 text-gray-400'
                      } ${isCurrent ? 'ring-4 ring-[#0a4d4d]/20' : ''}`}
                    >
                      <Icon className="w-5 h-5" />
                    </motion.div>
                    <span className={`text-xs mt-2 text-center font-medium ${isDone ? 'text-[#0a4d4d]' : 'text-gray-400'}`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mb-8 p-6 rounded-2xl bg-red-50 border border-red-200 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
              <X className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="font-bold text-lg text-red-800 mb-1">
              {order.status === 'declined' ? 'Order Declined' : 'Order Cancelled'}
            </h2>
            <p className="text-red-600 text-sm">
              {order.status === 'declined'
                ? "We're sorry — we couldn't accept this order. Please contact us for details."
                : 'This order has been cancelled.'}
            </p>
          </div>
        )}

        {/* Order summary */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <h2 className="font-montserrat font-bold text-lg text-gray-800 mb-4">Order Summary</h2>
          <p className="text-gray-600 text-sm mb-4">{order.orderSummary}</p>
          <div className="flex justify-between items-center border-t border-gray-100 pt-4">
            <span className="font-bold text-gray-800">Total</span>
            <span className="font-montserrat font-bold text-xl text-[#0a4d4d]">EGP {order.orderTotal}</span>
          </div>
        </div>

        {/* Feedback link — show when delivered or served */}
        {(order.status === 'delivered' || order.status === 'served') && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6 text-center">
            <p className="text-gray-700 text-sm mb-3">How was your experience?</p>
            <Link
              to={`/feedback?token=${token}`}
              className="inline-flex items-center gap-2 bg-[#0a4d4d] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0a4d4d]/90 transition-colors"
            >
              ⭐ Leave Feedback
            </Link>
          </div>
        )}

        {/* Back to menu */}
        <Link
          to="/menu"
          className="flex items-center justify-center gap-2 text-[#0a4d4d] font-semibold hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Menu
        </Link>

        <p className="text-center text-xs text-gray-400 mt-6">
          Updates automatically · Last refreshed {new Date().toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}