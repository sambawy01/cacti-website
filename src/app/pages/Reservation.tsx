import React from 'react';
import { Umbrella, UtensilsCrossed, Calendar, Clock, Users, Mail, Phone, User } from 'lucide-react';
import { Button } from '../components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { API_BASE } from '../../lib/apiConfig';

type ReservationType = 'beach' | 'restaurant';

interface FormData {
  type: ReservationType;
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  partySize: string;
  sunbeds: string;
  notes: string;
}

export function ReservationPage() {
  const [resType, setResType] = React.useState<ReservationType>('beach');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [form, setForm] = React.useState<FormData>({
    type: 'beach',
    name: '',
    phone: '',
    email: '',
    date: '',
    time: '',
    partySize: '2',
    sunbeds: '2',
    notes: '',
  });

  const updateField = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleTypeChange = (type: ReservationType) => {
    setResType(type);
    updateField('type', type);
  };

  // Generate next 30 days for date picker
  const today = new Date();
  const dateOptions = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const value = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return { value, label };
  });

  // Time slots
  const timeSlots = [
    '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
    '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
    '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM',
    '9:00 PM', '9:30 PM', '10:00 PM',
  ];

  const handleSubmit = async () => {
    if (form.name.trim().length < 2) {
      toast.error('Please enter your name');
      return;
    }
    if (!form.phone.trim()) {
      toast.error('Please enter your phone number');
      return;
    }
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!EMAIL_RE.test(form.email.trim())) {
      toast.error('Please enter a valid email — we need it to send your confirmation');
      return;
    }
    if (!form.date) {
      toast.error('Please pick a date');
      return;
    }
    if (!form.time) {
      toast.error('Please pick a time');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/reservation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setSubmitted(true);
    } catch {
      toast.error('Something went wrong. Please try again or call us.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-[#f5f5f0] min-h-screen py-16">
        <div className="container mx-auto px-4 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-10 shadow-sm border border-gray-100 text-center"
          >
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-10 h-10 text-amber-600" />
            </div>
            <h1 className="font-montserrat font-bold text-3xl mb-4 text-[#0a0a0a]">
              Reservation Request Received
            </h1>
            <p className="text-gray-600 mb-2 text-lg">
              Thank you, {form.name.split(' ')[0]}.
            </p>
            <p className="text-gray-500 mb-8">
              This is a <strong>reservation request</strong> — it is not confirmed yet.
              We will review it and send you a confirmation email with a payment link.
              Once payment is completed, your reservation is secured.
            </p>
            <div className="bg-[#f5f5f0] rounded-xl p-6 mb-8 text-left">
              <h3 className="font-bold text-gray-800 mb-4">Your Request</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-400">Type</p>
                  <p className="font-semibold text-gray-700">
                    {form.type === 'beach' ? '🏖️ Beach (Umbrella + Sunbeds)' : '🍽️ Restaurant'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Date</p>
                  <p className="font-semibold text-gray-700">
                    {dateOptions.find(d => d.value === form.date)?.label || form.date}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Time</p>
                  <p className="font-semibold text-gray-700">{form.time}</p>
                </div>
                <div>
                  <p className="text-gray-400">{form.type === 'beach' ? 'Sunbeds' : 'Party Size'}</p>
                  <p className="font-semibold text-gray-700">
                    {form.type === 'beach' ? form.sunbeds : form.partySize} {form.type === 'beach' ? 'sunbeds' : 'guests'}
                  </p>
                </div>
              </div>
            </div>
            <Button
              onClick={() => {
                setSubmitted(false);
                setForm({
                  type: 'beach', name: '', phone: '', email: '',
                  date: '', time: '', partySize: '2', sunbeds: '2', notes: '',
                });
                setResType('beach');
              }}
              variant="outline"
              className="w-full"
            >
              Make Another Reservation
            </Button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#f5f5f0] min-h-screen py-16">
      <div className="container mx-auto px-4 max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="font-montserrat font-bold text-4xl mb-3 text-[#0a0a0a]">Reservations</h1>
          <p className="text-gray-600 max-w-lg mx-auto">
            Book your spot at Cacti — beach sunbeds or a restaurant table.
          </p>
        </div>

        {/* Pending notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <strong>Reservation Request —</strong> Your booking is not confirmed until you receive
            an email confirmation with a payment link from us. After payment, your reservation is secured.
          </p>
        </div>

        {/* Type Toggle */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button
            onClick={() => handleTypeChange('beach')}
            className={`p-6 rounded-2xl border-2 transition-all text-center ${
              resType === 'beach'
                ? 'border-[#0a4d4d] bg-[#0a4d4d] text-white shadow-lg'
                : 'border-gray-200 bg-white text-gray-600 hover:border-[#0a4d4d]/30'
            }`}
          >
            <Umbrella className="w-8 h-8 mx-auto mb-2" />
            <span className="font-semibold">Beach</span>
            <p className={`text-xs mt-1 ${resType === 'beach' ? 'text-white/70' : 'text-gray-400'}`}>
              Umbrella & Sunbeds
            </p>
          </button>
          <button
            onClick={() => handleTypeChange('restaurant')}
            className={`p-6 rounded-2xl border-2 transition-all text-center ${
              resType === 'restaurant'
                ? 'border-[#0a4d4d] bg-[#0a4d4d] text-white shadow-lg'
                : 'border-gray-200 bg-white text-gray-600 hover:border-[#0a4d4d]/30'
            }`}
          >
            <UtensilsCrossed className="w-8 h-8 mx-auto mb-2" />
            <span className="font-semibold">Restaurant</span>
            <p className={`text-xs mt-1 ${resType === 'restaurant' ? 'text-white/70' : 'text-gray-400'}`}>
              Table for your group
            </p>
          </button>
        </div>

        {/* Form */}
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-6">
          {/* Name */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <User className="w-4 h-4 text-[#0a4d4d]" /> Full Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Your name"
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Phone className="w-4 h-4 text-[#0a4d4d]" /> Phone Number
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="+20 1XX XXX XXXX"
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
            />
          </div>

          {/* Email */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Mail className="w-4 h-4 text-[#0a4d4d]" /> Email <span className="text-[#0a4d4d]">*</span>
              <span className="font-normal text-gray-400">(for confirmation)</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="you@example.com"
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
            />
          </div>

          {/* Date */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Calendar className="w-4 h-4 text-[#0a4d4d]" /> Date
            </label>
            <select
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              <option value="">Select a date</option>
              {dateOptions.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Time */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Clock className="w-4 h-4 text-[#0a4d4d]" /> Arrival Time
            </label>
            <select
              value={form.time}
              onChange={(e) => updateField('time', e.target.value)}
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              <option value="">Select a time</option>
              {timeSlots.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Beach: Sunbeds / Restaurant: Party Size */}
          <AnimatePresence mode="wait">
            <motion.div
              key={resType}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
            >
              {resType === 'beach' ? (
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                    <Umbrella className="w-4 h-4 text-[#0a4d4d]" /> Number of Sunbeds
                  </label>
                  <div className="flex items-center gap-3">
                    {[1, 2, 3, 4, '5+'].map(n => (
                      <button
                        key={n}
                        onClick={() => updateField('sunbeds', String(n))}
                        className={`w-12 h-12 rounded-xl border-2 font-bold transition-all ${
                          form.sunbeds === String(n)
                            ? 'border-[#0a4d4d] bg-[#0a4d4d] text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-[#0a4d4d]/30'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                    <Users className="w-4 h-4 text-[#0a4d4d]" /> Party Size
                  </label>
                  <div className="flex items-center gap-3">
                    {['1', '2', '3', '4', '5', '6', '7', '8+'].map(n => (
                      <button
                        key={n}
                        onClick={() => updateField('partySize', n)}
                        className={`w-12 h-12 rounded-xl border-2 font-bold transition-all ${
                          form.partySize === n
                            ? 'border-[#0a4d4d] bg-[#0a4d4d] text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-[#0a4d4d]/30'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Notes */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Notes <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Special requests, allergies, occasion…"
              rows={2}
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] resize-none"
            />
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-[#0a4d4d]/20 disabled:opacity-70"
          >
            {isSubmitting ? 'Sending request...' : 'Send Reservation Request'}
          </Button>

          <p className="text-center text-xs text-gray-400">
            No payment required now — we'll send you a payment link after confirming your request.
          </p>
        </div>
      </div>
    </div>
  );
}