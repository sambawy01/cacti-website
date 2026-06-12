import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, X, Sparkles } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { QuickReplies } from './QuickReplies';
import { ProposalCard } from './ProposalCard';
import { streamChat, getSessionId, checkClientRateLimit, saveMessages, loadMessages, type ChatMessage as ChatMsg } from '../../services/aiService';
import { parseAIMessage, type Proposal } from '../../services/aiMessageParser';

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  rawContent?: string;
  quickReplies: string[];
  proposal: Proposal | null;
  isWelcome?: boolean;
}

function makeWelcomeMessage(): DisplayMessage {
  return {
    role: 'assistant',
    content: '',
    quickReplies: [],
    proposal: null,
    isWelcome: true,
  };
}

interface PlanBuilderChatProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PlanBuilderChat({ isOpen, onClose }: PlanBuilderChatProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    const stored = loadMessages('plan-builder');
    if (stored && stored.length > 0) {
      return stored.map((m) => {
        const parsed = m.role === 'assistant' ? parseAIMessage(m.content) : { text: m.content, quickReplies: [], proposal: null };
        return { role: m.role as 'user' | 'assistant', content: m.role === 'assistant' ? parsed.text : m.content, quickReplies: parsed.quickReplies, proposal: parsed.proposal };
      });
    }
    return [makeWelcomeMessage()];
  });
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [modifyCount, setModifyCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toSave = messages.filter((m) => !m.isWelcome).map((m) => ({
      role: m.role,
      content: m.rawContent || m.content,
    }));
    if (toSave.length > 0) saveMessages('plan-builder', toSave);
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;

    if (!checkClientRateLimit('plan-builder')) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: "You've been chatty! For more help, message us on WhatsApp.",
        quickReplies: [],
        proposal: null,
      }]);
      return;
    }

    const userMsg: DisplayMessage = { role: 'user', content: text.trim(), quickReplies: [], proposal: null };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const history: ChatMsg[] = messages
      .filter((m) => !m.isWelcome)
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: text.trim() });

    let accumulated = '';

    await streamChat('plan-builder', history, getSessionId(), {
      onToken: (token) => {
        accumulated += token;
        setStreamingText(accumulated);
      },
      onDone: () => {
        const parsed = parseAIMessage(accumulated);
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: parsed.text,
          rawContent: accumulated,
          quickReplies: parsed.quickReplies,
          proposal: parsed.proposal,
        }]);
        setStreamingText('');
        setIsStreaming(false);
      },
      onError: (error) => {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: error,
          quickReplies: [],
          proposal: null,
        }]);
        setStreamingText('');
        setIsStreaming(false);
      },
    });
  };

  const handleModify = () => {
    setModifyCount((c) => c + 1);
    sendMessage("I'd like to modify this plan.");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Chat Window */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[520px] md:h-[680px] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden z-50"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#2C3E50] to-[#1a252f] text-white px-6 py-4 flex items-center gap-4 shrink-0">
              <div className="w-11 h-11 bg-[#D94E28] rounded-xl flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-montserrat font-bold text-base">Corporate Plan Builder</h3>
                <p className="text-gray-400 text-xs">AI-powered — takes ~2 minutes</p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#FAFAF8]">
              {messages.map((msg, i) => (
                <React.Fragment key={i}>
                  {msg.proposal ? (
                    <ProposalCard proposal={msg.proposal} onModify={handleModify} modifyCount={modifyCount} />
                  ) : msg.isWelcome ? (
                    <div className="text-center py-6">
                      <div className="w-16 h-16 bg-[#D94E28]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <span className="text-3xl">🍽️</span>
                      </div>
                      <h2 className="font-montserrat font-bold text-lg text-[#2C3E50] mb-2">
                        Let's Build Your Plan!
                      </h2>
                      <p className="text-gray-500 text-sm leading-relaxed max-w-xs mx-auto mb-4">
                        I'll design the perfect catering plan for your team — custom menu, pricing, and delivery.
                      </p>
                      <p className="text-[#2C3E50] font-semibold text-sm">
                        What's your company name?
                      </p>
                    </div>
                  ) : (
                    <ChatMessage role={msg.role} content={msg.content} />
                  )}
                  {i === messages.length - 1 && msg.quickReplies.length > 0 && !isStreaming && (
                    <QuickReplies replies={msg.quickReplies} onSelect={sendMessage} disabled={isStreaming} />
                  )}
                </React.Fragment>
              ))}

              {isStreaming && streamingText && (
                <ChatMessage role="assistant" content={streamingText} isStreaming />
              )}
            </div>

            {/* Input */}
            <div className="border-t border-gray-100 p-4 bg-white shrink-0">
              <form onSubmit={handleSubmit} className="flex gap-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your answer..."
                  disabled={isStreaming}
                  autoFocus
                  className="flex-1 px-4 py-3 rounded-xl bg-[#F9F5F0] border border-gray-200 focus:border-[#D94E28] focus:ring-1 focus:ring-[#D94E28]/20 outline-none text-sm transition-all disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isStreaming || !input.trim()}
                  className="w-11 h-11 rounded-xl bg-[#D94E28] text-white flex items-center justify-center shrink-0 hover:bg-[#c0392b] transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
