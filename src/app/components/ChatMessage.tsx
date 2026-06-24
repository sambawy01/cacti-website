import React from 'react';

// This component has been retired as part of the Cacti rebrand.
// Kept as a minimal stub so stale imports don't break the build.
interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  return null;
}