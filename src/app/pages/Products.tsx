import React, { useState } from 'react';
import { Button } from '../components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { Filter, ShoppingBag, Plus, Info, Search, Package, ChevronDown, ChevronUp } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useProductsData } from '../data/useProductsData';

const categories = ['All', 'Tallow', 'Broth'];

export function ProductsPage() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
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
  const { products, categories, loading } = useProductsData();

  const filteredItems = products.filter(item => {
    const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="bg-[#f5f5f0] min-h-screen py-12">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-[#0a4d4d]/10 text-[#0a4d4d] rounded-full flex items-center justify-center mx-auto mb-6">
            <Package className="w-8 h-8" />
          </div>
          <h1 className="font-montserrat font-bold text-4xl mb-4 text-[#0a0a0a]">Cacti Pantry</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Bring a taste of Cacti home with you. Every jar is handcrafted in small batches right here on the North Coast. No shortcuts, no preservatives — just the pure Mediterranean flavours that make Cacti special, ready for your own culinary adventures.
          </p>
        </div>

        {/* Search & Filter Bar */}
        <div className="sticky top-24 z-20 bg-[#f5f5f0]/95 backdrop-blur-sm py-4 mb-8 -mx-4 px-4 border-b border-gray-200/50">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between max-w-5xl mx-auto">
            {/* Categories */}
            <div className="flex overflow-x-auto pb-2 md:pb-0 gap-2 w-full md:w-auto hide-scrollbar">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 whitespace-nowrap ${
                    activeCategory === category
                      ? 'bg-[#0a4d4d] text-white shadow-md transform scale-105'
                      : 'bg-white text-gray-600 hover:bg-[#e8f4f4] hover:text-[#0a4d4d] border border-[#0a4d4d]/10'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search pantry..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-full border border-[#0a4d4d]/15 bg-white focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
              />
            </div>
          </div>
        </div>

        {/* Products Grid */}
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <AnimatePresence>
            {filteredItems.map((item, index) => (
              <motion.div
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                key={item.id}
                className={`bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 group ${
                  item.status === 'sold_out' ? 'opacity-75 grayscale-[0.5]' : ''
                }`}
              >
                {/* Image Area */}
                <div className="relative h-64 overflow-hidden bg-gray-100">
                  <img
                    src={item.image}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                    {item.dietary?.map((tag) => (
                      <span key={tag} className="bg-white/95 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase text-[#0a4d4d] shadow-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {item.status === 'limited' && (
                    <div className="absolute top-4 right-4 bg-[#f0e6d2] text-[#0a4d4d] px-3 py-1 rounded-full text-xs font-bold shadow-sm animate-pulse">
                      Low Stock
                    </div>
                  )}
                  {item.status === 'sold_out' && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]">
                      <span className="bg-white text-gray-800 px-4 py-2 rounded-full font-bold shadow-lg transform -rotate-12 border-2 border-gray-800">SOLD OUT</span>
                    </div>
                  )}
                </div>
                
                {/* Content Area */}
                <div className={`p-6 flex flex-col ${expandedItems.has(item.id) ? 'min-h-[220px]' : 'h-[220px]'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-montserrat font-bold text-lg text-[#0a0a0a] leading-tight">{item.name}</h3>
                    <span className="font-bold text-[#0a4d4d] whitespace-nowrap ml-2">EGP {item.price}</span>
                  </div>

                  <div className="mb-4 flex-1">
                    <p className={`text-gray-500 text-sm leading-relaxed ${expandedItems.has(item.id) ? '' : 'line-clamp-2'}`}>{item.description}</p>
                    {item.description && item.description.length > 80 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                        className="text-[#0a4d4d] text-xs font-semibold mt-1 flex items-center gap-1 hover:underline"
                      >
                        {expandedItems.has(item.id) ? (
                          <>Less <ChevronUp className="w-3 h-3" /></>
                        ) : (
                          <>Read more <ChevronDown className="w-3 h-3" /></>
                        )}
                      </button>
                    )}
                  </div>
                  <div className="mt-auto">
                    {item.status === 'sold_out' ? (
                       <Button disabled className="w-full bg-gray-100 text-gray-400 border border-gray-200">Unavailable</Button>
                    ) : (
                      <Button onClick={() => addItem(item)} className="w-full bg-[#0a4d4d] hover:bg-[#06b6d4] text-white transition-all duration-300 shadow-lg hover:shadow-[#06b6d4]/25 h-12 rounded-xl text-base font-semibold group-hover:translate-y-[-2px]">
                        <Plus className="w-4 h-4 mr-2" />Add to Cart
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
        
        {filteredItems.length === 0 && !loading && (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-[#e8f4f4] rounded-full flex items-center justify-center mx-auto mb-4 text-[#0a4d4d]">
              <Search className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">No pantry items found</h3>
            <p className="text-gray-500">Try adjusting your search or filter criteria.</p>
            <Button 
              variant="link" 
              onClick={() => { setSearchQuery(''); setActiveCategory('All'); }}
              className="text-[#0a4d4d] mt-2"
            >
              Clear all filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}