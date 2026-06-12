import React from 'react';
import { motion } from 'motion/react';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-4`}
    >
      <div
        className={`max-w-[80%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-[#D94E28] text-white rounded-[16px_16px_4px_16px]'
            : 'bg-[#f0ece7] text-gray-800 rounded-[16px_16px_16px_4px]'
        }`}
      >
        {content}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-1 bg-current opacity-70 animate-pulse rounded-sm" />
        )}
      </div>
    </motion.div>
  );
}
