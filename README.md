# Axmed Chat Widget

An embeddable chat widget built with React + TypeScript that connects to an n8n webhook backend. Designed to be embedded as an iframe on any website.

**Live demo:** https://ax-derrick.github.io/axmed-chat-widget/

## Features

- **Webhook-powered** -- connects to any n8n (or compatible) webhook endpoint
- **Markdown responses** -- AI replies render with full Markdown support (GFM)
- **Feedback system** -- thumbs up/down on AI responses, sent to backend for tracking
- **Retry on error** -- failed messages show a retry button
- **Session persistence** -- messages and feedback persist across page reloads via localStorage
- **Customizable** -- theme colors, fonts, border radius, logo, greeting, and suggestions via URL params
- **Embeddable** -- iframe-based with postMessage API for parent page communication
- **Accessible** -- ARIA live regions, aria-labels, keyboard navigation
- **Rate limited** -- client-side cooldown on message sends and feedback clicks
- **Typing indicator** -- notifies parent page when user is typing

## Quick Start

```bash
# Install dependencies
npm install

# Create .env file with your webhook URL
cp .env.example .env
# Edit .env and set VITE_WEBHOOK_URL

# Start dev server
npm run dev
```

## Embedding

Add this iframe to any page:

```html
<iframe
  src="https://ax-derrick.github.io/axmed-chat-widget/"
  style="width: 400px; height: 600px; border: none; border-radius: 12px;"
></iframe>
```

### Floating Chat Button Example

```html
<button id="chat-toggle" onclick="toggleChat()" style="
  position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px;
  border-radius: 50%; border: none; background: #261C7A; color: white;
  cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 9999;
">Chat</button>

<iframe
  id="axmed-chat"
  src="https://ax-derrick.github.io/axmed-chat-widget/"
  style="
    display: none; position: fixed; bottom: 96px; right: 24px;
    width: 400px; height: 600px; border: none; border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15); z-index: 9998;
  "
></iframe>

<script>
function toggleChat() {
  const chat = document.getElementById('axmed-chat');
  chat.style.display = chat.style.display === 'none' ? 'block' : 'none';
}

window.addEventListener('message', (e) => {
  if (e.origin !== 'https://ax-derrick.github.io') return;
  if (e.data?.event === 'close') {
    document.getElementById('axmed-chat').style.display = 'none';
  }
});
</script>
```

## URL Parameters

Customize the widget by appending query params to the iframe `src`:

| Parameter | Default | Description |
|---|---|---|
| `webhookUrl` | env var | Webhook endpoint URL |
| `title` | `Ask Axmed` | Header title |
| `greeting` | `Hi there` | Welcome screen greeting |
| `subtitle` | `What would you like...` | Welcome screen subtitle |
| `placeholder` | `Type your message...` | Input placeholder text |
| `primaryColor` | `#261C7A` | Brand color (hex, URL-encode `#` as `%23`) |
| `fontFamily` | `Figtree` | Google Font name |
| `borderRadius` | `12` | Corner radius in px |
| `logoUrl` | sparkle icon | URL to a custom logo image |
| `suggestions` | default list | Comma-separated questions, or `false` to hide |
| `autoOpen` | `false` | Send `open` event to parent on load |
| `disclaimerText` | default | Custom disclaimer text |
| `allowedOrigins` | `axmed.com, ax-derrick.github.io` | Comma-separated origins for postMessage |

**Example:**
```
?title=Support&primaryColor=%23ff6600&suggestions=false&autoOpen=true
```

## PostMessage Events

The widget communicates with the parent page via `postMessage`:

| Event | Data | Description |
|---|---|---|
| `close` | -- | User clicked the close button |
| `open` | -- | autoOpen triggered on load |
| `messageSent` | `{ id, content, sender }` | User sent a message |
| `feedback` | `{ messageId, type }` | User clicked thumbs up/down |
| `typing` | `{ isTyping: boolean }` | User started/stopped typing |

## Webhook Payload

The widget sends JSON POST requests to the configured webhook:

**Send message:**
```json
{
  "action": "sendMessage",
  "sessionId": "session_123_abc",
  "messageId": "1234567890-abc",
  "chatInput": "Hello"
}
```

**Feedback:**
```json
{
  "action": "feedback",
  "sessionId": "session_123_abc",
  "messageId": "ai-message-id",
  "userMessageId": "user-message-id",
  "feedbackType": "up"
}
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and build for production |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run deploy` | Build and deploy to GitHub Pages |

## Tech Stack

- React 19 + TypeScript
- Vite
- react-markdown + remark-gfm
- Vitest + jsdom
- gh-pages for deployment
