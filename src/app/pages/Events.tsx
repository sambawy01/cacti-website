import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Music, Sunset, Moon, MapPin, Clock, ArrowRight, Sparkles, Headphones, Disc3, Radio, Calendar, Check, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { API_BASE } from '../../lib/apiConfig';

const UPCOMING_EVENTS = [
  {
    id: 'sunset-sessions',
    title: 'Sunset Sessions',
    icon: Sunset,
    category: 'Weekly',
    schedule: 'Every evening',
    time: '6:00 PM - Late',
    description: 'Our signature daily event. As the sun melts into the Mediterranean, the beach comes alive with curated playlists, golden hour cocktails, and the best sunset view on the North Coast.',
    highlights: ['Golden hour DJ sets', 'Signature cocktails', 'Beachfront seating'],
    color: '#06b6d4',
    featured: true,
  },
  {
    id: 'live-music',
    title: 'Live Music Nights',
    icon: Music,
    category: 'Weekly',
    schedule: 'Tuesdays & Thursdays',
    time: '7:00 PM - 11:00 PM',
    description: 'Acoustic sets, live bands, and vocal performances under the stars. From Greek bouzouki to modern covers, a different sound every week.',
    highlights: ['Acoustic & live bands', 'Greek & international', 'Open-air stage'],
    color: '#0a4d4d',
  },
  {
    id: 'local-djs',
    title: 'Local DJ Lineup',
    icon: Headphones,
    category: 'Weekly',
    schedule: 'Wednesdays, Fridays, Saturdays',
    time: '8:00 PM - 2:00 AM',
    description: "Egypt's best beach DJs take over the decks. House, afro-house, melodic techno, and feel-good classics till late. The dance floor is the sand.",
    highlights: ['Rotating local DJs', 'House & afro-house', 'Beach dance floor'],
    color: '#067373',
  },
  {
    id: 'international-djs',
    title: 'International Guest DJs',
    icon: Disc3,
    category: 'Monthly',
    schedule: 'Monthly - Follow us for dates',
    time: '9:00 PM - 2:00 AM',
    description: 'Once a month, we bring in international DJs for a proper beach party. Guest headliners from Greece, Europe, and beyond. RSVP only.',
    highlights: ['International headliners', 'Beach party format', 'RSVP required'],
    color: '#0a4d4d',
    featured: true,
  },

  {
    id: 'full-moon',
    title: 'Full Moon Sessions',
    icon: Radio,
    category: 'Monthly',
    schedule: 'Monthly - Full moon nights',
    time: '9:00 PM - 2:00 AM',
    description: 'Once a month, under the full moon. A special beach party with a guest DJ, fire pits, and the sky lit up. The most magical night at Cacti.',
    highlights: ['Full moon beach party', 'Fire pits', 'Special guest DJ'],
    color: '#067373',
  },
];

