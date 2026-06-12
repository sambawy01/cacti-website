// src/services/aiMessageParser.ts

export interface Proposal {
  type: 'proposal';
  company: string;
  contact: { name: string; email: string; phone: string };
  headcount: number;
  frequency: string;
  location: string;
  dietary: string[];
  menuRotation: { day: string; theme: string }[];
  pricing: {
    perPersonPerDay: number;
    weeklyTotal: number;
    currency: string;
    discounts: string[];
  };
}

export interface ParsedMessage {
  text: string;              // Message text with JSON blocks stripped
  quickReplies: string[];    // Quick reply suggestions (empty if none)
  proposal: Proposal | null; // Proposal object (null if none)
}

const JSON_FENCE_REGEX = /```json\s*\n?([\s\S]*?)```/g;

export function parseAIMessage(content: string): ParsedMessage {
  let text = content;
  let quickReplies: string[] = [];
  let proposal: Proposal | null = null;

  const matches = [...content.matchAll(JSON_FENCE_REGEX)];

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);

      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        quickReplies = parsed;
        text = text.replace(match[0], '').trim();
      } else if (parsed && parsed.type === 'proposal') {
        proposal = parsed as Proposal;
        text = text.replace(match[0], '').trim();
      }
    } catch {
      // Malformed JSON — leave it in the text
    }
  }

  return { text, quickReplies, proposal };
}
