import React, { useState } from 'react';
import { Button } from '../components/ui/button';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useCart } from '../context/CartContext';
import { useMenuData } from '../data/useMenuData';
import { Music, Sunset, Wine, Plus, ChevronDown, ArrowRight } from 'lucide-react';

const HERO_IMG = 'https://placehold.co/1920x1080/0a0a0a/0a4d4d?text=CACTI+Beach+Restaurant';
const STORY_IMG = 'https://placehold.co/800x1000/0a4d4d/f0e6d2?text=Mediterranean+Beach';
const CTA_BG = 'https://placehold.co/1920x600/0a0a0a/0a4d4d?text=Reserve+Your+Table';

const GALLERY_IMAGES = [
  { label: 'Beach View', span: 'md:row-span-2', url: 'https://placehold.co/600x800/0a4d4d/ffffff?text=Beach+View' },
  { label: 'Fresh Catch', span: '', url: 'https://placehold.co/600x400/0a4d4d/f0e6d2?text=Fresh+Catch' },
  { label: 'Cocktails', span: '', url: 'https://placehold.co/600x400/0a4d4d/ffffff?text=Cocktails' },
  { label: 'Sunset', span: 'md:row-span-2', url: 'https://placehold.co/600x800/0a4d4d/f0e6d2?text=Sunset' },
  { label: 'Interior', span: '', url: 'https://placehold.co/600x400/0a4d4d/ffffff?text=Interior' },
  { label: 'Seafood Platter', span: '', url: 'https://placehold.co/600x400/0a4d4d/f0e6d2?text=Seafood+Platter' },
];

const WEEKLY_EVENTS = [
  { day: 'Sunday', theme: 'Seafood Sundays', desc: 'Whole fresh catch of the day, grilled on charcoal.' },
  { day: 'Monday', theme: 'Mediterranean Night', desc: 'A Greek-led tasting menu celebrating the Aegean.' },
  { day: 'Tuesday', theme: 'Sunset Acoustic', desc: 'Live acoustic sets as the sun melts into the sea.' },
  { day: 'Wednesday', theme: 'Cacti Sunset Session', desc: 'Our signature DJ night from golden hour till late.' },
  { day: 'Thursday', theme: 'Throwback Thursday', desc: 'Classic hits, vintage cocktails, barefoot dancing.' },
  { day: 'Friday', theme: 'Friday Fiesta', desc: 'Latin rhythms, mezcal cocktails, and ceviche bar.' },
  { day: 'Saturday', theme: 'Saturday White Party', desc: 'Dress in white. Sunset cocktails and house beats.' },
];

