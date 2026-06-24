import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { Button } from '../components/ui/button';

export function OrderingPage() {
  return (
    <div className="bg-[#f5f5f0] min-h-screen py-16">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-[#0a4d4d]/10 text-[#0a4d4d] rounded-full flex items-center justify-center mx-auto mb-6">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <h1 className="font-montserrat font-bold text-4xl mb-4 text-[#0a0a0a]">Ordering</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Order ahead for pickup or beachside delivery at Cacti. Browse our menu, add items to your cart, and check out in minutes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 text-center">
            <div className="w-14 h-14 bg-[#0a4d4d]/10 text-[#0a4d4d] rounded-full flex items-center justify-center mx-auto mb-4">
              <UtensilsCrossed className="w-7 h-7" />
            </div>
            <h2 className="font-montserrat font-bold text-xl mb-2 text-[#0a0a0a]">Browse the Menu</h2>
            <p className="text-gray-500 text-sm mb-6">
              Explore our Mediterranean seafood, meze, and sunset specials.
            </p>
            <Link to="/menu">
              <Button className="w-full">View Menu</Button>
            </Link>
          </div>

          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 text-center">
            <div className="w-14 h-14 bg-[#0a4d4d]/10 text-[#0a4d4d] rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-7 h-7" />
            </div>
            <h2 className="font-montserrat font-bold text-xl mb-2 text-[#0a0a0a]">Opening Hours</h2>
            <p className="text-gray-500 text-sm mb-2">Mon - Sun</p>
            <p className="text-[#0a4d4d] font-semibold mb-6">12:00 PM - 2:00 AM</p>
            <p className="text-gray-400 text-xs">
              Orders placed through the menu go straight to our kitchen.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-gray-100 text-center">
          <h2 className="font-montserrat font-bold text-2xl mb-3 text-[#0a0a0a]">How to Order</h2>
          <ol className="text-left max-w-md mx-auto space-y-4 text-gray-600">
            <li className="flex gap-3">
              <span className="w-7 h-7 rounded-full bg-[#0a4d4d] text-white font-bold text-sm flex items-center justify-center shrink-0">1</span>
              <span>Head to the menu and add your favourite dishes to the cart.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-7 h-7 rounded-full bg-[#0a4d4d] text-white font-bold text-sm flex items-center justify-center shrink-0">2</span>
              <span>Open the cart, enter your details, and pick a time slot.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-7 h-7 rounded-full bg-[#0a4d4d] text-white font-bold text-sm flex items-center justify-center shrink-0">3</span>
              <span>Place your order — we'll confirm and have it ready for you.</span>
            </li>
          </ol>
          <Link to="/menu" className="inline-block mt-8">
            <Button size="lg" className="px-8">Start an Order</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}