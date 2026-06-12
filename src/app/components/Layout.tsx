import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, X, ShoppingBag, Phone, MapPin, Instagram, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import logoHeader from '@/assets/8ed5368e99d26da0c833286cd37634dbfa9feba8.png';
import logoFooter from '@/assets/8ce61c2b20b01bfb625276cbc7a2d368e6d7d388.png';
import { Button } from './ui/button';
import { useCart, CartProvider } from '../context/CartContext';
import { CartDrawer } from './CartDrawer';
import { ChatWidget } from './ChatWidget';
import { PlanBuilderChat } from './PlanBuilderChat';

// Inner component to use cart hook
function LayoutContent() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPlanBuilderOpen, setIsPlanBuilderOpen] = useState(false);
  const location = useLocation();
  const { toggleCart, totalItems } = useCart();

  // Listen for custom event to open plan builder from any page
  React.useEffect(() => {
    const handler = () => setIsPlanBuilderOpen(true);
    window.addEventListener('open-plan-builder', handler);
    return () => window.removeEventListener('open-plan-builder', handler);
  }, []);

  const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Menu', path: '/menu' },
    { name: 'Pantry', path: '/products' },
    { name: 'Catering', path: '/catering' },
    { name: 'Contact', path: '/contact' },
  ];

  return (
    <div className="flex flex-col min-h-screen font-sans bg-[#F9F5F0]">
      <CartDrawer />
      
      {/* Header */}
      <header className="sticky top-0 z-40 w-full bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm transition-all duration-300">
        <div className="container mx-auto px-4 md:px-6 h-20 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
             <img 
               src={logoHeader} 
               alt="Bistro Cloud" 
               className="h-16 w-auto object-contain transition-transform group-hover:scale-105" 
             />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                className={`text-sm font-semibold transition-colors hover:text-[#D94E28] relative py-2 ${
                  location.pathname === link.path ? 'text-[#D94E28]' : 'text-gray-600'
                }`}
              >
                {link.name}
                {location.pathname === link.path && (
                  <motion.div layoutId="underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D94E28]" />
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
                <span className="absolute -top-1 -right-1 bg-[#2C3E50] text-white text-[10px] font-bold h-5 w-5 flex items-center justify-center rounded-full border-2 border-white">
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
                <span className="absolute top-0 right-0 bg-[#D94E28] text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full">
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
                className="text-2xl font-bold text-gray-800 hover:text-[#D94E28] flex items-center justify-between"
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
                  src={logoFooter} 
                  alt="Bistro Cloud" 
                  className="h-24 w-auto object-contain" 
                />
              </Link>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                El Gouna's premium cloud kitchen. 100% natural ingredients, open kitchen policy, and Mediterranean warmth delivered to your door.
              </p>
              <div className="flex gap-4">
                <a href="https://www.instagram.com/bistrocloudelgouna/" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-[#D94E28] transition-colors border border-white/10 hover:border-transparent">
                  <Instagram className="w-5 h-5" />
                </a>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#D94E28]">Explore</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li><Link to="/menu" className="hover:text-[#D94E28] transition-colors">Our Menu</Link></li>
                <li><Link to="/products" className="hover:text-[#D94E28] transition-colors">Bistro Pantry</Link></li>
                <li><Link to="/catering" className="hover:text-[#D94E28] transition-colors">Corporate Catering</Link></li>
                <li><Link to="/contact" className="hover:text-[#D94E28] transition-colors">Contact Us</Link></li>
                <li><Link to="#" className="hover:text-[#D94E28] transition-colors">About Us</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#D94E28]">Get in Touch</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li className="flex items-start gap-3 group">
                  <MapPin className="w-5 h-5 text-[#D94E28] shrink-0 group-hover:animate-bounce" />
                  <a 
                    href="https://maps.app.goo.gl/zYd24dZBBffosLSH7" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:text-white transition-colors text-left"
                  >
                    <span>West Golf, New Sabina<br/>El Gouna, Red Sea, Egypt</span>
                  </a>
                </li>
                <li className="flex items-center gap-3 group">
                  <Phone className="w-5 h-5 text-[#D94E28] shrink-0 group-hover:rotate-12 transition-transform" />
                  <a href="tel:+201221288804" className="hover:text-white transition-colors">+20 122 128 8804</a>
                </li>
                <li className="flex items-center gap-3 group">
                  <Mail className="w-5 h-5 text-[#D94E28] shrink-0 group-hover:scale-110 transition-transform" />
                  <a href="mailto:catering@bistrocloudeg.com" className="hover:text-white transition-colors">catering@bistrocloudeg.com</a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-6 text-[#D94E28]">Opening Hours</h3>
              <ul className="space-y-4 text-gray-300 text-sm">
                <li className="flex justify-between border-b border-white/10 pb-2">
                  <span>Mon - Sun</span>
                  <span>10:00 AM - 8:00 PM</span>
                </li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-white/10 mt-16 pt-8 text-center text-gray-500 text-sm flex flex-col md:flex-row justify-between items-center gap-4">
            <p>© {new Date().getFullYear()} Bistro Cloud. All rights reserved.</p>
            <div className="flex gap-6">
              <Link to="#" className="hover:text-white">Privacy Policy</Link>
              <Link to="#" className="hover:text-white">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>

      {/* AI Chat Widget */}
      <ChatWidget />

      {/* Plan Builder Chat Window */}
      <PlanBuilderChat isOpen={isPlanBuilderOpen} onClose={() => setIsPlanBuilderOpen(false)} />
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
