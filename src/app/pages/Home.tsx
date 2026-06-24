import React, { useState, useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useCart } from '../context/CartContext';
import { useMenuData } from '../data/useMenuData';
import { Music, Sunset, Wine, Plus, ChevronDown, ArrowRight } from 'lucide-react';

const HERO_IMAGES = [
  '/hero-1.jpg',
  '/hero-2.jpg',
  '/hero-3.jpg',
  '/hero-4.jpg',
  '/hero-5.jpg',
  '/hero-6.jpg',
  '/hero-7.jpg',
  '/hero-8.jpg',
  '/hero-9.jpg',
  '/hero-10.jpg',
];

const STORY_IMAGES = [
  '/hero-8.jpg',
  '/hero-9.jpg',
  '/hero-10.jpg',
  '/hero-2.jpg',
];
const CTA_BG = 'https://placehold.co/1920x600/0a0a0a/0a4d4d?text=Reserve+Your+Table';

const GALLERY_IMAGES = [
  { label: 'The Lounge', span: 'md:row-span-2', url: '/hero-1.jpg' },
  { label: 'Sunset Deck', span: '', url: '/hero-2.jpg' },
  { label: 'The Bar', span: '', url: '/hero-3.jpg' },
  { label: 'Beachfront', span: 'md:row-span-2', url: '/hero-4.jpg' },
  { label: 'Bar Counter', span: '', url: '/hero-6.jpg' },
  { label: 'Twilight Lounge', span: '', url: '/hero-10.jpg' },
  { label: 'The Bar', span: 'md:row-span-2', url: '/hero-7.jpg' },
  { label: 'Open Air', span: '', url: '/hero-8.jpg' },
  { label: 'Canopy Bar', span: '', url: '/hero-9.jpg' },
  { label: 'Interior', span: '', url: '/hero-5.jpg' },
];

const WEEKLY_EVENTS = [
  { day: 'Sunday', theme: 'Seafood Sundays', desc: 'Whole fresh catch of the day, grilled on charcoal.' },
  { day: 'Monday', theme: 'Mediterranean Night', desc: 'A Greek-led tasting menu celebrating the Aegean.' },
  { day: 'Tuesday', theme: 'Sunset Acoustic', desc: 'Live acoustic sets as the sun melts into the sea.' },
  { day: 'Wednesday', theme: 'Cacti Sunset Session', desc: 'Our signature DJ night from golden hour till late.' },
  { day: 'Thursday', theme: 'Throwback Thursday', desc: 'Classic hits, vintage cocktails, barefoot dancing.' },
  { day: 'Friday', theme: 'Friday Fiesta', desc: 'Latin rhythms, mezcal cocktails, and ceviche bar.' },
  { day: 'Saturday', theme: 'Beach Beats', desc: 'Local DJs, sunset cocktails, and dancing on the sand till late.' },
];

