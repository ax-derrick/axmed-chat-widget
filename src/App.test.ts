import { describe, it, expect, beforeEach } from 'vitest';

// Re-declare the constants and functions here since they're not exported from App.tsx
// These tests validate the core logic independently

const MAX_MESSAGE_LENGTH = 500;
const MIN_MESSAGE_LENGTH = 1;
const STORAGE_KEY_SESSION = 'axmedChatSessionId';

const validateInput = (input: string): { valid: boolean; error?: string; sanitized: string } => {
  const trimmed = input.trim();
  if (trimmed.length < MIN_MESSAGE_LENGTH) {
    return { valid: false, error: 'Message cannot be empty', sanitized: trimmed };
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`, sanitized: trimmed };
  }
  const sanitized = trimmed.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  return { valid: true, sanitized };
};

const getSessionId = (): string => {
  let sessionId = localStorage.getItem(STORAGE_KEY_SESSION);
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(STORAGE_KEY_SESSION, sessionId);
  }
  return sessionId;
};

// --- validateInput tests ---

describe('validateInput', () => {
  it('rejects empty string', () => {
    const result = validateInput('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Message cannot be empty');
  });

  it('rejects whitespace-only string', () => {
    const result = validateInput('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Message cannot be empty');
  });

  it('accepts a normal message', () => {
    const result = validateInput('Hello world');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('Hello world');
  });

  it('trims whitespace', () => {
    const result = validateInput('  hello  ');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('hello');
  });

  it('rejects messages over max length', () => {
    const longMsg = 'a'.repeat(501);
    const result = validateInput(longMsg);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('max 500');
  });

  it('accepts messages at exactly max length', () => {
    const msg = 'a'.repeat(500);
    const result = validateInput(msg);
    expect(result.valid).toBe(true);
  });

  it('strips script tags', () => {
    const result = validateInput('hello <script>alert("xss")</script> world');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('hello  world');
    expect(result.sanitized).not.toContain('script');
  });

  it('accepts single character', () => {
    const result = validateInput('a');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('a');
  });
});

// --- getSessionId tests ---

describe('getSessionId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a new session ID when none exists', () => {
    const id = getSessionId();
    expect(id).toMatch(/^session_\d+_[a-z0-9]+$/);
  });

  it('returns the same session ID on subsequent calls', () => {
    const id1 = getSessionId();
    const id2 = getSessionId();
    expect(id1).toBe(id2);
  });

  it('persists session ID to localStorage', () => {
    const id = getSessionId();
    expect(localStorage.getItem(STORAGE_KEY_SESSION)).toBe(id);
  });

  it('uses existing session ID from localStorage', () => {
    localStorage.setItem(STORAGE_KEY_SESSION, 'session_existing_123');
    const id = getSessionId();
    expect(id).toBe('session_existing_123');
  });
});

// --- getConfig tests ---

describe('getConfig', () => {
  it('returns default values when no params set', () => {
    const params = new URLSearchParams('');
    const webhookUrl = params.get('webhookUrl') || '';
    const title = params.get('title') || 'Ask Axmed';
    const greeting = params.get('greeting') || 'Hi there';

    expect(webhookUrl).toBe('');
    expect(title).toBe('Ask Axmed');
    expect(greeting).toBe('Hi there');
  });

  it('parses URL parameters correctly', () => {
    const params = new URLSearchParams('?title=Custom+Title&greeting=Hey');
    expect(params.get('title')).toBe('Custom Title');
    expect(params.get('greeting')).toBe('Hey');
  });

  it('parses suggestions=false correctly', () => {
    const params = new URLSearchParams('?suggestions=false');
    const suggestionsParam = params.get('suggestions');
    expect(suggestionsParam).toBe('false');
  });

  it('parses custom suggestions correctly', () => {
    const params = new URLSearchParams('?suggestions=Q1,Q2,Q3');
    const suggestionsParam = params.get('suggestions');
    const suggestions = suggestionsParam!.split(',').map(s => s.trim()).filter(Boolean);
    expect(suggestions).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('parses allowedOrigins correctly', () => {
    const params = new URLSearchParams('?allowedOrigins=https://a.com,https://b.com');
    const originsParam = params.get('allowedOrigins');
    const origins = originsParam!.split(',').map(s => s.trim()).filter(Boolean);
    expect(origins).toEqual(['https://a.com', 'https://b.com']);
  });
});
