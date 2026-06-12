// src/services/aiService.ts

const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || 'http://localhost:54321/functions/v1/ai-chat';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export async function streamChat(
  mode: 'chat' | 'plan-builder',
  messages: ChatMessage[],
  sessionId: string,
  callbacks: StreamCallbacks
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, messages, sessionId }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      callbacks.onError("We're getting a lot of questions right now. Try again in a few minutes or message us on WhatsApp.");
      return;
    }

    if (!response.ok || !response.body) {
      callbacks.onError('Our AI is taking a break. Please try again or message us on WhatsApp.');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);
          if (data.error) {
            callbacks.onError(data.error);
            return;
          }
          if (data.done) {
            callbacks.onDone();
            return;
          }
          if (data.token) {
            callbacks.onToken(data.token);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Stream closed without done event — treat as done
    callbacks.onDone();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      callbacks.onError('Our AI is taking a break. Please try again or message us on WhatsApp.');
    } else {
      callbacks.onError('Connection lost. Please try again or message us on WhatsApp.');
    }
  }
}

const SESSION_KEY = 'bistro-ai-session-id';
const ACTIVITY_KEY = 'bistro-ai-last-activity';
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function checkSessionExpiry(): void {
  const lastActivity = localStorage.getItem(ACTIVITY_KEY);
  if (lastActivity && Date.now() - parseInt(lastActivity) > EXPIRY_MS) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('bistro-ai-')) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }
}

export function touchSession(): void {
  localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

export function getSessionId(): string {
  checkSessionExpiry();
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  touchSession();
  return id;
}

export function checkClientRateLimit(mode: 'chat' | 'plan-builder'): boolean {
  checkSessionExpiry();
  const sessionId = getSessionId();
  const key = `bistro-ai-count-${mode}-${sessionId}`;
  const MAX = 20;

  const count = parseInt(localStorage.getItem(key) || '0');
  if (count >= MAX) return false;

  localStorage.setItem(key, String(count + 1));
  touchSession();
  return true;
}

export function saveMessages(mode: 'chat' | 'plan-builder', messages: Array<{ role: string; content: string }>): void {
  localStorage.setItem(`bistro-ai-messages-${mode}`, JSON.stringify(messages));
  touchSession();
}

export function loadMessages(mode: 'chat' | 'plan-builder'): Array<{ role: string; content: string }> | null {
  checkSessionExpiry();
  const stored = localStorage.getItem(`bistro-ai-messages-${mode}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}
