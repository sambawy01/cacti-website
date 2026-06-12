import React, { useState } from 'react';
import { Button } from '../components/ui/button';
import { ArrowRight, Star, Leaf, ChefHat, Clock, ChevronDown, ChevronUp, MapPin, Plus, Users, MessageCircle, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useCart } from '../context/CartContext';
import { useMenuData } from '../data/useMenuData';
import { useProductsData } from '../data/useProductsData';

export function HomePage() {
  const [isMenuExpanded, setIsMenuExpanded] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const { addItem } = useCart();

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const { menuItems, loading: menuLoading } = useMenuData();
  const { products, loading: productsLoading } = useProductsData();
  
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <div className="w-full bg-[#F9F5F0]">
      {/* Hero Section */}
      <section className="relative bg-black flex items-center justify-center overflow-hidden">
        <div className="w-full">
          <video
            autoPlay
            muted
            loop
            playsInline
            poster="https://i.ibb.co/hRJKBWTn/image001.jpg"
            className="w-full h-auto block"
          >
            <source src="/assets/hero-video.mp4" type="video/mp4" />
          </video>
        </div>
        
        {/* Buttons at bottom of hero */}
        <div className="absolute bottom-4 sm:bottom-10 left-0 right-0 z-10 flex flex-row gap-2 sm:gap-4 justify-center px-4">
          <Link to="/menu">
            <Button size="lg" className="text-sm sm:text-lg h-11 sm:h-16 px-5 sm:px-10 rounded-full bg-[#D94E28] hover:bg-[#c0392b] border-none shadow-[0_0_20px_rgba(217,78,40,0.4)] transition-all hover:scale-105">
              See Today's Menu
            </Button>
          </Link>
          <Link to="/plan-builder">
            <Button size="lg" variant="outline" className="text-sm sm:text-lg h-11 sm:h-16 px-5 sm:px-10 rounded-full border-2 border-white text-white hover:bg-white hover:text-[#2C3E50] bg-transparent transition-all">
              Catering Quote
            </Button>
          </Link>
        </div>

        {/* Scroll Indicator */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: 1 }}
          className="absolute bottom-1 sm:bottom-8 left-1/2 -translate-x-1/2 text-white hidden sm:block"
        >
          <ChevronDown className="w-8 h-8 opacity-70" />
        </motion.div>
      </section>

      {/* Today's Menu Section */}
      <section className="py-24 bg-[#F9F5F0]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="text-[#D94E28] font-bold tracking-widest uppercase mb-4 block text-sm">Daily Specials</span>
            <h2 className="font-montserrat font-bold text-3xl md:text-5xl mb-4 text-[#2C3E50]">Today's Menu</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Freshly prepared for today. Order now for immediate delivery across El Gouna.
            </p>
          </div>

          {menuItems.length === 0 && !menuLoading ? (
            <div className="max-w-2xl mx-auto text-center py-8">
              <div className="bg-white rounded-3xl p-12 shadow-sm border border-gray-100">
                <div className="w-20 h-20 bg-[#FFF5F2] rounded-full flex items-center justify-center mx-auto mb-6">
                  <Clock className="w-10 h-10 text-[#D94E28]" />
                </div>
                <h3 className="font-montserrat font-bold text-2xl md:text-3xl text-[#2C3E50] mb-4">
                  Tomorrow's Menu Drops at 12 PM
                </h3>
                <p className="text-gray-500 text-lg mb-8 leading-relaxed">
                  Our chefs are preparing something special. Check back tomorrow at noon for the fresh daily menu.
                </p>
                <a
                  href="https://chat.whatsapp.com/BYGHdETThbn9kYUf8W7fpu?mode=gi_t"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white font-bold py-3 px-6 rounded-full shadow-lg shadow-green-500/20 transition-all hover:scale-105"
                >
                  Join WhatsApp for Daily Updates
                </a>
              </div>
            </div>
          ) : (
            <>
              <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto mb-12">
                <AnimatePresence>
                  {menuLoading ? [1,2,3].map((i) => (<motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-2xl overflow-hidden shadow-sm animate-pulse flex flex-col"><div className="h-64 bg-gray-200 shrink-0" /><div className="p-6"><div className="h-5 bg-gray-200 rounded w-3/4 mb-3" /><div className="h-4 bg-gray-200 rounded w-full mb-2" /><div className="h-12 bg-gray-200 rounded-xl mt-6" /></div></motion.div>)) : (isMenuExpanded ? menuItems : menuItems.slice(0, 3)).map((item) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.3 }}
                      key={item.id}
                      className={`bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col ${
                        item.status === 'sold_out' ? 'opacity-75 grayscale-[0.5]' : ''
                      }`}
                    >
                      <div className="relative h-64 overflow-hidden shrink-0">
                        <img src={item.image} alt={item.name} loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                        <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                          {item.dietary?.map((tag) => (
                            <span key={tag} className="bg-white/95 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase text-[#2C3E50] shadow-sm">{tag}</span>
                          ))}
                        </div>
                        {item.status === 'limited' && (
                          <div className="absolute top-4 right-4 bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm animate-pulse">Low Stock</div>
                        )}
                        {item.status === 'sold_out' && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]">
                            <span className="bg-white text-gray-800 px-4 py-2 rounded-full font-bold shadow-lg transform -rotate-12 border-2 border-gray-800">SOLD OUT</span>
                          </div>
                        )}
                      </div>
                      <div className="p-6 flex flex-col flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-montserrat font-bold text-lg text-[#2C3E50] leading-tight">{item.name}</h3>
                          <span className="font-bold text-[#D94E28] whitespace-nowrap ml-2">EGP {item.price}</span>
                        </div>
                        <div className="mb-4 flex-1">
                          <p className={`text-gray-500 text-sm leading-relaxed ${expandedItems.has(item.id) ? '' : 'line-clamp-2'}`}>{item.description}</p>
                          {item.description && item.description.length > 80 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                              className="text-[#D94E28] text-xs font-semibold mt-1 flex items-center gap-1 hover:underline"
                            >
                              {expandedItems.has(item.id) ? (
                                <>Less <ChevronUp className="w-3 h-3" /></>
                              ) : (
                                <>Read more <ChevronDown className="w-3 h-3" /></>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="mt-auto pt-4 border-t border-gray-100">
                          {item.status === 'sold_out' ? (
                             <Button disabled className="w-full bg-gray-100 text-gray-400 border border-gray-200">Unavailable</Button>
                          ) : (
                            <Button onClick={() => addItem(item)} className="w-full bg-[#2C3E50] hover:bg-[#D94E28] text-white transition-all duration-300 shadow-lg hover:shadow-[#D94E28]/25 h-12 rounded-xl text-base font-semibold group-hover:translate-y-[-2px]">
                              <Plus className="w-4 h-4 mr-2" />Add to Cart
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>

              <div className="text-center">
                <Button
                  onClick={() => setIsMenuExpanded(!isMenuExpanded)}
                  variant="outline"
                  size="lg"
                  className="rounded-full px-10 py-6 border-2 border-[#D94E28] text-[#D94E28] hover:bg-[#D94E28] hover:text-white transition-all text-lg font-bold group"
                >
                  {isMenuExpanded ? (
                    <>Show Less <ChevronDown className="ml-2 w-5 h-5 rotate-180 transition-transform" /></>
                  ) : (
                    <>View Full Menu <ChevronDown className="ml-2 w-5 h-5 transition-transform group-hover:translate-y-1" /></>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Bistro Pantry Section */}
      <section className="py-24 bg-white">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
            <div>
              <span className="text-[#D94E28] font-bold tracking-widest uppercase mb-4 block text-sm">Bistro Pantry</span>
              <h2 className="font-montserrat font-bold text-3xl md:text-5xl text-[#2C3E50] mb-4">Bring the Bistro Home</h2>
              <p className="text-gray-600 max-w-2xl text-lg">
                Handcrafted essentials made in our open kitchen. From our family to yours.
              </p>
            </div>
            <Link to="/products">
              <Button variant="outline" className="hidden md:flex rounded-full border-2 border-[#D94E28] text-[#D94E28] hover:bg-[#D94E28] hover:text-white transition-all px-8 py-6 text-lg font-bold group">
                Shop All Items <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>

          <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto mb-12">
            <AnimatePresence>
            {productsLoading ? [1,2,3].map((i) => (<motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-2xl overflow-hidden shadow-sm animate-pulse flex flex-col"><div className="h-64 bg-gray-200 shrink-0" /><div className="p-6"><div className="h-5 bg-gray-200 rounded w-3/4 mb-3" /><div className="h-4 bg-gray-200 rounded w-full mb-2" /><div className="h-12 bg-gray-200 rounded-xl mt-6" /></div></motion.div>)) : products.slice(0, 3).map((product) => (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                key={product.id}
                className={`bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col ${
                  product.status === 'sold_out' ? 'opacity-75 grayscale-[0.5]' : ''
                }`}
              >
                <div className="relative h-64 overflow-hidden shrink-0">
                  <img src={product.image} alt={product.name} loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                  <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                    {product.dietary?.map((tag) => (
                      <span key={tag} className="bg-white/95 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase text-[#2C3E50] shadow-sm">{tag}</span>
                    ))}
                  </div>
                  {product.status === 'sold_out' && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]">
                      <span className="bg-white text-gray-800 px-4 py-2 rounded-full font-bold shadow-lg transform -rotate-12 border-2 border-gray-800">SOLD OUT</span>
                    </div>
                  )}
                </div>
                <div className="p-6 flex flex-col flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-montserrat font-bold text-lg text-[#2C3E50] leading-tight">{product.name}</h3>
                    <span className="font-bold text-[#D94E28] whitespace-nowrap ml-2">EGP {product.price}</span>
                  </div>
                  <p className="text-gray-500 text-sm mb-6 line-clamp-2 leading-relaxed flex-1">{product.description}</p>
                  <div className="mt-auto pt-4 border-t border-gray-100">
                    {product.status === 'sold_out' ? (
                       <Button disabled className="w-full bg-gray-100 text-gray-400 border border-gray-200">Unavailable</Button>
                    ) : (
                      <Button onClick={() => addItem(product)} className="w-full bg-[#2C3E50] hover:bg-[#D94E28] text-white transition-all duration-300 shadow-lg hover:shadow-[#D94E28]/25 h-12 rounded-xl text-base font-semibold group-hover:translate-y-[-2px]">
                        <Plus className="w-4 h-4 mr-2" />Add to Cart
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
            </AnimatePresence>
          </motion.div>
          
          <div className="text-center md:hidden">
            <Link to="/products">
              <Button className="w-full rounded-full bg-[#D94E28] text-white hover:bg-[#c0392b] transition-all px-8 py-6 text-lg font-bold group">
                Shop All Items <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-white">
        <div className="container mx-auto px-4">
          <motion.div 
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-12"
          >
            <motion.div variants={itemVariants} className="text-center p-8 rounded-3xl bg-[#F9F5F0] hover:shadow-xl transition-all duration-300 group">
              <div className="w-20 h-20 bg-white shadow-sm text-[#D94E28] rounded-full flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform">
                <Leaf className="w-10 h-10" />
              </div>
              <h3 className="font-montserrat font-bold text-2xl mb-4 text-[#2C3E50]">100% Natural Ingredients</h3>
              <p className="text-gray-600 leading-relaxed">
                No powder stock, no shortcuts, no processed ingredients, no flavor enhancers or plant fats. Just fresh, quality food made the way it should be.
              </p>
            </motion.div>

            <motion.div variants={itemVariants} className="text-center p-8 rounded-3xl bg-[#F9F5F0] hover:shadow-xl transition-all duration-300 group">
              <div className="w-20 h-20 bg-white shadow-sm text-[#D94E28] rounded-full flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform">
                <ChefHat className="w-10 h-10" />
              </div>
              <h3 className="font-montserrat font-bold text-2xl mb-4 text-[#2C3E50]">Open Kitchen Policy</h3>
              <p className="text-gray-600 leading-relaxed">
                Walk in anytime. See how we cook. We have nothing to hide and everything to show.
              </p>
            </motion.div>

            <motion.div variants={itemVariants} className="text-center p-8 rounded-3xl bg-[#F9F5F0] hover:shadow-xl transition-all duration-300 group">
              <div className="w-20 h-20 bg-white shadow-sm text-[#D94E28] rounded-full flex items-center justify-center mx-auto mb-8 group-hover:scale-110 transition-transform">
                <MapPin className="w-10 h-10" />
              </div>
              <h3 className="font-montserrat font-bold text-2xl mb-4 text-[#2C3E50]">Made for El Gouna</h3>
              <p className="text-gray-600 leading-relaxed">
                From sunrise breakfast to sunset boat parties - we bring the flavor to every corner of El Gouna. Corporate lunch? Covered. Beach picnic? Done. Home BBQ and gatherings? We've got you. Your community kitchen, delivered wherever you are.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>


      {/* WhatsApp Community Section */}
      <section className="py-20 bg-[#25D366]/5 border-y border-[#25D366]/10">
        <div className="container mx-auto px-4 text-center">
          <div className="w-20 h-20 bg-[#25D366] rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/30">
            <Users className="w-10 h-10 text-white" />
          </div>
          <h2 className="font-montserrat font-bold text-3xl md:text-4xl mb-4 text-[#2C3E50]">Get the Daily Menu First</h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-8 text-lg">
            Join 1,000+ El Gouna residents in our exclusive WhatsApp group. Be the first to see our daily specials, seasonal offers, and community updates.
          </p>
          <a 
            href="https://chat.whatsapp.com/BYGHdETThbn9kYUf8W7fpu?mode=gi_t" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white font-bold py-4 px-8 rounded-full shadow-lg shadow-green-500/20 transition-all hover:scale-105"
          >
            <MessageCircle className="w-6 h-6" />
            Join WhatsApp Group
          </a>
        </div>
      </section>

      {/* Catering Video Section */}
      <section className="bg-[#2C3E50] py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-16 max-w-6xl mx-auto">
            {/* Video - native 9:16 portrait */}
            <div className="w-full md:w-auto shrink-0 flex justify-center">
              <video
                autoPlay
                muted
                loop
                playsInline
                className="rounded-2xl shadow-2xl w-[280px] md:w-[320px] h-auto"
              >
                <source src="/assets/catering-video.mp4" type="video/mp4" />
              </video>
            </div>
            {/* Text content */}
            <div className="text-white text-center md:text-left">
              <span className="text-[#D94E28] font-bold tracking-widest uppercase mb-4 block text-sm">Catering Services</span>
              <h2 className="font-montserrat font-bold text-4xl md:text-6xl mb-8 leading-tight">Elevate Your Events</h2>
              <p className="text-gray-300 text-lg mb-10 leading-relaxed max-w-lg">
                From corporate meetings to luxury yacht trips and intimate weddings, we bring the restaurant experience to you. Custom menus, professional service, and zero hassle.
              </p>
              <Link to="/catering">
                <Button className="w-fit bg-[#D94E28] hover:bg-[#c0392b] text-white h-14 px-8 rounded-xl text-lg group">
                  Get a Quote <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Google Reviews */}
      <section className="py-24 bg-[#F9F5F0]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <div className="flex items-center justify-center gap-3 mb-4">
              <svg className="w-8 h-8" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-gray-500 font-semibold text-lg">Google Reviews</span>
            </div>
            <h2 className="font-montserrat font-bold text-3xl md:text-5xl mb-4 text-[#2C3E50]">Loved by El Gouna</h2>
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className="flex gap-0.5 text-[#F39C12]">
                {[...Array(5)].map((_, j) => <Star key={j} className="w-5 h-5 fill-current" />)}
              </div>
              <span className="text-gray-600 font-semibold">5.0 on Google</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: "Sherif Hamdy",
                text: "Bistro Cloud has quickly become my daily go-to in El Gouna. The daily variety is exceptional, the food quality consistently outstanding, and their on-time service makes it all a fantastic value for money. Highly recommend!",
                time: "1 week ago"
              },
              {
                name: "Hisham ElSayed",
                text: "Amazingly delicious food, clean ingredients cooked with passion. I'm a chef and I have seen the kitchen, delivery time always spot on. Value for money wow... keep up the great work!",
                time: "1 week ago"
              },
              {
                name: "Tarek Foda",
                text: "Amazing home cooked food, clean ingredients, freshly made, seamless ordering, delivery and payment approach. A blessing to have in El Gouna.",
                time: "1 week ago"
              },
              {
                name: "Dina Eladly",
                text: "Delicious and clean food, good variety! Definitely recommended.",
                time: "6 days ago"
              }
            ].map((review, i) => (
              <div key={i} className="bg-white p-10 rounded-3xl shadow-sm border border-gray-100 relative">
                <div className="absolute -top-6 left-10 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-md border border-gray-100">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
                <div className="flex gap-1 text-[#F39C12] mb-4">
                  {[...Array(5)].map((_, j) => <Star key={j} className="w-5 h-5 fill-current" />)}
                </div>
                <p className="text-gray-600 mb-6 italic text-lg leading-relaxed">
                  "{review.text}"
                </p>
                <div className="flex justify-between items-end">
                  <div className="font-bold text-[#2C3E50]">
                    {review.name}
                  </div>
                  <span className="text-gray-400 text-sm">{review.time}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <a
              href="https://maps.app.goo.gl/x3GUwezxRr2qiY7m6"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-[#2C3E50] font-bold py-4 px-8 rounded-full shadow-sm border border-gray-200 transition-all hover:shadow-md"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              See All Reviews on Google
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* AI Features Section */}
      <section className="py-24 bg-gradient-to-b from-[#2C3E50] to-[#1a252f] text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-10 left-10 w-72 h-72 bg-[#D94E28] rounded-full blur-[120px]" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-[#D94E28] rounded-full blur-[150px]" />
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <div className="text-center mb-16">
            <span className="text-[#D94E28] font-bold tracking-[4px] uppercase mb-4 block text-sm">Powered by AI</span>
            <h2 className="font-montserrat font-bold text-3xl md:text-5xl mb-4">Smart Tools for Your Convenience</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              The first cloud kitchen in El Gouna with AI-powered ordering and planning tools.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* AI Chat */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-8 md:p-10 hover:bg-white/10 transition-all group"
            >
              <div className="w-16 h-16 bg-[#D94E28]/20 rounded-2xl flex items-center justify-center mb-6">
                <MessageCircle className="w-8 h-8 text-[#D94E28]" />
              </div>
              <h3 className="font-montserrat font-bold text-xl md:text-2xl mb-3">AI Chat Assistant</h3>
              <p className="text-gray-400 leading-relaxed mb-6">
                Ask anything about our menu, prices, delivery, or dietary options. Get instant answers 24/7 — no waiting for a reply.
              </p>
              <div className="flex flex-wrap gap-2 mb-6">
                {['Menu & Prices', 'Dietary Info', 'Delivery Areas', 'Allergens'].map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-white/10 text-xs font-medium text-gray-300">{tag}</span>
                ))}
              </div>
              <p className="text-[#D94E28] font-semibold text-sm flex items-center gap-2">
                Click the chat bubble in the bottom right corner
                <span className="inline-block w-3 h-3 bg-[#D94E28] rounded-full animate-pulse" />
              </p>
            </motion.div>

            {/* AI Plan Builder */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
            >
              <Link
                to="/plan-builder"
                className="block bg-gradient-to-br from-[#D94E28] to-[#a83520] rounded-3xl p-8 md:p-10 h-full hover:shadow-2xl hover:shadow-[#D94E28]/20 transition-all group hover:-translate-y-1"
              >
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-6">
                  <Users className="w-8 h-8 text-white" />
                </div>
                <h3 className="font-montserrat font-bold text-xl md:text-2xl mb-3">Corporate Plan Builder</h3>
                <p className="text-white/80 leading-relaxed mb-6">
                  Building a catering plan for your team? Our AI designs a custom proposal with menu rotation and pricing in just 2 minutes.
                </p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {['Custom Menus', 'Instant Pricing', 'Event Planning', 'Yacht Catering'].map((tag) => (
                    <span key={tag} className="px-3 py-1 rounded-full bg-white/20 text-xs font-medium text-white/90">{tag}</span>
                  ))}
                </div>
                <span className="inline-flex items-center gap-2 text-white font-semibold text-sm group-hover:gap-3 transition-all">
                  Build Your Plan Now <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24 bg-white">
        <div className="container mx-auto px-4 max-w-4xl">
          <h2 className="font-montserrat font-bold text-3xl md:text-4xl mb-12 text-center text-[#2C3E50]">Frequently Asked Questions</h2>
          <div className="space-y-4">
             {[
               { q: "How do I order?", a: (<span>You can order directly through this website, message us on WhatsApp, or join our <a href="https://chat.whatsapp.com/BYGHdETThbn9kYUf8W7fpu?mode=gi_t" target="_blank" rel="noopener noreferrer" className="text-[#25D366] font-bold hover:underline">Daily Menu Group</a> for specials.</span>) },
               { q: "What is the delivery time?", a: "Typical delivery time is 30-45 minutes depending on your location in El Gouna." },
               { q: "Where do you deliver?", a: "For daily orders (B2C), we offer free delivery across all of El Gouna. For corporate catering (B2B), we cover the entire area from Safaga to Ras Ghareb, including Hurghada." },
               { q: "Can I customize my order?", a: "Absolutely! Mention any dietary requirements or customization requests in your order notes." },
               { q: "How do I pay?", a: "We accept Cash on Delivery, Instapay, and Credit/Debit Card payments." }
             ].map((faq, i) => (
               <details key={i} className="group border border-gray-100 rounded-2xl bg-[#F9F5F0] open:bg-white open:shadow-md transition-all duration-300">
                 <summary className="flex justify-between items-center font-medium cursor-pointer list-none p-6 text-lg text-[#2C3E50]">
                   {faq.q}
                   <span className="transition group-open:rotate-180">
                     <ChevronDown className="w-5 h-5" />
                   </span>
                 </summary>
                 <div className="text-gray-600 px-6 pb-6 pt-0 leading-relaxed">
                   {faq.a}
                 </div>
               </details>
             ))}
          </div>
        </div>
      </section>
    </div>
  );
}
