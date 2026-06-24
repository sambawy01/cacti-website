import React, { useState, useMemo } from 'react';
import { Button } from '../components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Search, Clock } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useMenuData } from '../data/useMenuData';
import type { MenuItem } from '../data/menuData';

const SECTIONS = ['Restaurant', 'Beach Bar', 'Bar'] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_PLACEHOLDER: Record<Section, MenuItem[]> = {
  Restaurant: [
    { id: 'pr1', name: 'Oysters on the Half Shell', description: 'Fresh Mediterranean oysters, mignonette, lemon.', price: 320, category: 'Raw Bar', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Oysters', status: 'available', section: 'Restaurant' },
    { id: 'pr2', name: 'Tuna Tartare', description: 'Yellowfin tuna, avocado, sesame, ponzu.', price: 280, category: 'Raw Bar', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Tuna+Tartare', status: 'available', section: 'Restaurant' },
    { id: 'pr3', name: 'Grilled Octopus', description: 'Charcoal octopus, fava puree, capers.', price: 340, category: 'Hot Mezze', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Octopus', status: 'available', section: 'Restaurant' },
    { id: 'pr4', name: 'Calamari Fritti', description: 'Fried calamari, lemon, smoked aioli.', price: 220, category: 'Hot Mezze', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Calamari', status: 'available', section: 'Restaurant' },
    { id: 'pr5', name: 'Whole Sea Bream', description: 'Grilled sea bream, ladolemono, wild greens.', price: 450, category: 'Seafood Mains', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Sea+Bream', status: 'available', section: 'Restaurant' },
    { id: 'pr6', name: 'Lobster Pasta', description: 'Lobster, linguine, cherry tomatoes, white wine.', price: 520, category: 'Seafood Mains', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Lobster', status: 'limited', section: 'Restaurant' },
    { id: 'pr7', name: 'Greek Salad', description: 'Tomato, cucumber, feta, olives, oregano.', price: 160, category: 'Cold Mezze', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Greek+Salad', status: 'available', section: 'Restaurant' },
    { id: 'pr8', name: 'Tzatziki & Pita', description: 'Yogurt, cucumber, garlic, dill, warm pita.', price: 90, category: 'Cold Mezze', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Tzatziki', status: 'available', section: 'Restaurant' },
    { id: 'pr9', name: 'Seafood Platter', description: 'Lobster, prawns, calamari, mussels, oysters.', price: 890, category: 'Seafood Mains', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Platter', status: 'sold_out', section: 'Restaurant' },
  ],
  'Beach Bar': [
    { id: 'pb1', name: 'Cacti Club Sandwich', description: 'Chicken, bacon, egg, lettuce, triple-decker toast.', price: 180, category: 'Sandwiches', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Club', status: 'available', section: 'Beach Bar' },
    { id: 'pb2', name: 'Beach Burger', description: 'Wagyu patty, cheddar, onion, house sauce.', price: 240, category: 'Burgers', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Burger', status: 'available', section: 'Beach Bar' },
    { id: 'pb3', name: 'Halloumi Wrap', description: 'Grilled halloumi, peppers, tzatziki, rocket.', price: 150, category: 'Wraps', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Wrap', status: 'available', section: 'Beach Bar' },
    { id: 'pb4', name: 'Shrimp Basket', description: 'Crispy shrimp, fries, cocktail sauce.', price: 260, category: 'Snacks', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Shrimp', status: 'available', section: 'Beach Bar' },
    { id: 'pb5', name: 'Loaded Fries', description: 'Fries, feta, oregano, truffle oil.', price: 120, category: 'Snacks', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Fries', status: 'available', section: 'Beach Bar' },
    { id: 'pb6', name: 'Watermelon Feta Salad', description: 'Watermelon, feta, mint, balsamic glaze.', price: 140, category: 'Salads', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Salad', status: 'available', section: 'Beach Bar' },
  ],
  Bar: [
    { id: 'pc1', name: 'Cacti Sunset', description: 'Tequila, blood orange, lime, agave, sea salt.', price: 180, category: 'Signature Cocktails', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Sunset', status: 'available', section: 'Bar' },
    { id: 'pc2', name: 'Aegean Spritz', description: 'Ouzo, prosecco, soda, cucumber, mint.', price: 190, category: 'Signature Cocktails', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Spritz', status: 'available', section: 'Bar' },
    { id: 'pc3', name: 'Mediterranean Negroni', description: 'Gin, campari, vermouth, olive brine, rosemary.', price: 200, category: 'Cocktails', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Negroni', status: 'available', section: 'Bar' },
    { id: 'pc4', name: 'Fresh Lemonade', description: 'Lemon, mint, cucumber, agave.', price: 80, category: 'Non-Alcoholic', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Lemonade', status: 'available', section: 'Bar' },
    { id: 'pc5', name: 'Assyrtiko Glass', description: 'Crisp white from Santorini, mineral, citrus.', price: 150, category: 'Wine', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Wine', status: 'available', section: 'Bar' },
    { id: 'pc6', name: 'Cacti Margarita', description: 'Mezcal, lime, cactus pear, chili salt.', price: 185, category: 'Signature Cocktails', image: 'https://placehold.co/400x300/0a4d4d/f0e6d2?text=Margarita', status: 'limited', section: 'Bar' },
  ],
};

export function MenuPage() {
  const [activeSection, setActiveSection] = useState<Section>('Restaurant');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const { addItem } = useCart();
  const { menuItems, loading } = useMenuData();

  // Items for the current section: use live data if it has section field, else fallback
  const sectionItems = useMemo(() => {
    const live = menuItems.filter((i) => i.section === activeSection);
    return live.length > 0 ? live : SECTION_PLACEHOLDER[activeSection];
  }, [menuItems, activeSection]);

  // Categories for current section
  const categories = useMemo(() => {
    const cats = Array.from(new Set(sectionItems.map((i) => i.category)));
    return ['All', ...cats];
  }, [sectionItems]);

  // Reset category when section changes if current isn't valid
  React.useEffect(() => {
    if (!categories.includes(activeCategory)) {
      setActiveCategory('All');
    }
  }, [categories, activeCategory]);

  const filteredItems = sectionItems.filter((item) => {
    const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* ===== HERO HEADER ===== */}
      <section className="relative bg-[#0a0a0a] py-24 md:py-32 overflow-hidden">
        <img
          src="https://placehold.co/1920x600/0a0a0a/0a4d4d?text=Our+Menu"
          alt="Our Menu"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/50 to-[#0a0a0a]" />
        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="font-serif text-5xl md:text-7xl font-bold text-white mb-4"
          >
            Our Menu
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-[#f0e6d2] text-lg md:text-xl font-light tracking-wide"
          >
            Fresh from the Mediterranean daily
          </motion.p>
        </div>
      </section>

      {/* ===== TABS ===== */}
      <div className="sticky top-16 z-30 bg-[#f5f5f0]/95 backdrop-blur-md border-b border-[#0a4d4d]/10">
        <div className="container mx-auto px-4">
          <div className="flex justify-center gap-1 md:gap-2">
            {SECTIONS.map((section) => (
              <button
                key={section}
                onClick={() => {
                  setActiveSection(section);
                  setActiveCategory('All');
                }}
                className="relative px-6 md:px-10 py-5 text-sm md:text-base font-semibold transition-colors duration-300"
              >
                <span className={activeSection === section ? 'text-[#0a4d4d]' : 'text-gray-500 hover:text-[#0a4d4d]'}>
                  {section}
                </span>
                {activeSection === section && (
                  <motion.div
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-1 bg-[#0a4d4d] rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ===== CONTENT ===== */}
      <div className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          {/* Search + Category pills */}
          <div className="flex flex-col lg:flex-row gap-4 items-center justify-between mb-10 max-w-5xl mx-auto">
            <div className="flex overflow-x-auto pb-2 gap-2 w-full lg:w-auto hide-scrollbar">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 whitespace-nowrap ${
                    activeCategory === category
                      ? 'bg-[#0a4d4d] text-white shadow-md scale-105'
                      : 'bg-white text-gray-600 hover:bg-[#e8f4f4] hover:text-[#0a4d4d] border border-[#0a4d4d]/10'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="relative w-full lg:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-full border border-[#0a4d4d]/15 bg-white focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] text-sm"
              />
            </div>
          </div>

          {/* Menu Grid */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection + activeCategory}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 max-w-6xl mx-auto"
            >
              {loading
                ? [1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="bg-white rounded-2xl overflow-hidden shadow-sm animate-pulse">
                      <div className="h-48 bg-gray-200" />
                      <div className="p-6 space-y-3">
                        <div className="h-5 bg-gray-200 rounded w-2/3" />
                        <div className="h-4 bg-gray-200 rounded w-full" />
                        <div className="h-10 bg-gray-200 rounded-xl mt-4" />
                      </div>
                    </div>
                  ))
                : filteredItems.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className={`bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col ${
                        item.status === 'sold_out' ? 'opacity-70 grayscale' : ''
                      }`}
                    >
                      <div className="relative h-48 overflow-hidden shrink-0">
                        <img
                          src={item.image}
                          alt={item.name}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                        />
                        {item.dietary && item.dietary.length > 0 && (
                          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                            {item.dietary.map((tag) => (
                              <span
                                key={tag}
                                className="bg-white/95 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase text-[#0a4d4d] shadow-sm"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.status === 'limited' && (
                          <div className="absolute top-3 right-3 bg-[#f0e6d2] text-[#0a4d4d] px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                            Limited
                          </div>
                        )}
                        {item.status === 'sold_out' && (
                          <div className="absolute inset-0 bg-[#0a0a0a]/50 flex items-center justify-center backdrop-blur-[2px]">
                            <span className="bg-white text-[#0a0a0a] px-4 py-2 rounded-full font-bold shadow-lg text-sm">
                              SOLD OUT
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="p-5 flex flex-col flex-1">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <h3 className="font-serif text-lg font-bold text-[#0a0a0a] leading-tight">{item.name}</h3>
                          <span className="font-bold text-[#0a4d4d] whitespace-nowrap">EGP {item.price}</span>
                        </div>
                        <p className="text-gray-500 text-sm leading-relaxed line-clamp-2 mb-4 flex-1">
                          {item.description}
                        </p>
                        <div className="mt-auto">
                          {item.status === 'sold_out' ? (
                            <Button
                              disabled
                              className="w-full bg-gray-100 text-gray-400 border border-gray-200 rounded-xl h-11 text-sm"
                            >
                              Unavailable
                            </Button>
                          ) : (
                            <Button
                              onClick={() =>
                                addItem({ id: item.id, name: item.name, price: item.price, image: item.image })
                              }
                              className="w-full bg-[#0a4d4d] hover:bg-[#06b6d4] text-white transition-all duration-300 shadow-md hover:shadow-[#06b6d4]/25 h-11 rounded-xl text-sm font-semibold group-hover:-translate-y-0.5"
                            >
                              <Plus className="w-4 h-4 mr-2" /> Add to Cart
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
            </motion.div>
          </AnimatePresence>

          {/* Empty state */}
          {filteredItems.length === 0 && !loading && (
            <div className="text-center py-20 max-w-md mx-auto">
              <div className="w-16 h-16 bg-[#e8f4f4] rounded-full flex items-center justify-center mx-auto mb-4 text-[#0a4d4d]">
                <Search className="w-8 h-8" />
              </div>
              <h3 className="font-serif text-xl font-bold text-[#0a0a0a] mb-2">No items found</h3>
              <p className="text-gray-500 mb-4">Try adjusting your search or filter.</p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('All');
                }}
                className="border-2 border-[#0a4d4d] text-[#0a4d4d] hover:bg-[#0a4d4d] hover:text-white rounded-full"
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}