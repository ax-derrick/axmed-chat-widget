import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

// Color utilities — derive lighter/darker shades from a hex color
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
};

const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

const lighten = (hex: string, amount: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
};

const darken = (hex: string, amount = 0.15): string => {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
};

// Default suggested questions
const DEFAULT_SUGGESTIONS = [
  'What is Axmed?',
  'Who can buy on Axmed?',
  'How does ordering work?',
  'How do offers work?',
  'How is quality ensured?',
];

// Constants
const MAX_MESSAGE_LENGTH = 500;
const MIN_MESSAGE_LENGTH = 1;
const API_TIMEOUT_MS = 30000;
const RATE_LIMIT_MS = 2000; // Min time between sends
const STORAGE_KEY_MESSAGES = 'axmedChatMessages';
const STORAGE_KEY_SESSION = 'axmedChatSessionId';
const STORAGE_KEY_FEEDBACK = 'axmedChatFeedback';
const DEFAULT_ALLOWED_ORIGINS = ['https://axmed.com', 'https://ax-derrick.github.io'];

// Configuration - can be overridden via URL params and env vars
const getConfig = () => {
  const params = new URLSearchParams(window.location.search);

  // Parse suggestions: "false" = hide, comma-separated = custom, absent = defaults
  const suggestionsParam = params.get('suggestions');
  let suggestions: string[] | false;
  if (suggestionsParam === 'false') {
    suggestions = false;
  } else if (suggestionsParam) {
    suggestions = suggestionsParam.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    suggestions = DEFAULT_SUGGESTIONS;
  }

  // Parse allowed origins for postMessage security
  const originsParam = params.get('allowedOrigins');
  const allowedOrigins = originsParam
    ? originsParam.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  return {
    webhookUrl: params.get('webhookUrl') || import.meta.env.VITE_WEBHOOK_URL || '',
    title: params.get('title') || 'Ask Axmed',
    greeting: params.get('greeting') || 'Hi there',
    subtitle: params.get('subtitle') || 'What would you like\nto dig deeper on today?',
    placeholder: params.get('placeholder') || 'Type your message...',
    suggestions: suggestions as string[] | false,
    primaryColor: params.get('primaryColor') || null,
    fontFamily: params.get('fontFamily') || null,
    borderRadius: params.get('borderRadius') ? parseInt(params.get('borderRadius')!, 10) : null,
    logoUrl: params.get('logoUrl') || null,
    autoOpen: params.get('autoOpen') === 'true',
    showCloseButton: params.get('showCloseButton') !== 'false',
    disclaimerText: params.get('disclaimerText') || null,
    allowedOrigins,
  };
};

// Input validation
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

// Session management
const getSessionId = (): string => {
  let sessionId = localStorage.getItem(STORAGE_KEY_SESSION);
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(STORAGE_KEY_SESSION, sessionId);
  }
  return sessionId;
};

// Types
interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: string;
  replyTo?: string; // user message ID that this AI message is responding to
  isSystem?: boolean; // system-generated messages (e.g. support follow-up)
  failedInput?: string; // original user input for retry on error
}

// Persistence helpers
const loadMessages = (): ChatMessage[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_MESSAGES);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveMessages = (messages: ChatMessage[]) => {
  localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
};