export function HomePage() {
  const { addItem } = useCart();
  const { menuItems } = useMenuData();
  const [heroIndex, setHeroIndex] = useState(0);
  const [storyIndex, setStoryIndex] = useState(0);

  // Rotate hero images every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % HERO_IMAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Rotate story images every 6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setStoryIndex((prev) => (prev + 1) % STORY_IMAGES.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const signatureCategories = ['Raw Bar', 'Hot Mezze', 'Seafood Mains'];
  const dishes = menuItems
    .filter((item) => signatureCategories.includes(item.category))
    .slice(0, 6);

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
      {/* ============ 1. HERO — Futuristic with logo + motion ============ */}
      <section className="relative h-screen min-h-[600px] flex items-center justify-center overflow-hidden bg-[#0a0a0a]">
        {/* Rotating hero images with crossfade + Ken Burns zoom */}
        {HERO_IMAGES.map((src, i) => (
          <motion.div
            key={src}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{
              opacity: i === heroIndex ? 1 : 0,
              scale: i === heroIndex ? 1.1 : 1,
            }}
            transition={{
              opacity: { duration: 1.5, ease: 'easeInOut' },
              scale: { duration: 6, ease: 'easeOut' },
            }}
          >
            <img
              src={src}
              alt="Cacti Beach Restaurant"
              className="w-full h-full object-cover"
            />
          </motion.div>
        ))}

        {/* Dark gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/40 via-[#0a0a0a]/30 to-[#0a0a0a]" />

        {/* Content */}
        <div className="relative z-10 text-center px-4 max-w-4xl">
          {/* Logo with pulsing glow + entrance animation */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative inline-block mb-2"
          >
            {/* Pulsing glow behind logo */}
            <motion.div
              animate={{
                opacity: [0.2, 0.5, 0.2],
                scale: [1, 1.1, 1],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 bg-[#06b6d4] blur-[60px] rounded-full"
            />
            <img
              src="/cacti-logo-full-white.png"
              alt="Cacti"
              className="relative z-10 mx-auto w-48 md:w-64 h-auto"
            />
          </motion.div>

          {/* Tagline with staggered entrance */}
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9 }}
            className="mt-6 text-sm md:text-base text-white/70 uppercase tracking-[0.25em]"
          >
            Mediterranean Beach Restaurant &amp; Bar &nbsp;|&nbsp; Marsa Baghush, North Coast
          </motion.p>

          {/* Animated line under tagline */}
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: '120px' }}
            transition={{ duration: 0.8, delay: 1.2 }}
            className="mx-auto h-[2px] bg-gradient-to-r from-transparent via-[#06b6d4] to-transparent mt-6"
          />

          {/* CTA buttons with stagger */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.4 }}
            className="mt-10 flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Link to="/menu">
              <Button className="bg-[#0a4d4d] hover:bg-[#06b6d4] text-white border-none rounded-full px-8 h-14 text-base font-semibold transition-all duration-300 hover:scale-105 shadow-lg shadow-[#0a4d4d]/30">
                View Menu
              </Button>
            </Link>
            <Link to="/ordering">
              <Button variant="outline" className="border-2 border-white/80 text-white hover:bg-white hover:text-[#0a4d4d] bg-transparent rounded-full px-8 h-14 text-base font-semibold transition-all duration-300">
                Order Now
              </Button>
            </Link>
          </motion.div>
        </div>

        {/* Animated scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 12, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: 2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/50 hidden sm:block"
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
              {/* Rotating story images with crossfade */}
              {STORY_IMAGES.map((src, i) => (
                <motion.img
                  key={src}
                  src={src}
                  alt="Cacti beachfront restaurant"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: i === storyIndex ? 1 : 0,
                    scale: i === storyIndex ? 1.05 : 1,
                  }}
                  transition={{
                    opacity: { duration: 1.5, ease: 'easeInOut' },
                    scale: { duration: 6, ease: 'easeOut' },
                  }}
                  className="rounded-3xl shadow-2xl w-full h-[500px] object-cover absolute inset-0"
                />
              ))}
              <div className="relative h-[500px]" />
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="absolute -bottom-6 -right-6 bg-[#0a4d4d] px-6 py-4 rounded-2xl shadow-xl hidden md:block flex items-center justify-center"
              >
                <img
                  src="/cacti-logo-full-white.png"
                  alt="Cacti"
                  className="h-12 w-auto object-contain"
                />
              </motion.div>
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
                sea-focused — <span className="text-[#0a4d4d] font-semibold">fresh catch daily, Greek-led, charcoal-grilled</span> —
                built around the fresh catch landed daily by local fishermen.
              </p>
              <p className="text-gray-600 text-lg leading-relaxed mb-8">
                Think barefoot elegance, warm Greek hospitality, and long sunset sessions that drift into
                night events under the stars. Whether it's sea bass crudo at golden hour or a whole grilled sea
                bream at midnight, Cacti is where summer tastes like the sea.
              </p>
              <div className="flex flex-wrap gap-3">
                {['Fresh Catch Daily', 'Greek Hospitality', 'Barefoot Elegance', 'Sunset Sessions'].map((tag, i) => (
                  <motion.span
                    key={tag}
                    initial={{ opacity: 0, scale: 0.8 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: i * 0.08 }}
                    className="px-4 py-2 rounded-full bg-[#e8f4f4] text-[#0a4d4d] text-sm font-semibold border border-[#0a4d4d]/10"
                  >
                    {tag}
                  </motion.span>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ============ 3. SIGNATURE DISHES ============ */}
      <section className="py-24 md:py-32 bg-[#0a0a0a] relative overflow-hidden">
        {/* Subtle glow */}
        <motion.div
          animate={{ opacity: [0.05, 0.12, 0.05] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#0a4d4d] rounded-full blur-[200px]"
        />
        <div className="container mx-auto px-4 relative z-10">
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

          {dishes.length === 0 && (
            <div className="text-center mt-14">
              <Link to="/menu">
                <Button className="bg-[#0a4d4d] hover:bg-[#06b6d4] text-white border-none rounded-full px-8 h-12 text-base font-semibold transition-all group">
                  View Full Menu <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          )}

          {dishes.length > 0 && (
            <div className="text-center mt-14">
              <Link to="/menu">
                <Button variant="outline" className="border-2 border-[#06b6d4] text-[#06b6d4] hover:bg-[#06b6d4] hover:text-white bg-transparent rounded-full px-8 h-12 text-base font-semibold transition-all group">
                  View Full Menu <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ============ 4. SUNSET SESSIONS ============ */}
      <section className="relative py-24 md:py-32 bg-gradient-to-br from-[#0a4d4d] to-[#06b6d4] overflow-hidden">
        {/* Animated floating orbs */}
        <motion.div
          animate={{ y: [0, -40, 0], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-10 right-10 w-96 h-96 bg-white rounded-full blur-[150px]"
        />
        <motion.div
          animate={{ y: [0, 50, 0], opacity: [0.08, 0.15, 0.08] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-10 left-10 w-96 h-96 bg-[#f0e6d2] rounded-full blur-[150px]"
        />
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
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 5 }}
                  className="w-16 h-16 bg-[#f0e6d2] rounded-full flex items-center justify-center mx-auto mb-6 transition-transform"
                >
                  <feature.icon className="w-8 h-8 text-[#0a4d4d]" />
                </motion.div>
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
      <section className="py-24 md:py-32 bg-[#0a0a0a] relative overflow-hidden">
        <motion.div
          animate={{ opacity: [0.03, 0.08, 0.03] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-[#06b6d4] rounded-full blur-[200px]"
        />
        <div className="container mx-auto px-4 relative z-10">
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
                whileHover={{ scale: 1.03 }}
                className={`rounded-2xl p-6 border transition-all duration-300 ${
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

          <div className="text-center mt-14">
            <Link to="/events">
              <Button variant="outline" className="border-2 border-[#06b6d4] text-[#06b6d4] hover:bg-[#06b6d4] hover:text-white bg-transparent rounded-full px-8 h-12 text-base font-semibold transition-all group">
                View All Events <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ============ 7. CTA SECTION ============ */}
      <section className="relative py-32 md:py-40 overflow-hidden">
        {/* Animated glow */}
        <motion.div
          animate={{ opacity: [0.1, 0.25, 0.1] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 bg-gradient-to-b from-[#0a4d4d]/30 to-transparent"
        />
        <img src={CTA_BG} alt="Reserve your table" className="absolute inset-0 w-full h-full object-cover opacity-20" />
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