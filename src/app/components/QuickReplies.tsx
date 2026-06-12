import React from 'react';
import { motion } from 'motion/react';

interface QuickRepliesProps {
  replies: string[];
  onSelect: (reply: string) => void;
  disabled?: boolean;
}

export function QuickReplies({ replies, onSelect, disabled }: QuickRepliesProps) {
  if (replies.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {replies.map((reply, i) => (
        <motion.button
          key={reply}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          onClick={() => onSelect(reply)}
          disabled={disabled}
          className="px-4 py-2 rounded-full border-[1.5px] border-[#D94E28] text-[#D94E28] text-sm font-medium
                     bg-white hover:bg-[#FFF5F2] transition-colors cursor-pointer
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {reply}
        </motion.button>
      ))}
    </div>
  );
}
