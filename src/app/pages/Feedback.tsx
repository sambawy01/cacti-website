import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Star, ArrowLeft, Check, Loader2 } from 'lucide-react';

import { API_BASE } from '../../lib/apiConfig';

export function FeedbackPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const orderRef = searchParams.get('ref') || '';

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (rating === 0) {
      setError('Please select a star rating.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderRef,
          trackingToken: token,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          rating,
          comment: comment.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Could not submit feedback. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* Header */}
      <div className="bg-[#0a0a0a] py-12">
        <div className="container mx-auto px-4 max-w-2xl text-center">
          <img
            src="/cacti-logo-header-white.png"
            alt="Cacti"
            className="max-w-[160px] mx-auto mb-2"
          />
          <h1 className="font-montserrat font-bold text-2xl text-white mt-2">How was your experience?</h1>
          <p className="text-white/60 text-sm mt-1">
            Your feedback helps us serve you better
            {orderRef && ` · Order ${orderRef}`}
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-lg py-8">
        {submitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="font-montserrat font-bold text-xl text-gray-800 mb-2">Thank you!</h2>
            <p className="text-gray-500 text-sm mb-6">
              We appreciate your feedback. It helps us improve every order.
            </p>
            <Link
              to="/menu"
              className="inline-flex items-center gap-2 text-[#0a4d4d] font-semibold hover:underline"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Menu
            </Link>
          </motion.div>
        ) : (
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-gray-100 space-y-6">
            {/* Star rating */}
            <div className="text-center">
              <label className="text-sm font-semibold text-gray-600 mb-3 block">Rate your order</label>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHover(star)}
                    onMouseLeave={() => setHover(0)}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className={`w-10 h-10 ${
                        star <= (hover || rating)
                          ? 'fill-[#0a4d4d] text-[#0a4d4d]'
                          : 'fill-gray-100 text-gray-200'
                      }`}
                    />
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <p className="text-sm text-gray-500 mt-2">
                  {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
                </p>
              )}
            </div>

            {/* Comment */}
            <div>
              <label className="text-sm font-semibold text-gray-600 mb-2 block">
                Tell us more <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What did you love? What can we do better?"
                rows={4}
                className="w-full p-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d] resize-none"
              />
            </div>

            {/* Name + Email (optional) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Name (optional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full p-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Email (optional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full p-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0a4d4d]/20 focus:border-[#0a4d4d]"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting || rating === 0}
              className="w-full py-3.5 bg-[#0a4d4d] text-white font-bold rounded-xl disabled:opacity-50 hover:bg-[#0a4d4d]/90 transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                </>
              ) : (
                'Submit Feedback'
              )}
            </button>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          Cacti · Mediterranean · Marsa Baghush
        </p>
      </div>
    </div>
  );
}