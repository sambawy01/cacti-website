import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import type { Proposal } from '../../services/aiMessageParser';
import { submitCateringInquiry } from '../../services/crmService';

interface ProposalCardProps {
  proposal: Proposal;
  onModify: () => void;
  modifyCount: number;
}

export function ProposalCard({ proposal, onModify, modifyCount }: ProposalCardProps) {
  const [status, setStatus] = useState<'idle' | 'booking' | 'booked' | 'error'>('idle');

  const handleBook = async () => {
    setStatus('booking');
    const result = await submitCateringInquiry({
      name: proposal.contact.name,
      company: proposal.company,
      email: proposal.contact.email,
      phone: proposal.contact.phone,
      eventType: `Corporate Plan - ${proposal.frequency}`,
      guestCount: String(proposal.headcount),
      eventDate: 'Recurring',
      location: proposal.location,
      menuPreferences: `AI-generated plan: ${proposal.menuRotation.map(m => `${m.day}: ${m.theme}`).join(', ')}. Dietary: ${proposal.dietary.join(', ')}. Budget: ${proposal.pricing.currency} ${proposal.pricing.perPersonPerDay}/person/day.`,
    });
    setStatus(result.success ? 'booked' : 'error');
  };

  if (status === 'booked') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-4 p-8 bg-white rounded-2xl border border-green-200 text-center"
      >
        <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="font-montserrat font-bold text-xl text-[#2C3E50] mb-2">Plan Booked!</h3>
        <p className="text-gray-500">We'll reach out within 2 hours to finalize your plan.</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden"
    >
      <div className="p-6 text-center border-b border-gray-100">
        <p className="text-xs font-semibold text-[#D94E28] uppercase tracking-[2px] mb-1">Your Custom Plan</p>
        <h3 className="font-montserrat font-bold text-xl text-[#2C3E50]">
          {proposal.company} — {proposal.frequency.charAt(0).toUpperCase() + proposal.frequency.slice(1)} Catering
        </h3>
        <p className="text-gray-400 text-sm mt-1">
          {proposal.headcount} people · {proposal.location}
        </p>
      </div>

      <div className="p-6 border-b border-gray-100">
        <h4 className="font-semibold text-[#2C3E50] mb-3">Recommended Menu Rotation</h4>
        <div className="grid grid-cols-2 gap-2">
          {proposal.menuRotation.map((item) => (
            <div key={item.day} className="bg-[#F9F5F0] px-3 py-2 rounded-lg text-sm">
              <span className="font-semibold">{item.day}:</span> {item.theme}
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 flex items-end justify-between">
        <div>
          <p className="text-xs text-gray-400">Estimated weekly cost</p>
          <p className="font-bold text-2xl text-[#2C3E50]">
            {proposal.pricing.currency} {proposal.pricing.weeklyTotal.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400">
            ~{proposal.pricing.currency} {proposal.pricing.perPersonPerDay}/person/day
          </p>
        </div>
        <div className="text-right">
          {proposal.pricing.discounts.map((d) => (
            <p key={d} className="text-xs text-green-600 font-semibold">✓ {d}</p>
          ))}
        </div>
      </div>

      <div className="p-6 pt-0 space-y-2">
        <Button
          onClick={handleBook}
          disabled={status === 'booking'}
          className="w-full h-12 text-base rounded-xl shadow-lg shadow-[#D94E28]/20"
        >
          {status === 'booking' ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Booking...
            </span>
          ) : status === 'error' ? (
            'Try Again'
          ) : (
            'Book This Plan →'
          )}
        </Button>
        {modifyCount < 3 ? (
          <button
            onClick={onModify}
            className="w-full text-center text-sm text-[#D94E28] hover:underline py-1"
          >
            Modify this plan
          </button>
        ) : (
          <p className="text-center text-xs text-gray-400">
            For further changes, <a href="https://wa.me/201221288804" target="_blank" rel="noopener noreferrer" className="text-[#D94E28] underline">message us on WhatsApp</a>
          </p>
        )}
      </div>
    </motion.div>
  );
}
