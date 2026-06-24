import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Sunset, Moon, Calendar, MapPin, Clock, ArrowRight, Sparkles, Wine, Users, Star } from 'lucide-react';
import { Button } from '../components/ui/button';

const WEEKLY_EVENTS = [
  { day: 'Sunday', theme: 'Seafood Sundays', icon: Star, desc: 'Whole fresh catch of the day, grilled on charcoal. Oyster hour from 5 PM.', time: '12:00 PM - Late', color: '#0a4d4d' },
  { day: 'Monday', theme: 'Mediterranean Night', icon: Wine, desc: 'A Greek-led tasting menu celebrating the Aegean. Wine pairing available.', time: '7:00 PM - Late', color: '#067373' },
  { day: 'Tuesday', theme: 'Sunset Acoustic', icon: Music, desc: 'Live acoustic sets as the sun melts into the sea. Barefoot, chilled, beautiful.', time: '6:00 PM - 10:00 PM', color: '#0a4d4d' },
  { day: 'Wednesday', theme: 'Cacti Sunset Session', icon: Sunset, desc: 'Our signature DJ night from golden hour till late. The one not to miss.', time: '6:00 PM - 2:00 AM', color: '#06b6d4', featured: true },
  { day: 'Thursday', theme: 'Throwback Thursday', icon: Music, desc: 'Classic hits, vintage cocktails, barefoot dancing on the sand.', time: '8:00 PM - Late', color: '#0a4d4d' },
  { day: 'Friday', theme: 'Friday Fiesta', icon: Music, desc: 'Latin rhythms, mezcal cocktails, and ceviche bar on the beach.', time: '8:00 PM - 2:00 AM', color: '#067373' },
  { day: 'Saturday', theme: 'Saturday White Party', icon: Moon, desc: 'Dress in white. Sunset cocktails, house beats, the best night of the week.', time: '7:00 PM - 2:00 AM', color: '#0a4d4d', featured: true },
];

const SPECIAL_EVENTS = [
  {
    id: 'opening',
    title: 'Cacti Opening Night',
    date: 'TBA',
    time: '7:00 PM',
    description: 'The launch. Guest DJ, oyster bar, champagne flowing. RSVP only.',
    image: 'https://placehold.co/800x500/0a0a0a/06b6d4?text=Opening+Night',
    tag: 'Launch',
    tagColor: '#06b6d4',
  },
  {
    id: 'fullmoon',
    title: 'Full Moon Sessions',
    date: 'Monthly',
    time: '9:00 PM - 2:00 AM',
    description: 'Monthly full-moon beach party. DJ under the stars, barefoot on the sand.',
    image: 'https://placehold.co/800x500/0a0a0a/f0e6d2?text=Full+Moon',
    tag: 'Monthly',
    tagColor: '#f0e6d2',
  },
  {
    id: 'catch',
    title: 'Catch of the Day Challenge',
    date: 'Bi-weekly',
    time: '5:00 PM',
    description: 'Cooking demo with the daily catch. Our chef breaks down fresh fish tableside.',
    image: 'https://placehold.co/800x500/0a4d4d/ffffff?text=Catch+Challenge',
    tag: 'Bi-weekly',
    tagColor: '#06b6d4',
  },
  {
    id: 'closing',
    title: 'Endless Summer Closing Party',
    date: 'End of Season',
    time: '7:00 PM - Late',
    description: 'Season finale. The biggest night of the year. Headliner DJ, full bar, all night.',
    image: 'https://placehold.co/800x500/0a0a0a/06b6d4?text=Closing+Party',
    tag: 'Season Finale',
    tagColor: '#06b6d4',
  },
];

