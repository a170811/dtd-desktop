# Tauri LLM Chatbot — Design Spec

**Date:** 2026-03-24
**Status:** Approved

---

## Overview

A desktop chatbot application built with Tauri 2.x. Users can create multiple chat sessions and converse with an LLM agent via a liteLLM-compatible API. The app is packaged as a Windows `.exe` (with macOS support during development). Configuration (BASE_URL, API_KEY, model) is managed globally in the app.

---

## Goals

- Allow users to create and manage multiple chat sessions
- Stream LLM responses in real-time (character-by-character)
- Persist chat sessions as local JSON files
- Expose a settings UI for BASE_URL, API_KEY, and model name
- Package as a standalone Windows `.exe` with no external runtime dependencies

## Non-Goals

- Per-session system prompts
- Per-session model selection
- Chat export
- Cloud sync or remote storage
- Authentication / multi-user support

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri 2.x (Rust) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State Management | Zustand |
| LLM Streaming | Native `fetch` + `ReadableStream` (SSE) |
| Markdown Rendering | `react-markdown` + `react-syntax-highlighter` |

---

## Architecture

### Approach: Frontend-first with Rust for file I/O

The React frontend makes HTTP calls directly to the liteLLM API and handles SSE streaming natively. The Tauri Rust backend is used exclusively for file system operations (reading/writing JSON sessions and settings). This minimises Rust complexity while keeping streaming logic in the well-supported React/browser ecosystem.

```
React (fetch + ReadableStream) ──────────→ liteLLM API
React ←────── Tauri Commands ──────────→ Local JSON files
```

---

## Directory Structure

```
test-tauri/
├── src/                         # React frontend
│   ├── components/
│   │   ├── Sidebar.tsx          # Session list + New Chat button
│   │   ├── ChatWindow.tsx       # Message list + input box
│   │   ├── MessageBubble.tsx    # Single message with markdown rendering
│   │   └── SettingsModal.tsx    # BASE_URL / API_KEY / model settings
│   ├── hooks/
│   │   └── useChat.ts           # Streaming logic + AbortController
│   ├── store/
│   │   └── useChatStore.ts      # Zustand: sessions, activeSessionId, settings, isStreaming
│   ├── lib/
│   │   └── llm.ts               # liteLLM fetch wrapper
│   └── App.tsx
├── src-tauri/                   # Rust backend
│   └── src/
│       ├── main.rs
│       └── commands.rs          # Tauri commands for file I/O
└── (sessions stored in appDataDir, not in repo)
```

---

## Data Models

### Session file (`<session-id>.json`)

Stored in Tauri's `appDataDir` (e.g. `%APPDATA%\<app-name>\` on Windows).

```json
{
  "id": "uuid-v4",
  "title": "Chat #1",
  "createdAt": "2026-03-24T11:00:00Z",
  "messages": [
    {
      "role": "user",
      "content": "Hello!",
      "timestamp": "2026-03-24T11:00:01Z"
    },
    {
      "role": "assistant",
      "content": "Hi there! How can I help?",
      "timestamp": "2026-03-24T11:00:02Z"
    }
  ]
}
```

Session `title` is automatically set to the first 30 characters of the user's first message.

### Settings file (`settings.json`)

Also stored in `appDataDir`.

```json
{
  "baseUrl": "http://localhost:4000",
  "apiKey": "sk-xxx",
  "model": "gpt-4o"
}
```

### Zustand store shape

```typescript
interface ChatStore {
  sessions: Session[]
  activeSessionId: string | null
  settings: Settings
  isStreaming: boolean

  // Actions
  createSession: () => void
  deleteSession: (id: string) => void
  setActiveSession: (id: string) => void
  appendChunk: (sessionId: string, chunk: string) => void
  saveSettings: (settings: Settings) => void
}
```

---

## Data Flow: Sending a Message

1. User types message and presses `Enter`
2. User message appended to active session in store
3. Empty assistant message (placeholder) added to store
4. `useChat` hook calls `llm.ts` with full message history
5. `fetch` POST to `{baseUrl}/v1/chat/completions` with `stream: true` (`baseUrl` must not include a path suffix)
6. `ReadableStream` reader processes each SSE chunk
7. Each chunk's `delta.content` is appended to the assistant message via `appendChunk`
8. React re-renders on each chunk (Zustand selector minimises re-renders to `ChatWindow` only)
9. On stream end: full session written to JSON file via Tauri command `save_session`

**Abort flow:** An `AbortController` is created per request. The Stop button calls `controller.abort()`. Partial content is retained in the in-memory store for the current session, but is **not written to JSON**. If the user closes the app after an abort, the partial message is lost. This is intentional.

---

## Tauri Commands (Rust)

All commands are `async` and return `Result<T, String>`.

| Command | Input | Output |
|---------|-------|--------|
| `load_sessions` | — | `Vec<Session>` |
| `save_session` | `Session` | — |
| `delete_session` | `id: String` | — |
| `load_settings` | — | `Settings` |
| `save_settings` | `Settings` | — |

---

## UI Behaviour

### Sidebar
- Top: `+ New Chat` button — creates a new session and sets it as active
- Session list: click to switch active session
- Each session row: delete button visible on hover
- Settings icon (⚙) at bottom-left opens SettingsModal

### ChatWindow
- Messages scroll to bottom automatically on new content
- Streaming: blinking cursor appended to last assistant message
- Input: `Enter` to send, `Shift+Enter` for newline
- During streaming: input is disabled, Stop button replaces Send

### MessageBubble
- User messages: right-aligned
- Assistant messages: left-aligned, rendered with `react-markdown`
- Code blocks: syntax highlighted via `react-syntax-highlighter`

### SettingsModal
- Fields: BASE_URL, API_KEY (password input), Model name
- On save: writes to `settings.json` via Tauri command, updates store
- Auto-opens on first launch if settings are empty

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Settings empty on launch | SettingsModal opens automatically |
| LLM request fails (4xx/5xx) | Assistant message shows error text in red; visible in store for current session but not saved to JSON |
| Network unreachable | Assistant message shows "Unable to connect to LLM server"; same store-only behaviour as above |
| File read/write fails | Toast notification; app does not crash |
| Stream aborted by user | Partial content retained; no error shown |

---

## Build & Distribution

- `npm run tauri build` produces a Windows NSIS installer (`.exe`) and/or an MSI
- No external runtime required — Tauri bundles the WebView
- App name: **`dtd-desktop`** (set in `tauri.conf.json`)
- App data stored in `%APPDATA%\dtd-desktop\` on Windows, `~/Library/Application Support/dtd-desktop/` on macOS