export function EventsPage() {
  return (
    <div className="w-full bg-[#f5f5f0]">
      {/* ============ HERO ============ */}
      <section className="relative h-[60vh] min-h-[400px] flex items-center justify-center overflow-hidden bg-[#0a0a0a]">
        {/* Animated gradient orbs */}
        <motion.div
          animate={{
            x: [0, 100, 0],
            y: [0, -50, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-10 left-10 w-96 h-96 bg-[#0a4d4d] rounded-full blur-[120px] opacity-40"
        />
        <motion.div
          animate={{
            x: [0, -80, 0],
            y: [0, 60, 0],
            scale: [1, 1.3, 1],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-10 right-10 w-96 h-96 bg-[#06b6d4] rounded-full blur-[120px] opacity-30"
        />

        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/60 via-[#0a0a0a]/40 to-[#0a0a0a]" />

        <div className="relative z-10 text-center px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="inline-block mb-4"
            >
              <Sparkles className="w-10 h-10 text-[#06b6d4]" />
            </motion.div>
            <h1 className="font-serif text-5xl md:text-7xl font-bold text-white tracking-tight">
              Events
            </h1>
            <p className="mt-4 text-lg md:text-xl text-white/70 font-light">
              Sunset sessions, live music, and DJs on the beach
            </p>
          </motion.div>
        </div>
      </section>

      {/* ============ EVENT CARDS ============ */}
      <section className="py-20 bg-[#f5f5f0]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="text-[#0a4d4d] font-bold tracking-widest uppercase mb-4 block text-sm">What's On</span>
            <h2 className="font-serif text-3xl md:text-5xl font-bold text-[#0a0a0a] mb-4">Upcoming Events</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              From daily sunset sessions to monthly international guest DJs, there's always something happening at Cacti.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {UPCOMING_EVENTS.map((event, i) => {
              const Icon = event.icon;
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  whileHover={{ y: -8 }}
                  className={`relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col ${
                    event.featured ? 'ring-2 ring-[#06b6d4]' : ''
                  }`}
                >
                  {event.featured && (
                    <div className="absolute top-0 right-0 bg-[#06b6d4] text-white text-xs font-bold px-4 py-1 rounded-bl-lg z-10">
                      SIGNATURE
                    </div>
                  )}
                  <div className="h-2 w-full" style={{ backgroundColor: event.color }} />

                  {/* Icon + Category badge */}
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: event.color }}
                      >
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                        {event.category}
                      </span>
                    </div>

                    <h3 className="font-serif text-xl font-bold text-[#0a0a0a] leading-tight mb-2">{event.title}</h3>
                    <p className="text-gray-500 text-sm leading-relaxed mb-4 flex-1">{event.description}</p>

                    {/* Highlights */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {event.highlights.map((h) => (
                        <span key={h} className="text-xs px-2.5 py-1 rounded-full bg-[#e8f4f4] text-[#0a4d4d] font-medium">
                          {h}
                        </span>
                      ))}
                    </div>

                    {/* Schedule + Time */}
                    <div className="space-y-2 pt-4 border-t border-gray-100">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600 font-medium">{event.schedule}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <span className="text-[#0a4d4d] font-semibold">{event.time}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ SUNSET SESSIONS FEATURE ============ */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0a4d4d] to-[#06b6d4] py-20">
        {/* Floating orbs */}
        <motion.div
          animate={{ y: [0, -30, 0], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-20 left-20 w-64 h-64 bg-white rounded-full blur-[100px]"
        />
        <motion.div
          animate={{ y: [0, 40, 0], opacity: [0.1, 0.15, 0.1] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-10 right-20 w-80 h-80 bg-[#f0e6d2] rounded-full blur-[120px]"
        />

        <div className="container mx-auto px-4 relative z-10 text-center text-white">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <Sunset className="w-12 h-12 mx-auto mb-4" />
            <h2 className="font-serif text-4xl md:text-6xl font-bold mb-4">Sunset Sessions</h2>
            <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto mb-8">
              Every evening from 6 PM. The sun, the sea, the music. This is what summer at Cacti is all about.
            </p>
            <div className="flex flex-wrap justify-center gap-8 text-center">
              <div>
                <Music className="w-6 h-6 mx-auto mb-2" />
                <p className="font-semibold">Live DJ Sets</p>
                <p className="text-sm text-white/70">Daily from 6 PM</p>
              </div>
              <div>
                <Headphones className="w-6 h-6 mx-auto mb-2" />
                <p className="font-semibold">Curated Playlists</p>
                <p className="text-sm text-white/70">Golden hour vibes</p>
              </div>
              <div>
                <Moon className="w-6 h-6 mx-auto mb-2" />
                <p className="font-semibold">Late Night</p>
                <p className="text-sm text-white/70">Till 2 AM weekends</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============ BOOKING FORM ============ */}
      <EventBookingForm />

      {/* ============ CTA ============ */}
      <section className="relative py-32 overflow-hidden bg-[#0a0a0a]">
        {/* Animated background glow */}
        <motion.div
          animate={{ opacity: [0.1, 0.25, 0.1] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 bg-gradient-radial from-[#0a4d4d]/40 via-transparent to-transparent"
        />
        <div className="relative z-10 text-center px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-serif text-4xl md:text-6xl font-bold text-white mb-4">
              Join Us This Summer
            </h2>
            <p className="text-white/70 text-lg mb-8 max-w-xl mx-auto">
              Follow us on Instagram for the latest event schedule, guest DJ announcements, and surprise parties.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="https://instagram.com/redsea_anglers"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#06b6d4] hover:bg-[#067373] text-white font-bold py-4 px-8 rounded-full shadow-lg transition-all hover:scale-105"
              >
                <Sparkles className="w-5 h-5" /> Follow on Instagram
              </a>
              <a
                href="https://cacti.restaurant"
                className="inline-flex items-center gap-2 border-2 border-white/30 text-white hover:bg-white/10 font-bold py-4 px-8 rounded-full shadow-lg transition-all"
              >
                <MapPin className="w-5 h-5" /> Marsa Baghush, North Coast
              </a>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

// ── Event Booking Form ─────────────────────────────────────────────────────
const EVENT_TYPES = [
  'Sunset Session',
  'Live Music Night',
  'Private Dining',
  'Full Venue Hire',
  'Birthday / Celebration',
  'Corporate Event',
  'Other',
];

function EventBookingForm() {
  const [form, setForm] = React.useState({
    name: '', phone: '', email: '', eventType: '', eventDate: '', partySize: '', notes: '',
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState('');

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.email.trim()) {
      setError('Please fill in your name, phone, and email.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/event-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setSubmitted(true);
      } else {
        setError(json.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date();
  const dateOptions = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const value = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return { value, label };
  });

  if (submitted) {
    return (
      <section className="py-20 bg-[#f5f5f0]">
        <div className="container mx-auto px-4 max-w-lg text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="font-montserrat font-bold text-2xl text-gray-800 mb-2">Enquiry Sent!</h3>
            <p className="text-gray-500 mb-1">
              Thanks, {form.name.split(' ')[0]}. We've received your enquiry and will get back to you
            </p>
            <p className="text-gray-500 mb-6">with a quote within 24 hours.</p>
            <Button
              onClick={() => { setSubmitted(false); setForm({ name: '', phone: '', email: '', eventType: '', eventDate: '', partySize: '', notes: '' }); }}
              variant="outline"
            >
              Send Another Enquiry
            </Button>
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-20 bg-[#f5f5f0]">
      <div className="container mx-auto px-4 max-w-lg">
        <div className="text-center mb-8">
          <span className="text-[#0a4d4d] font-bold tracking-widest uppercase mb-3 block text-sm">Enquire Now</span>
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-[#0a0a0a] mb-3">Book an Event</h2>
          <p className="text-gray-600">
            Tell us what you're planning and we'll send you a personalised quote within 24 hours.
          </p>
        </div>

        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-4">
          {/* Name + Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-1 block">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder="Your full name"
                className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-1 block">Phone *</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => update('phone', e.target.value)}
                placeholder="+20 122 128 8804"
                className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="you@example.com"
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
            />
          </div>

          {/* Event Type + Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-1 block">Event Type</label>
              <select
                value={form.eventType}
                onChange={e => update('eventType', e.target.value)}
                className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] appearance-none"
              >
                <option value="">Select type...</option>
                {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-1 block">Preferred Date</label>
              <select
                value={form.eventDate}
                onChange={e => update('eventDate', e.target.value)}
                className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] appearance-none"
              >
                <option value="">Pick a date...</option>
                {dateOptions.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>

          {/* Party Size */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Party Size</label>
            <input
              type="number"
              value={form.partySize}
              onChange={e => update('partySize', e.target.value)}
              placeholder="Number of guests"
              min="1"
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              placeholder="Tell us about your event — vibe, budget range, special requests..."
              rows={3}
              className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-14 text-lg font-bold rounded-xl shadow-lg shadow-[#0a4d4d]/20 disabled:opacity-60"
          >
            {submitting ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending...</>
            ) : (
              'Send Enquiry'
            )}
          </Button>
          <p className="text-center text-xs text-gray-400">
            No payment now — we'll review and send you a quote.
          </p>
        </div>
      </div>
    </section>
  );
}