export function EventsPage() {
  const [activeDay, setActiveDay] = useState<string | null>(null);

  return (
    <div className="w-full bg-[#f5f5f0]">
      {/* ============ HERO ============ */}
      <section className="relative h-[60vh] min-h-[400px] flex items-center justify-center overflow-hidden bg-[#0a0a0a]">
        <img
          src="https://placehold.co/1920x1080/0a0a0a/06b6d4?text=Cacti+Events"
          alt="Cacti Events"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/60 via-[#0a0a0a]/40 to-[#0a0a0a]" />
        <div className="relative z-10 text-center px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Sparkles className="w-10 h-10 text-[#06b6d4] mx-auto mb-4" />
            <h1 className="font-serif text-5xl md:text-7xl font-bold text-white tracking-tight">
              Events
            </h1>
            <p className="mt-4 text-lg md:text-xl text-white/70 font-light">
              Sunset sessions, night events, and everything in between
            </p>
          </motion.div>
        </div>
      </section>

      {/* ============ SUNSET SESSIONS BANNER ============ */}
      <section className="relative overflow-hidden bg-gradient-to-r from-[#0a4d4d] to-[#06b6d4] py-20">
        <div className="container mx-auto px-4 text-center text-white">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <Sunset className="w-12 h-12 mx-auto mb-4" />
            <h2 className="font-serif text-4xl md:text-6xl font-bold mb-4">Sunset Sessions</h2>
            <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto mb-8">
              Every evening from 6 PM, the beach bar comes alive. DJ sets, signature cocktails,
              and the best golden hour on the North Coast.
            </p>
            <div className="flex flex-wrap justify-center gap-8 text-center">
              <div>
                <Music className="w-6 h-6 mx-auto mb-2" />
                <p className="font-semibold">Live DJ Sets</p>
                <p className="text-sm text-white/70">Wed-Sat evenings</p>
              </div>
              <div>
                <Wine className="w-6 h-6 mx-auto mb-2" />
                <p className="font-semibold">Signature Cocktails</p>
                <p className="text-sm text-white/70">Cacti Sunset, Aegean Spritz</p>
              </div>
              <div>
                <Users className="w-6 h-6 mx-auto mb-2" />
                <p className="font-semibold">Beachfront Dining</p>
                <p className="text-sm text-white/70">Dine with your toes in the sand</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============ WEEKLY SCHEDULE ============ */}
      <section className="py-20 bg-[#f5f5f0]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="text-[#0a4d4d] font-bold tracking-widest uppercase mb-4 block text-sm">Every Week</span>
            <h2 className="font-serif text-3xl md:text-5xl font-bold text-[#0a0a0a] mb-4">This Summer at Cacti</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Seven nights, seven different vibes. From seafood Sundays to Saturday White Parties —
              there's always a reason to be at Cacti.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {WEEKLY_EVENTS.map((event, i) => {
              const Icon = event.icon;
              const isFeatured = event.featured;
              return (
                <motion.div
                  key={event.day}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className={`relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group ${
                    isFeatured ? 'ring-2 ring-[#06b6d4]' : ''
                  }`}
                >
                  {isFeatured && (
                    <div className="absolute top-0 right-0 bg-[#06b6d4] text-white text-xs font-bold px-4 py-1 rounded-bl-lg z-10">
                      SIGNATURE NIGHT
                    </div>
                  )}
                  <div
                    className="h-2 w-full"
                    style={{ backgroundColor: event.color }}
                  />
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white"
                        style={{ backgroundColor: event.color }}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{event.day}</p>
                        <h3 className="font-bold text-lg text-[#0a0a0a] leading-tight">{event.theme}</h3>
                      </div>
                    </div>
                    <p className="text-gray-500 text-sm leading-relaxed mb-4">{event.desc}</p>
                    <div className="flex items-center gap-2 text-[#0a4d4d] text-sm font-semibold">
                      <Clock className="w-4 h-4" />
                      {event.time}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ SPECIAL EVENTS ============ */}
      <section className="py-20 bg-[#0a0a0a]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="text-[#06b6d4] font-bold tracking-widest uppercase mb-4 block text-sm">Mark Your Calendar</span>
            <h2 className="font-serif text-3xl md:text-5xl font-bold text-white mb-4">Special Events</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              One-off nights you don't want to miss. From the opening party to the season finale.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {SPECIAL_EVENTS.map((event, i) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group relative rounded-2xl overflow-hidden shadow-lg"
              >
                <div className="relative h-64 overflow-hidden">
                  <img
                    src={event.image}
                    alt={event.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent" />
                  <span
                    className="absolute top-4 left-4 text-xs font-bold px-3 py-1 rounded-full text-[#0a0a0a]"
                    style={{ backgroundColor: event.tagColor }}
                  >
                    {event.tag}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                  <h3 className="font-serif text-2xl font-bold mb-2">{event.title}</h3>
                  <p className="text-gray-300 text-sm mb-3 leading-relaxed">{event.description}</p>
                  <div className="flex items-center gap-4 text-sm text-white/80">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" /> {event.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" /> {event.time}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ NIGHT EVENTS ============ */}
      <section className="py-20 bg-[#f5f5f0]">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <Moon className="w-12 h-12 text-[#0a4d4d] mx-auto mb-4" />
          <h2 className="font-serif text-3xl md:text-5xl font-bold text-[#0a0a0a] mb-4">Night Events</h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-12">
            From 11 PM, Cacti transforms. The dining tables clear, the bar takes over,
            and the beach becomes the dance floor. Guest DJs, themed nights, and
            summer parties that go till 2 AM.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {[
              { title: 'Guest DJs', desc: 'Rotating lineup of Egypt\'s best beach DJs every week.' },
              { title: 'Themed Parties', desc: 'White parties, full moon sessions, retro nights.' },
              { title: 'Late Bar', desc: 'Full cocktail menu, shisha, and bar bites till 2 AM.' },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="bg-white rounded-2xl p-8 shadow-sm"
              >
                <h3 className="font-bold text-lg text-[#0a4d4d] mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
          <Link to="/menu">
            <Button size="lg" className="px-10 py-6 text-lg rounded-full bg-[#0a4d4d] hover:bg-[#067373]">
              View Menu <ArrowRight className="ml-2 w-5 h-5 inline" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="relative py-32 overflow-hidden bg-[#0a0a0a]">
        <img
          src="https://placehold.co/1920x600/0a0a0a/06b6d4?text=Reserve+Your+Spot"
          alt="Reserve"
          className="absolute inset-0 w-full h-full object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-[#0a0a0a]/70" />
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
              Follow us on Instagram for the latest event schedule and guest DJ announcements.
            </p>
            <a
              href="#"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#06b6d4] hover:bg-[#067373] text-white font-bold py-4 px-8 rounded-full shadow-lg transition-all hover:scale-105"
            >
              <MapPin className="w-5 h-5" /> Marsa Baghush, North Coast
            </a>
          </motion.div>
        </div>
      </section>
    </div>
  );
}