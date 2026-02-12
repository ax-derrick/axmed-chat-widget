import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

// Configuration - can be overridden via URL params
const getConfig = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    webhookUrl: params.get('webhookUrl') || 'https://axmed.app.n8n.cloud/webhook/chat',
    greeting: params.get('greeting') || 'Hi there',
    subtitle: params.get('subtitle') || 'How can I help you today?',
    placeholder: params.get('placeholder') || 'Ask me anything...',
    showSuggestions: params.get('suggestions') !== 'false',
  };
};

// Input validation
const MAX_MESSAGE_LENGTH = 500;
const MIN_MESSAGE_LENGTH = 1;

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
  let sessionId = localStorage.getItem('axmedChatSessionId');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem('axmedChatSessionId', sessionId);
  }
  return sessionId;
};

// Types
interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

// Suggested questions
const SUGGESTED_QUESTIONS = [
  'What is Axmed?',
  'Who can buy on Axmed?',
  'How does ordering work?',
  'How do offers work?',
  'How is quality ensured?',
];

function App() {
  const config = getConfig();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (hasMessages) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, hasMessages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Listen for postMessage commands from parent
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.action === 'open') {
        inputRef.current?.focus();
      }
      if (event.data?.action === 'close') {
        // Could be used for cleanup
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const sendMessage = async (content: string) => {
    if (isLoading) return;

    const validation = validateInput(content);
    if (!validation.valid) {
      console.warn('Input validation failed:', validation.error);
      return;
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content: validation.sanitized,
      sender: 'user',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sendMessage',
          sessionId: getSessionId(),
          chatInput: validation.sanitized,
        }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = JSON.parse(responseText);
      const aiMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        content: data.output || data.text || data.message || 'Sorry, I could not process that request.',
        sender: 'ai',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);

      // Notify parent of message sent
      window.parent.postMessage({ event: 'messageSent', data: userMessage }, '*');
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        content: 'Sorry, something went wrong. Please try again.',
        sender: 'ai',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (inputValue.trim() && !isLoading) {
      const message = inputValue;
      setInputValue('');
      sendMessage(message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  return (
    <div className="chat-widget">
      {!hasMessages ? (
        <div className="chat-initial">
          <div className="chat-initial-content">
            <div className="chat-greeting">
              <h2>{config.greeting}</h2>
              <p>{config.subtitle}</p>
            </div>
            <div className="chat-input-box">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={config.placeholder}
                maxLength={MAX_MESSAGE_LENGTH}
                disabled={isLoading}
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
                className="send-btn"
              >
                {isLoading ? (
                  <span className="loading-spinner" />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
                  </svg>
                )}
              </button>
            </div>
            {config.showSuggestions && (
              <div className="chat-suggestions">
                {SUGGESTED_QUESTIONS.map((question, index) => (
                  <button
                    key={index}
                    className="suggestion-pill"
                    onClick={() => {
                      setInputValue(question);
                      inputRef.current?.focus();
                    }}
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
            <div className="chat-disclaimer">
              Axmed AI can make mistakes. Verify important info. <br />
              Check our{' '}
              <a href="https://axmed.com/legal/privacy-policy/" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="chat-conversation">
          <div className="chat-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`message message-${msg.sender}`}>
                {msg.sender === 'user' ? (
                  <div className="message-bubble">{msg.content}</div>
                ) : (
                  <div className="ai-message">
                    <div className="ai-avatar">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                      </svg>
                    </div>
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
                      <div className="ai-actions">
                        <button onClick={() => handleCopy(msg.content)} title="Copy">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="message message-ai">
                <div className="ai-message">
                  <div className="ai-avatar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                  </div>
                  <div className="ai-content loading">
                    <span className="loading-spinner" /> Thinking...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-area">
            <div className="chat-input-box">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell AI what to do next"
                maxLength={MAX_MESSAGE_LENGTH}
                disabled={isLoading}
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
                className="send-btn"
              >
                {isLoading ? (
                  <span className="loading-spinner" />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
                  </svg>
                )}
              </button>
            </div>
            <div className="chat-disclaimer small">
              Axmed AI can make mistakes. Verify important info.{' '}
              <a href="https://axmed.com/legal/privacy-policy/" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
