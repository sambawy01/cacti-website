import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { ChatMessage } from '../components/ChatMessage';
import { QuickReplies } from '../components/QuickReplies';
import { ProposalCard } from '../components/ProposalCard';
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
  return { role: 'assistant', content: '', quickReplies: [], proposal: null, isWelcome: true };
}

export function PlanBuilderPage() {
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
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        inputRef.current?.focus();
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
    <div className="w-full bg-[#F9F5F0]">
      {/* Header */}
      <section className="bg-gradient-to-br from-[#2C3E50] to-[#1a252f] text-white py-16 md:py-20 px-4 text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#D94E28]/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3" />
        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="w-16 h-16 bg-[#D94E28]/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-8 h-8 text-[#D94E28]" />
          </div>
          <p className="text-[#D94E28] font-semibold text-sm uppercase tracking-[4px] mb-3">AI-Powered</p>
          <h1 className="font-montserrat font-bold text-3xl md:text-5xl mb-4">Corporate Plan Builder</h1>
          <p className="text-gray-400 text-base md:text-lg max-w-lg mx-auto">
            Tell us about your team and we'll design a custom catering plan with pricing in about 2 minutes.
          </p>
        </div>
      </section>

      {/* Embedded Chat — always visible, ready to type */}
      <div className="max-w-3xl mx-auto px-4 -mt-8 relative z-10 pb-16">
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">

          {/* Chat messages area */}
          <div ref={scrollRef} className="p-6 md:p-8 space-y-5 min-h-[300px] max-h-[55vh] overflow-y-auto">
            {messages.map((msg, i) => (
              <React.Fragment key={i}>
                {msg.proposal ? (
                  <ProposalCard proposal={msg.proposal} onModify={handleModify} modifyCount={modifyCount} />
                ) : msg.isWelcome ? (
                  <div className="flex gap-4 items-start">
                    <div className="w-10 h-10 bg-[#D94E28]/10 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-lg">🍽️</span>
                    </div>
                    <div>
                      <p className="text-[#2C3E50] text-sm leading-relaxed">
                        <span className="font-semibold">Welcome!</span> I'll help you design the perfect catering plan for your team — custom menu, pricing, and delivery schedule.
                      </p>
                      <p className="text-[#2C3E50] font-semibold text-sm mt-3">
                        Let's start — what's your company name?
                      </p>
                    </div>
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

          {/* Input — always visible, auto-focused */}
          <div className="border-t border-gray-100 p-5 md:p-6 bg-[#FAFAF8]">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your company name to get started..."
                disabled={isStreaming}
                className="flex-1 px-5 py-4 rounded-xl bg-white border border-gray-200 focus:border-[#D94E28] focus:ring-2 focus:ring-[#D94E28]/20 outline-none text-base transition-all disabled:opacity-50 placeholder:text-gray-400"
              />
              <button
                type="submit"
                disabled={isStreaming || !input.trim()}
                className="w-13 h-13 px-4 rounded-xl bg-[#D94E28] text-white flex items-center justify-center shrink-0 hover:bg-[#c0392b] transition-all hover:shadow-lg hover:shadow-[#D94E28]/25 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