export function HomePage() {
  const { addItem } = useCart();
  const { menuItems, loading } = useMenuData();

  const signatureCategories = ['Raw Bar', 'Hot Mezze', 'Seafood Mains'];
  const signatureDishes = menuItems
    .filter((item) => signatureCategories.includes(item.category))
    .slice(0, 6);

  // Fallback to placeholder dishes if no data loaded yet
  const fallbackDishes = [
    { id: 'f1', name: 'Oysters on the Half Shell', description: 'Fresh Mediterranean oysters with mignonette.', price: 320, image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Oysters', status: 'available' as const },
    { id: 'f2', name: 'Tuna Tartare', description: 'Yellowfin tuna, avocado, sesame, ponzu.', price: 280, image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Tuna+Tartare', status: 'available' as const },
    { id: 'f3', name: 'Grilled Octopus', description: 'Charcoal octopus, fava puree, capers.', price: 340, image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Octopus', status: 'available' as const },
    { id: 'f4', name: 'Calamari Fritti', description: 'Fried calamari, lemon, smoked aioli.', price: 220, image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Calamari', status: 'available' as const },
    { id: 'f5', name: 'Whole Sea Bream', description: 'Grilled sea bream, ladolemono, wild greens.', price: 450, image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Sea+Bream', status: 'available' as const },
    { id: 'f6', name: 'Lobster Pasta', description: 'Lobster, linguine, cherry tomatoes, white wine.', price: 520, image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Lobster+Pasta', status: 'limited' as const },
  ];

  const dishes = signatureDishes.length > 0 ? signatureDishes : fallbackDishes;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.12 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <div className="w-full bg-[#f5f5f0]">
      {/* ============ 1. HERO ============ */}
      <section className="relative h-screen min-h-[600px] flex items-center justify-center overflow-hidden bg-[#0a0a0a]">
        <img
          src={HERO_IMG}
          alt="Cacti Beach Restaurant"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/40 to-[#0a0a0a]" />

        <div className="relative z-10 text-center px-4 max-w-4xl">
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="font-serif text-7xl md:text-9xl font-bold text-white tracking-tight leading-none"
          >
            CACTI
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-4 text-xl md:text-3xl font-light text-[#f0e6d2] tracking-wide"
          >
            Sea. Sun. Cacti.
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="mt-3 text-sm md:text-base text-white/70 uppercase tracking-[0.25em]"
          >
            Mediterranean Beach Restaurant &amp; Bar &nbsp;|&nbsp; Marsa Baghush, North Coast
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.1 }}
            className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link to="/menu">
              <Button className="bg-[#0a4d4d] hover:bg-[#06b6d4] text-white border-none rounded-full px-8 h-14 text-base font-semibold transition-all duration-300 hover:scale-105 shadow-lg shadow-[#0a4d4d]/30">
                View Menu
              </Button>
            </Link>
            <Link to="/menu">
              <Button variant="outline" className="border-2 border-white/80 text-white hover:bg-white hover:text-[#0a4d4d] bg-transparent rounded-full px-8 h-14 text-base font-semibold transition-all duration-300">
                Order Now
              </Button>
            </Link>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/60 hidden sm:block"
        >
          <ChevronDown className="w-8 h-8" />
        </motion.div>
      </section>

      {/* ============ 2. INTRO / STORY ============ */}
      <section className="py-24 md:py-32 bg-[#f5f5f0]">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20 items-center max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className="relative"
            >
              <img
                src={STORY_IMG}
                alt="Cacti beachfront restaurant"
                className="rounded-3xl shadow-2xl w-full h-[500px] object-cover"
              />
              <div className="absolute -bottom-6 -right-6 bg-[#0a4d4d] text-[#f0e6d2] px-6 py-4 rounded-2xl shadow-xl hidden md:block">
                <p className="font-serif text-3xl font-bold leading-none">70%</p>
                <p className="text-xs uppercase tracking-wider mt-1">Seafood</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              <span className="text-[#06b6d4] font-bold tracking-[0.3em] uppercase text-sm block mb-4">Our Story</span>
              <h2 className="font-serif text-4xl md:text-5xl font-bold text-[#0a0a0a] mb-6 leading-tight">
                A Taste of the Mediterranean
              </h2>
              <p className="text-gray-600 text-lg leading-relaxed mb-5">
                Cacti is a beachfront restaurant in Marsa Baghush on Egypt's North Coast, where the desert
                landscape meets the crystal waters of the Mediterranean. Our kitchen is Greek-led and
                sea-focused — <span className="text-[#0a4d4d] font-semibold">70% seafood, 30% international</span> —
                built around the fresh catch landed daily by local fishermen.
              </p>
              <p className="text-gray-600 text-lg leading-relaxed mb-8">
                Think barefoot elegance, warm Greek hospitality, and long sunset sessions that drift into
                night events under the stars. Whether it's oysters at golden hour or a whole grilled sea
                bream at midnight, Cacti is where summer tastes like the sea.
              </p>
              <div className="flex flex-wrap gap-3">
                {['Fresh Catch Daily', 'Greek Hospitality', 'Barefoot Elegance', 'Sunset Sessions'].map((tag) => (
                  <span key={tag} className="px-4 py-2 rounded-full bg-[#e8f4f4] text-[#0a4d4d] text-sm font-semibold border border-[#0a4d4d]/10">
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ============ 3. SIGNATURE DISHES ============ */}
      <section className="py-24 md:py-32 bg-[#0a0a0a]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="text-[#06b6d4] font-bold tracking-[0.3em] uppercase text-sm block mb-4">From the Sea</span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-[#0a4d4d] mb-4">Signature Dishes</h2>
            <p className="text-gray-400 max-w-2xl mx-auto text-lg">
              A taste of what's coming out of our kitchen — fresh, Greek-led, and grilled over charcoal.
            </p>
          </div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto"
          >
            {dishes.map((dish) => (
              <motion.div
                key={dish.id}
                variants={itemVariants}
                whileHover={{ y: -6 }}
                className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden group flex flex-col ${
                  dish.status === 'sold_out' ? 'opacity-60 grayscale' : ''
                }`}
              >
                <div className="relative h-56 overflow-hidden shrink-0">
                  <img
                    src={dish.image}
                    alt={dish.name}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  {dish.status === 'sold_out' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="bg-white text-[#0a0a0a] px-4 py-2 rounded-full font-bold text-sm">SOLD OUT</span>
                    </div>
                  )}
                </div>
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="font-serif text-xl font-bold text-white leading-tight mb-2">{dish.name}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed line-clamp-2 mb-4 flex-1">{dish.description}</p>
                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[#06b6d4] font-bold text-lg">EGP {dish.price}</span>
                    {dish.status === 'sold_out' ? (
                      <Button disabled className="bg-white/10 text-white/40 border-none rounded-full px-4 h-9 text-sm">
                        Unavailable
                      </Button>
                    ) : (
                      <Button
                        onClick={() => addItem({ id: dish.id, name: dish.name, price: dish.price, image: dish.image })}
                        className="bg-[#0a4d4d] hover:bg-[#06b6d4] text-white border-none rounded-full px-4 h-9 text-sm font-semibold transition-all"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          <div className="text-center mt-14">
            <Link to="/menu">
              <Button variant="outline" className="border-2 border-[#06b6d4] text-[#06b6d4] hover:bg-[#06b6d4] hover:text-white bg-transparent rounded-full px-8 h-12 text-base font-semibold transition-all group">
                View Full Menu <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ============ 4. SUNSET SESSIONS ============ */}
      <section className="relative py-24 md:py-32 bg-gradient-to-br from-[#0a4d4d] to-[#06b6d4] overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-96 h-96 bg-white rounded-full blur-[150px]" />
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-16">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="font-serif text-4xl md:text-6xl font-bold text-white mb-3"
            >
              Sunset Sessions
            </motion.h2>
            <p className="text-[#f0e6d2] text-lg md:text-xl font-light tracking-wide mb-4">Every evening from 6 PM</p>
            <p className="text-white/80 max-w-2xl mx-auto text-lg leading-relaxed">
              As the sun dips into the Mediterranean, Cacti comes alive. DJ sets, signature cocktails,
              and golden hour on the beach — the way summer was meant to be spent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              { icon: Music, title: 'Live DJ Sets', desc: 'Resident and guest DJs spinning from sunset till late.' },
              { icon: Sunset, title: 'Signature Cocktails', desc: 'Cacti Sunset, Aegean Spritz, and Mediterranean Negroni.' },
              { icon: Wine, title: 'Beachfront Dining', desc: 'Tables on the sand, toes in the water, stars overhead.' },
            ].map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-8 text-center hover:bg-white/15 transition-all duration-300 group"
              >
                <div className="w-16 h-16 bg-[#f0e6d2] rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-8 h-8 text-[#0a4d4d]" />
                </div>
                <h3 className="font-serif text-2xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-white/80 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 5. GALLERY ============ */}
      <section className="py-24 md:py-32 bg-[#f5f5f0]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="text-[#06b6d4] font-bold tracking-[0.3em] uppercase text-sm block mb-4">Gallery</span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-[#0a0a0a] mb-4">Life at Cacti</h2>
            <p className="text-gray-600 max-w-2xl mx-auto text-lg">Beach, food, cocktails, and golden hour — a glimpse of summer.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-6xl mx-auto auto-rows-[200px] md:auto-rows-[240px]">
            {GALLERY_IMAGES.map((img, i) => (
              <motion.div
                key={img.label}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`relative overflow-hidden rounded-2xl group ${img.span}`}
              >
                <img
                  src={img.url}
                  alt={img.label}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a]/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                  <span className="text-white font-semibold text-sm tracking-wide">{img.label}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 6. EVENTS CALENDAR ============ */}
      <section className="py-24 md:py-32 bg-[#0a0a0a]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="text-[#06b6d4] font-bold tracking-[0.3em] uppercase text-sm block mb-4">Weekly Calendar</span>
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-white mb-4">This Summer at Cacti</h2>
            <p className="text-gray-400 max-w-2xl mx-auto text-lg">Seven nights, seven moods. Find your night.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
            {WEEKLY_EVENTS.map((event, i) => (
              <motion.div
                key={event.day}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className={`rounded-2xl p-6 border transition-all duration-300 hover:scale-[1.03] ${
                  event.day === 'Wednesday'
                    ? 'bg-gradient-to-br from-[#0a4d4d] to-[#06b6d4] border-transparent col-span-1 lg:col-span-1'
                    : 'bg-white/5 border-white/10 hover:border-[#06b6d4]/40'
                }`}
              >
                <p className={`text-xs uppercase tracking-[0.2em] font-bold mb-2 ${event.day === 'Wednesday' ? 'text-[#f0e6d2]' : 'text-[#06b6d4]'}`}>
                  {event.day}
                </p>
                <h3 className="font-serif text-xl font-bold text-white mb-2 leading-tight">{event.theme}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{event.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 7. CTA SECTION ============ */}
      <section className="relative py-32 md:py-40 overflow-hidden">
        <img src={CTA_BG} alt="Reserve your table" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-[#0a0a0a]/80" />
        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-serif text-4xl md:text-6xl font-bold text-white mb-4"
          >
            Reserve Your Table
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-[#f0e6d2] text-xl md:text-2xl font-light mb-10"
          >
            Experience Cacti this summer
          </motion.p>
          <Link to="/menu">
            <Button className="bg-[#0a4d4d] hover:bg-[#06b6d4] text-white border-none rounded-full px-10 h-14 text-lg font-semibold transition-all duration-300 hover:scale-105 shadow-xl shadow-[#0a4d4d]/40">
              View Menu <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}