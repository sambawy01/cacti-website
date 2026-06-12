import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, X, ArrowUp } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { streamChat, getSessionId, checkClientRateLimit, saveMessages, loadMessages, type ChatMessage as ChatMsg } from '../../services/aiService';
import { parseAIMessage } from '../../services/aiMessageParser';

interface WidgetMessage {
  role: 'user' | 'assistant';
  content: string;
  isGreeting?: boolean;
}

const GREETING_CONTENT = "Hi! I'm Bistro Cloud's AI assistant. I can help with:\n• Menu & daily specials\n• Delivery areas & hours\n• Dietary info\n• Corporate catering plans";

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [messages, setMessages] = useState<WidgetMessage[]>(() => {
    const stored = loadMessages('chat');
    if (stored && stored.length > 0) {
      return [{ role: 'assistant' as const, content: GREETING_CONTENT, isGreeting: true }, ...stored.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))];
    }
    return [{ role: 'assistant', content: GREETING_CONTENT, isGreeting: true }];
  });
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setShowBadge(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isOpen) setShowBadge(false);
  }, [isOpen]);

  useEffect(() => {
    const toSave = messages.filter((m) => !m.isGreeting).map((m) => ({ role: m.role, content: m.content }));
    if (toSave.length > 0) saveMessages('chat', toSave);
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    if (!checkClientRateLimit('chat')) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: "You've been chatty! For more help, message us on WhatsApp: wa.me/201221288804",
      }]);
      return;
    }

    const userMsg: WidgetMessage = { role: 'user', content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const history: ChatMsg[] = messages
      .filter((m) => !m.isGreeting)
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: text.trim() });

    let accumulated = '';

    await streamChat('chat', history, getSessionId(), {
      onToken: (token) => {
        accumulated += token;
        setStreamingText(accumulated);
      },
      onDone: () => {
        const parsed = parseAIMessage(accumulated);
        setMessages((prev) => [...prev, { role: 'assistant', content: parsed.text }]);
        setStreamingText('');
        setIsStreaming(false);
      },
      onError: (error) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: error }]);
        setStreamingText('');
        setIsStreaming(false);
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-4 md:right-6 w-[calc(100vw-2rem)] md:w-[380px] h-[520px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-50"
          >
            <div className="bg-[#2C3E50] text-white px-4 py-3 flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 bg-[#D94E28] rounded-full flex items-center justify-center text-xs font-bold">BC</div>
              <div className="flex-1">
                <p className="font-semibold text-sm">Bistro Cloud</p>
                <p className="text-[11px] opacity-70">Usually replies instantly</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-3 bg-[#fafafa]">
              {messages.map((msg, i) => (
                <ChatMessage key={i} role={msg.role} content={msg.content} />
              ))}
              {isStreaming && streamingText && (
                <ChatMessage role="assistant" content={streamingText} isStreaming />
              )}
            </div>

            <form onSubmit={handleSubmit} className="p-3 border-t border-gray-100 flex gap-2 shrink-0">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything..."
                disabled={isStreaming}
                className="flex-1 px-3 py-2 rounded-full bg-[#F9F5F0] border border-gray-200 focus:border-[#D94E28] focus:ring-0 outline-none text-sm disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isStreaming || !input.trim()}
                className="w-9 h-9 rounded-full bg-[#D94E28] text-white flex items-center justify-center shrink-0 hover:bg-[#c0392b] transition-colors disabled:opacity-50"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Welcome tooltip — shows on first visit when badge appears */}
      <AnimatePresence>
        {showBadge && !isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.9 }}
            className="fixed bottom-20 right-4 md:right-6 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 z-50 max-w-[260px] cursor-pointer"
            onClick={() => { setIsOpen(true); setShowBadge(false); }}
          >
            <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white border-r border-b border-gray-100 rotate-45" />
            <p className="text-sm text-[#2C3E50] font-semibold mb-1">Need help? Ask our AI!</p>
            <p className="text-xs text-gray-500">Menu, prices, delivery, dietary info — I can answer instantly.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating bubble */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 md:right-6 w-[64px] h-[64px] bg-[#D94E28] rounded-full flex items-center justify-center shadow-xl shadow-[#D94E28]/40 hover:scale-110 transition-transform z-50"
      >
        {isOpen ? (
          <X className="w-7 h-7 text-white" />
        ) : (
          <MessageCircle className="w-7 h-7 text-white" />
        )}

        {showBadge && !isOpen && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.5, repeat: 2 }}
            className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-[#27AE60] border-2 border-white rounded-full"
          />
        )}
      </button>
    </>
  );
}
