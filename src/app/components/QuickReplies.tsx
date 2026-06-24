import React from 'react';

// This component has been retired as part of the Cacti rebrand.
// Kept as a minimal stub so stale imports don't break the build.
interface QuickRepliesProps {
  replies: string[];
  onSelect: (reply: string) => void;
  disabled?: boolean;
}

export function QuickReplies({ replies, onSelect, disabled }: QuickRepliesProps) {
  return null;
}