const loadFeedback = (): Record<string, 'up' | 'down'> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FEEDBACK);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const saveFeedback = (feedback: Record<string, 'up' | 'down'>) => {
  localStorage.setItem(STORAGE_KEY_FEEDBACK, JSON.stringify(feedback));
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

function App() {
  const config = useMemo(() => getConfig(), []);
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>(loadFeedback);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSendRef = useRef(0);
  const lastFeedbackRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const isTypingRef = useRef(false);

  const hasMessages = messages.length > 0;

  // Post message to parent with origin restriction (only when embedded in an iframe)
  const isEmbedded = window.parent !== window;
  const postToParent = useCallback((data: unknown) => {
    if (!isEmbedded) return;
    config.allowedOrigins.forEach(origin => {
      try {
        window.parent.postMessage(data, origin);
      } catch {
        // Silently ignore if origin doesn't match
      }
    });
  }, [isEmbedded, config.allowedOrigins]);

  // Notify parent of typing status (debounced — stops after 1s of inactivity)
  const notifyTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      postToParent({ event: 'typing', data: { isTyping: true } });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      postToParent({ event: 'typing', data: { isTyping: false } });
    }, 1000);
  }, [postToParent]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // Apply theme overrides via CSS variables
  useEffect(() => {
    const root = document.documentElement;

    if (config.primaryColor) {
      const color = config.primaryColor;
      root.style.setProperty('--color-primary', color);
      root.style.setProperty('--color-primary-hover', darken(color));
      root.style.setProperty('--color-primary-light', lighten(color, 0.9));
      root.style.setProperty('--color-primary-ultra-light', lighten(color, 0.95));
      root.style.setProperty('--gradient-initial', `linear-gradient(180deg, #ffffff 0%, ${lighten(color, 0.9)} 60%, ${lighten(color, 0.85)} 100%)`);
      root.style.setProperty('--color-bg-user-bubble', lighten(color, 0.92));
    }

    if (config.borderRadius !== null) {
      const br = config.borderRadius;
      root.style.setProperty('--radius-sm', `${Math.max(br - 4, 2)}px`);
      root.style.setProperty('--radius-md', `${br}px`);
      root.style.setProperty('--radius-lg', `${br + 4}px`);
      root.style.setProperty('--radius-xl', `${br * 2}px`);
    }

    if (config.fontFamily) {
      const link = document.createElement('link');
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(config.fontFamily)}:wght@400;500;600;700&display=swap`;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      document.body.style.fontFamily = `'${config.fontFamily}', -apple-system, BlinkMacSystemFont, sans-serif`;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (hasMessages) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, hasMessages]);

  // Focus input on mount and when transitioning to conversation
  useEffect(() => {
    inputRef.current?.focus();
  }, [hasMessages]);

  // Notify parent to open the widget on load if autoOpen is enabled
  useEffect(() => {
    if (config.autoOpen) {
      postToParent({ event: 'open' });
    }
  }, [config.autoOpen, postToParent]);

  // Listen for postMessage commands from parent (with origin check)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!config.allowedOrigins.includes(event.origin)) return;
      if (event.data?.action === 'open') {
        inputRef.current?.focus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [config.allowedOrigins]);

  const sendMessage = async (content: string) => {
    if (isLoading) return;
    const now = Date.now();
    if (now - lastSendRef.current < RATE_LIMIT_MS) return;
    lastSendRef.current = now;

    if (!config.webhookUrl) {
      console.error('No webhook URL configured. Set VITE_WEBHOOK_URL in .env or pass ?webhookUrl= param.');
      const errMsg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        content: 'Chat is not configured. No webhook URL found.',
        sender: 'ai',
        timestamp: new Date().toISOString(),
        isSystem: true,
      };
      setMessages((prev) => [...prev, errMsg]);
      return;
    }

    const validation = validateInput(content);
    if (!validation.valid) {
      console.warn('Input validation failed:', validation.error);
      return;
    }

    // Set loading immediately to prevent double-sends
    setIsLoading(true);

    const userMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content: validation.sanitized,
      sender: 'user',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    // Clear typing indicator immediately on send
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      postToParent({ event: 'typing', data: { isTyping: false } });
    }

    // AbortController for 30s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sendMessage',
          sessionId: getSessionId(),
          messageId: userMessage.id,
          chatInput: validation.sanitized,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = JSON.parse(responseText);
      const aiMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        content: data.output || data.text || data.message || 'Sorry, I could not process that request.',
        sender: 'ai',
        timestamp: new Date().toISOString(),
        replyTo: userMessage.id,
      };
      setMessages((prev) => [...prev, aiMessage]);

      postToParent({ event: 'messageSent', data: userMessage });
    } catch (error) {
      clearTimeout(timeoutId);

      const isTimeout = error instanceof DOMException && error.name === 'AbortError';
      const errorMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        content: isTimeout
          ? 'The request timed out.'
          : 'Sorry, something went wrong.',
        sender: 'ai',
        timestamp: new Date().toISOString(),
        isSystem: true,
        failedInput: validation.sanitized,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (inputValue.trim() && !isLoading) {
      sendMessage(inputValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRetry = (errorMsgId: string, originalInput: string) => {
    // Remove the error message and the failed user message before it
    setMessages((prev) => {
      const errorIdx = prev.findIndex(m => m.id === errorMsgId);
      if (errorIdx < 1) return prev;
      // Remove the user message right before the error + the error itself
      return [...prev.slice(0, errorIdx - 1), ...prev.slice(errorIdx + 1)];
    });
    sendMessage(originalInput);
  };

  const handleCopy = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFeedback = async (messageId: string, type: 'up' | 'down') => {
    const now = Date.now();
    if (now - lastFeedbackRef.current < RATE_LIMIT_MS) return;
    lastFeedbackRef.current = now;

    // Update visual state
    const newFeedback = { ...feedback, [messageId]: type };
    setFeedback(newFeedback);
    saveFeedback(newFeedback);

    // Find the AI message to get the linked user message ID
    const aiMsg = messages.find(m => m.id === messageId);

    // Notify parent
    postToParent({ event: 'feedback', data: { messageId, type } });

    // Send feedback to N8N backend
    try {
      await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'feedback',
          sessionId: getSessionId(),
          messageId,
          userMessageId: aiMsg?.replyTo || null,
          feedbackType: type,
        }),
      });
    } catch {
      // Feedback logging is best-effort
    }

    // Thumbs down: add a support follow-up message
    if (type === 'down') {
      const supportMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        content: "I'm sorry this wasn't helpful. Please reach out to our support team at **support@axmed.com** for further assistance.",
        sender: 'ai',
        timestamp: new Date().toISOString(),
        isSystem: true,
      };
      setMessages((prev) => [...prev, supportMessage]);
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY_MESSAGES);
    localStorage.removeItem(STORAGE_KEY_FEEDBACK);
    setFeedback({});
    // Generate a new session ID
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem(STORAGE_KEY_SESSION, newSessionId);
  };

  const disclaimerContent = config.disclaimerText || (
    <>
      Axmed AI can make mistakes. Verify important info. <br />
      Check our{' '}
      <a href="https://axmed.com/legal/privacy-policy/" target="_blank" rel="noopener noreferrer">
        Privacy Policy
      </a>
    </>
  );

  // Shared input box renderer to avoid duplication
  const charCount = inputValue.length;
  const showCharCount = charCount > MAX_MESSAGE_LENGTH * 0.5;
  const isNearLimit = charCount > MAX_MESSAGE_LENGTH * 0.95;

  const renderInputBox = () => (
    <div className="chat-input-box">
      <textarea
        ref={inputRef}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          notifyTyping();
          // Auto-resize: reset to 1 row then expand to scrollHeight
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={handleKeyDown}
        placeholder={config.placeholder}
        maxLength={MAX_MESSAGE_LENGTH}
        disabled={isLoading}
        rows={1}
      />
      {showCharCount && (
        <span className={`char-count ${isNearLimit ? 'char-count-warn' : ''}`}>
          {charCount}/{MAX_MESSAGE_LENGTH}
        </span>
      )}
      <button
        onClick={handleSend}
        disabled={!inputValue.trim() || isLoading}
        className="send-btn"
        aria-label="Send message"
      >
        {isLoading ? (
          <span className="loading-spinner" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        )}
      </button>
    </div>
  );

  return (
    <div className="chat-widget">
      {/* Header */}
      <div className="chat-header">
        <span className="chat-header-title">{config.title}</span>
        <div className="chat-header-actions">
          {hasMessages && (
            <button
              className="chat-header-btn"
              onClick={handleNewConversation}
              aria-label="New conversation"
              title="New conversation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </button>
          )}
          {config.showCloseButton && (
            <button
              className="chat-header-btn"
              onClick={() => postToParent({ event: 'close' })}
              aria-label="Close chat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!hasMessages ? (
        /* ====== Initial Screen ====== */
        <div className="chat-initial">
          <div className="chat-initial-spacer" />

          <div className="chat-initial-content">
            {/* Greeting */}
            <div className="chat-greeting">
              <h2>{config.greeting}</h2>
              <p>{config.subtitle}</p>
            </div>

            {/* Suggestions — vertical list */}
            {config.suggestions !== false && (
              <div className="chat-suggestions">
                {config.suggestions.map((question, index) => (
                  <button
                    key={index}
                    className="suggestion-item"
                    onClick={() => sendMessage(question)}
                    disabled={isLoading}
                  >
                    <span className="suggestion-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </span>
                    <span className="suggestion-text">{question}</span>
                    <span className="suggestion-arrow">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Input box */}
            {renderInputBox()}

            {/* Disclaimer */}
            <div className="chat-disclaimer">{disclaimerContent}</div>
          </div>
        </div>
      ) : (
        /* ====== Conversation View ====== */
        <div className="chat-conversation">
          <div className="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`message message-${msg.sender}`}>
                {msg.sender === 'user' ? (
                  <div className="user-message-wrapper">
                    <span className="message-time">{formatTime(msg.timestamp)}</span>
                    <div className="message-bubble">{msg.content}</div>
                  </div>
                ) : (
                  <div className="ai-message">
                    <div className="ai-content">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    {msg.failedInput && (
                      <button
                        className="retry-btn"
                        onClick={() => handleRetry(msg.id, msg.failedInput!)}
                        disabled={isLoading}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                        </svg>
                        Retry
                      </button>
                    )}
                    <div className="ai-actions">
                      {!msg.isSystem && <>
                        {/* Copy button */}
                        <button
                          onClick={() => handleCopy(msg.id, msg.content)}
                          title={copiedId === msg.id ? 'Copied!' : 'Copy'}
                          aria-label={copiedId === msg.id ? 'Copied' : 'Copy message'}
                          className={`action-btn ${copiedId === msg.id ? 'action-btn-active' : ''}`}
                        >
                          {copiedId === msg.id ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                            </svg>
                          )}
                        </button>
                        {/* Thumbs up */}
                        <button
                          onClick={() => feedback[msg.id] !== 'up' && handleFeedback(msg.id, 'up')}
                          title="Helpful"
                          aria-label="Mark as helpful"
                          aria-pressed={feedback[msg.id] === 'up'}
                          className={`action-btn ${feedback[msg.id] === 'up' ? 'action-btn-active' : ''}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback[msg.id] === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z" />
                            <path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
                          </svg>
                        </button>
                        {/* Thumbs down */}
                        <button
                          onClick={() => feedback[msg.id] !== 'down' && handleFeedback(msg.id, 'down')}
                          title="Not helpful"
                          aria-label="Mark as not helpful"
                          aria-pressed={feedback[msg.id] === 'down'}
                          className={`action-btn ${feedback[msg.id] === 'down' ? 'action-btn-down' : ''}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback[msg.id] === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z" />
                            <path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
                          </svg>
                        </button>
                      </>}
                      <span className="message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="message message-ai" role="status" aria-label="Loading response">
                <div className="ai-message">
                  <div className="ai-content loading">
                    <span className="loading-dots">
                      <span /><span /><span />
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="chat-input-area">
            {renderInputBox()}
            <div className="chat-disclaimer small">{disclaimerContent}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
