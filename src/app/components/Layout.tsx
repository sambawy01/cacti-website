import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, X, ShoppingBag, Phone, MapPin, Instagram, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { useCart, CartProvider } from '../context/CartContext';
import { CartDrawer } from './CartDrawer';

// Inner component to use cart hook
function LayoutContent() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { toggleCart, totalItems } = useCart();

  const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Menu', path: '/menu' },
    { name: 'Events', path: '/events' },
    { name: 'Ordering', path: '/ordering' },
  ];

  return (
    <div className="flex flex-col min-h-screen font-sans bg-[#f5f5f0]">
      <CartDrawer />
      
      {/* Header */}
      <header className="sticky top-0 z-40 w-full bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm transition-all duration-300">
        <div className="container mx-auto px-4 md:px-6 h-20 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
              <img
              src="/cacti-logo-full.png"
              alt="Cacti"
              className="h-12 md:h-16 w-auto object-contain transition-transform group-hover:scale-105"
            />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                className={`text-sm font-semibold transition-colors hover:text-[#0a4d4d] relative py-2 ${
                  location.pathname === link.path ? 'text-[#0a4d4d]' : 'text-gray-600'
                }`}
              >
                {link.name}
                {location.pathname === link.path && (
                  <motion.div layoutId="underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0a4d4d]" />
                )}
              </Link>
            ))}
            <Button 
              onClick={toggleCart}
              className="rounded-full shadow-lg hover:shadow-xl transition-all relative overflow-visible"
            >
              <ShoppingBag className="w-4 h-4 mr-2" />
              Cart
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#0a0a0a] text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full border-2 border-white">
                  {totalItems}
                </span>
              )}
            </Button>
          </nav>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-4 md:hidden">
            <button onClick={toggleCart} className="relative p-2 text-gray-600">
              <ShoppingBag className="w-6 h-6" />
              {totalItems > 0 && (
                <span className="absolute top-0 right-0 bg-[#0a4d4d] text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full">
                  {totalItems}
                </span>
              )}
            </button>
            <button onClick={toggleMenu} className="p-2 text-gray-600">
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="fixed inset-0 top-20 z-30 bg-white p-6 md:hidden flex flex-col gap-6 border-t"
          >
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-2xl font-bold text-gray-800 hover:text-[#0a4d4d] flex items-center justify-between"
              >
                {link.name}
                <span className="text-gray-300 text-lg">→</span>
              </Link>
            ))}
            <div className="mt-auto border-t pt-6">
               <Button onClick={() => { setIsMobileMenuOpen(false); toggleCart(); }} className="w-full h-12 text-lg">
                 View Cart ({totalItems})
               </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-black text-white pt-20 pb-10">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            <div>
              <Link to="/" className="mb-6 block">
                <img
                  src="/cacti-logo-header-white.png"
                  alt="Cacti"
                  className="h-16 w-auto object-contain"
                />
              </Link>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                Marsa Baghush's premier beach restaurant and bar. Mediterranean seafood, sunset sessions, and Greek hospitality on the North Coast.
              </p>
              <div className="flex gap-4">
                <a href="https://instagram.com/redsea_anglers" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-[#0a4d4d] transition-colors border border-white/10 hover:border-transparent">
                  <Instagram className="w-5 h-5" />
                </a>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#0a4d4d]">Explore</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li><Link to="/menu" className="hover:text-[#0a4d4d] transition-colors">Our Menu</Link></li>
                <li><Link to="/ordering" className="hover:text-[#0a4d4d] transition-colors">Ordering</Link></li>
                <li><Link to="/events" className="hover:text-[#0a4d4d] transition-colors">Events</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#0a4d4d]">Get in Touch</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li className="flex items-start gap-3 group">
                  <MapPin className="w-5 h-5 text-[#0a4d4d] shrink-0 group-hover:animate-bounce" />
                  <span className="text-left">
                    Marsa Baghush, North Coast, Egypt
                  </span>
                </li>
                <li className="flex items-center gap-3 group">
                  <Phone className="w-5 h-5 text-[#0a4d4d] shrink-0 group-hover:rotate-12 transition-transform" />
                  <a href="tel:+201000254242" className="hover:text-white transition-colors">+20 100 025 4242</a>
                </li>
                <li className="flex items-center gap-3 group">
                  <Mail className="w-5 h-5 text-[#0a4d4d] shrink-0 group-hover:scale-110 transition-transform" />
                  <a href="mailto:hello@cacti.eg" className="hover:text-white transition-colors">hello@cacti.eg</a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#0a4d4d]">Opening Hours</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li className="flex justify-between border-b border-white/10 pb-2">
                  <span>Mon - Sun</span>
                  <span>12:00 PM - 2:00 AM</span>
                </li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-white/10 mt-16 pt-8 text-center text-gray-500 text-sm flex flex-col md:flex-row justify-between items-center gap-4">
            <p>© {new Date().getFullYear()} Cacti. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function Layout() {
  return (
    <CartProvider>
      <LayoutContent />
    </CartProvider>
  );
}