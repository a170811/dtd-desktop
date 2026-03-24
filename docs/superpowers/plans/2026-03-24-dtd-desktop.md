# dtd-desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri 2.x desktop chatbot app (dtd-desktop) where users can create chat sessions and stream LLM responses via a liteLLM-compatible API.

**Architecture:** React frontend makes `fetch` calls directly to liteLLM for SSE streaming. Tauri Rust backend handles all file I/O (sessions as JSON files, settings.json). Zustand manages in-memory state.

**Tech Stack:** Tauri 2.x, React 18, TypeScript, Vite, Tailwind CSS, Zustand, react-markdown, react-syntax-highlighter, Vitest, React Testing Library

---

## File Map

| File | Responsibility |
|------|----------------|
| `src-tauri/src/commands.rs` | 5 Tauri commands: load/save/delete sessions, load/save settings |
| `src-tauri/src/main.rs` | Register Tauri commands, configure app |
| `src-tauri/tauri.conf.json` | App name `dtd-desktop`, window config, file system permissions |
| `src/types.ts` | Shared TypeScript types: `Message`, `Session`, `Settings` |
| `src/lib/llm.ts` | `streamChat(messages, settings, onChunk, signal)` — fetch + SSE parser |
| `src/store/useChatStore.ts` | Zustand store: sessions, activeSessionId, settings, isStreaming |
| `src/hooks/useChat.ts` | `sendMessage(content)` — orchestrates store + llm.ts + Tauri save |
| `src/components/SettingsModal.tsx` | Form for BASE_URL, API_KEY, model; saves via Tauri command |
| `src/components/MessageBubble.tsx` | Renders one message (user right-aligned, assistant with markdown) |
| `src/components/ChatWindow.tsx` | Message list + auto-scroll + input box + send/stop |
| `src/components/Sidebar.tsx` | Session list + New Chat button + delete + settings trigger |
| `src/App.tsx` | Root layout: Sidebar + ChatWindow; first-launch settings gate |
| `src/test/setup.ts` | Vitest global setup, mock `@tauri-apps/plugin-fs` |

---

## Task 1: Scaffold Project

**Files:**
- Create: `src-tauri/tauri.conf.json` (modified after scaffold)
- Create: `vite.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Scaffold with create-tauri-app**

```bash
npm create tauri-app@latest . -- --template react-ts --manager npm --force
```

Expected: project files created including `src/`, `src-tauri/`, `package.json`, `vite.config.ts`

- [ ] **Step 2: Install frontend dependencies**

```bash
npm install zustand react-markdown react-syntax-highlighter
npm install -D @types/react-syntax-highlighter vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 3: Install Tailwind CSS**

```bash
npm install -D tailwindcss @tailwindcss/vite
```

Add to `vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), ...],
})
```

Add to `src/index.css` (replace contents):
```css
@import "tailwindcss";
```

- [ ] **Step 4: Install Tauri filesystem plugin**

```bash
npm install @tauri-apps/plugin-fs
npm run tauri add fs
```

This adds the Rust crate and grants filesystem permissions.

- [ ] **Step 5: Set app name in tauri.conf.json**

In `src-tauri/tauri.conf.json`, set:
```json
{
  "productName": "dtd-desktop",
  "identifier": "com.dtd.desktop",
  "app": {
    "windows": [
      {
        "title": "dtd-desktop",
        "width": 1024,
        "height": 768,
        "minWidth": 700,
        "minHeight": 500
      }
    ]
  }
}
```

- [ ] **Step 6: Configure Vitest in vite.config.ts**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
  },
})
```

- [ ] **Step 7: Create test setup file**

`src/test/setup.ts`:
```ts
import '@testing-library/jest-dom'

// Mock @tauri-apps/plugin-fs — all tests use this mock
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
}))

// Mock @tauri-apps/api/path
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/appdata'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))
```

- [ ] **Step 8: Create shared types**

`src/types.ts`:
```ts
export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isError?: boolean
}

export interface Session {
  id: string
  title: string
  createdAt: string
  messages: Message[]
}

export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
}
```

- [ ] **Step 9: Verify dev server starts**

```bash
npm run tauri dev
```

Expected: app window opens with default Vite+React content. No TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold dtd-desktop with Tauri 2, React, Tailwind, Vitest"
```

---

## Task 2: Rust File I/O Commands

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

The 5 commands operate on files in `appDataDir/sessions/` (for sessions) and `appDataDir/settings.json`.

- [ ] **Step 1: Write failing Rust tests**

Add at the bottom of `src-tauri/src/commands.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_roundtrip() {
        let session = Session {
            id: "test-id".to_string(),
            title: "Test".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            messages: vec![],
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "test-id");
        assert_eq!(parsed.title, "Test");
    }

    #[test]
    fn test_settings_roundtrip() {
        let settings = Settings {
            base_url: "http://localhost:4000".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4o".to_string(),
        };
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.base_url, "http://localhost:4000");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test
```

Expected: compile error — `Session`, `Settings` structs not yet defined.

- [ ] **Step 3: Implement commands.rs**

`src-tauri/src/commands.rs`:
```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(data_dir.join("sessions"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(data_dir.join("settings.json"))
}

#[tauri::command]
pub async fn load_sessions(app: AppHandle) -> Result<Vec<Session>, String> {
    let dir = sessions_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut sessions = vec![];
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let session: Session = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            sessions.push(session);
        }
    }
    sessions.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(sessions)
}

#[tauri::command]
pub async fn save_session(app: AppHandle, session: Session) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", session.id));
    let content = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    let path = dir.join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<Option<Settings>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: Settings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(settings))
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_roundtrip() {
        let session = Session {
            id: "test-id".to_string(),
            title: "Test".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            messages: vec![],
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "test-id");
        assert_eq!(parsed.title, "Test");
    }

    #[test]
    fn test_settings_roundtrip() {
        let settings = Settings {
            base_url: "http://localhost:4000".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4o".to_string(),
        };
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.base_url, "http://localhost:4000");
    }
}
```

- [ ] **Step 4: Register commands in main.rs**

`src-tauri/src/main.rs`:
```rust
mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_sessions,
            commands::save_session,
            commands::delete_session,
            commands::load_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Add `serde` and `serde_json` to `src-tauri/Cargo.toml` if not present:
```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test
```

Expected: 2 tests pass.

- [ ] **Step 6: Verify build compiles**

```bash
cd src-tauri && cargo build
```

Expected: compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/
git commit -m "feat: add Rust file I/O commands for sessions and settings"
```

---

## Task 3: Zustand Store

**Files:**
- Create: `src/store/useChatStore.ts`
- Create: `src/store/__tests__/useChatStore.test.ts`

- [ ] **Step 1: Write failing tests**

`src/store/__tests__/useChatStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatStore } from '../useChatStore'

beforeEach(() => {
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    settings: null,
    isStreaming: false,
  })
})

describe('createSession', () => {
  it('adds a new session and sets it active', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.activeSessionId).toBe(result.current.sessions[0].id)
  })

  it('sets title from first message', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    const id = result.current.sessions[0].id
    act(() => result.current.addMessage(id, { role: 'user', content: 'Hello world this is a test', timestamp: new Date().toISOString() }))
    expect(result.current.sessions[0].title).toBe('Hello world this is a test')
  })
})

describe('deleteSession', () => {
  it('removes the session', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    const id = result.current.sessions[0].id
    act(() => result.current.deleteSession(id))
    expect(result.current.sessions).toHaveLength(0)
    expect(result.current.activeSessionId).toBeNull()
  })
})

describe('appendChunk', () => {
  it('accumulates chunks on the last assistant message', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    const id = result.current.sessions[0].id
    act(() => result.current.addMessage(id, { role: 'assistant', content: '', timestamp: new Date().toISOString() }))
    act(() => result.current.appendChunk(id, 'Hello'))
    act(() => result.current.appendChunk(id, ' world'))
    const msg = result.current.sessions[0].messages[0]
    expect(msg.content).toBe('Hello world')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/store/__tests__/useChatStore.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Install uuid and implement the store**

```bash
npm install uuid && npm install -D @types/uuid
```

`src/store/useChatStore.ts`:
```ts
import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Session, Message, Settings } from '../types'

interface ChatStore {
  sessions: Session[]
  activeSessionId: string | null
  settings: Settings | null
  isStreaming: boolean

  createSession: () => void
  deleteSession: (id: string) => void
  setActiveSession: (id: string) => void
  addMessage: (sessionId: string, message: Message) => void
  appendChunk: (sessionId: string, chunk: string) => void
  setStreaming: (value: boolean) => void
  setSessions: (sessions: Session[]) => void
  setSettings: (settings: Settings) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  settings: null,
  isStreaming: false,

  createSession: () => {
    const session: Session = {
      id: uuidv4(),
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      messages: [],
    }
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: session.id,
    }))
  },

  deleteSession: (id) => {
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id)
      const activeSessionId =
        state.activeSessionId === id
          ? (sessions[sessions.length - 1]?.id ?? null)
          : state.activeSessionId
      return { sessions, activeSessionId }
    })
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  addMessage: (sessionId, message) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id !== sessionId) return s
        const messages = [...s.messages, message]
        // Set title from first user message (truncated to 30 chars)
        const title =
          s.messages.length === 0 && message.role === 'user'
            ? message.content.slice(0, 30)
            : s.title
        return { ...s, messages, title }
      }),
    }))
  },

  appendChunk: (sessionId, chunk) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id !== sessionId) return s
        const messages = [...s.messages]
        const last = messages[messages.length - 1]
        if (last && last.role === 'assistant') {
          messages[messages.length - 1] = { ...last, content: last.content + chunk }
        }
        return { ...s, messages }
      }),
    }))
  },

  setStreaming: (value) => set({ isStreaming: value }),
  setSessions: (sessions) => set({ sessions }),
  setSettings: (settings) => set({ settings }),
}))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/store/__tests__/useChatStore.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/ src/types.ts package.json package-lock.json
git commit -m "feat: add Zustand chat store with session and streaming state"
```

---

## Task 4: LLM Client

**Files:**
- Create: `src/lib/llm.ts`
- Create: `src/lib/__tests__/llm.test.ts`

Sends POST to `{baseUrl}/v1/chat/completions` and calls `onChunk` for each content delta.

> **Convention:** `baseUrl` must NOT include a path suffix (e.g. `http://localhost:4000`, not `http://localhost:4000/v1`). The client always appends `/v1/chat/completions`. This matches the OpenAI SDK convention that liteLLM follows.

- [ ] **Step 1: Write failing tests**

`src/lib/__tests__/llm.test.ts`:
```ts
import { it, expect, vi, beforeEach } from 'vitest'
import { streamChat } from '../llm'
import { Settings } from '../../types'

const settings: Settings = {
  baseUrl: 'http://localhost:4000',
  apiKey: 'sk-test',
  model: 'gpt-4o',
}

const makeStreamBody = (chunks: string[]) => {
  const encoder = new TextEncoder()
  const lines = chunks.map(
    (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
  )
  lines.push('data: [DONE]\n\n')
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

it('calls onChunk for each content delta', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    body: makeStreamBody(['Hello', ' world']),
  })

  const chunks: string[] = []
  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    settings,
    (c) => chunks.push(c),
    new AbortController().signal,
  )

  expect(chunks).toEqual(['Hello', ' world'])
})

it('throws on non-ok response', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized',
  })

  await expect(
    streamChat(
      [{ role: 'user', content: 'hi', timestamp: '' }],
      settings,
      vi.fn(),
      new AbortController().signal,
    )
  ).rejects.toThrow('401')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/llm.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement llm.ts**

`src/lib/llm.ts`:
```ts
import { Message, Settings } from '../types'

export async function streamChat(
  messages: Message[],
  settings: Settings,
  onChunk: (chunk: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LLM request failed: ${response.status} ${text}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) onChunk(content)
      } catch {
        // skip malformed lines
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/llm.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/
git commit -m "feat: add liteLLM streaming client"
```

---

## Task 5: useChat Hook

**Files:**
- Create: `src/hooks/useChat.ts`
- Create: `src/hooks/__tests__/useChat.test.ts`

Orchestrates store + llm.ts + Tauri save on each message send.

- [ ] **Step 1: Write failing tests**

`src/hooks/__tests__/useChat.test.ts`:
```ts
import { it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChat } from '../useChat'
import { useChatStore } from '../../store/useChatStore'
import * as llm from '../../lib/llm'

vi.mock('../../lib/llm')
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    settings: { baseUrl: 'http://localhost:4000', apiKey: 'sk-test', model: 'gpt-4o' },
    isStreaming: false,
  })
  act(() => useChatStore.getState().createSession())
})

it('adds user message and assistant placeholder, streams chunks', async () => {
  vi.mocked(llm.streamChat).mockImplementation(async (_msgs, _settings, onChunk, _signal) => {
    onChunk('Hello')
    onChunk(' world')
  })

  const { result } = renderHook(() => useChat())
  await act(async () => {
    await result.current.sendMessage('Hi there')
  })

  const session = useChatStore.getState().sessions[0]
  expect(session.messages[0]).toMatchObject({ role: 'user', content: 'Hi there' })
  expect(session.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello world' })
})

it('marks assistant message as error when streamChat throws', async () => {
  vi.mocked(llm.streamChat).mockRejectedValue(new Error('Network error'))

  const { result } = renderHook(() => useChat())
  await act(async () => {
    await result.current.sendMessage('Hi')
  })

  const session = useChatStore.getState().sessions[0]
  const assistant = session.messages[1]
  expect(assistant.isError).toBe(true)
  expect(assistant.content).toContain('Network error')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/hooks/__tests__/useChat.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement useChat.ts**

`src/hooks/useChat.ts`:
```ts
import { useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useChatStore } from '../store/useChatStore'
import { streamChat } from '../lib/llm'
import { Message } from '../types'

export function useChat() {
  const store = useChatStore()
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = async (content: string) => {
    const { activeSessionId, sessions, settings } = store
    if (!activeSessionId || !settings) return

    const session = sessions.find((s) => s.id === activeSessionId)
    if (!session) return

    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }
    store.addMessage(activeSessionId, userMessage)

    const assistantPlaceholder: Message = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    }
    store.addMessage(activeSessionId, assistantPlaceholder)
    store.setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    const allMessages = [...session.messages, userMessage]
    let hasError = false
    let wasAborted = false

    try {
      await streamChat(allMessages, settings, (chunk) => {
        store.appendChunk(activeSessionId, chunk)
      }, controller.signal)
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User cancelled — keep partial content in store, do NOT save to disk
        wasAborted = true
      } else {
        hasError = true
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        useChatStore.setState((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== activeSessionId) return s
            const messages = [...s.messages]
            const last = messages[messages.length - 1]
            messages[messages.length - 1] = { ...last, content: errorMsg, isError: true }
            return { ...s, messages }
          }),
        }))
      }
    } finally {
      store.setStreaming(false)
      abortRef.current = null

      // Save to disk only on clean completion (not on error or abort)
      if (!hasError && !wasAborted) {
        const updated = useChatStore.getState().sessions.find((s) => s.id === activeSessionId)
        if (updated) {
          await invoke('save_session', { session: updated }).catch(console.error)
        }
      }
    }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
  }

  return { sendMessage, stopStreaming }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/hooks/__tests__/useChat.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/
git commit -m "feat: add useChat hook with streaming and abort support"
```

---

## Task 6: SettingsModal Component

**Files:**
- Create: `src/components/SettingsModal.tsx`
- Create: `src/components/__tests__/SettingsModal.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/components/__tests__/SettingsModal.test.tsx`:
```tsx
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsModal } from '../SettingsModal'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
}

it('renders form fields', () => {
  render(<SettingsModal {...defaultProps} />)
  expect(screen.getByLabelText(/base url/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/model/i)).toBeInTheDocument()
})

it('calls onSave with form values on submit', async () => {
  render(<SettingsModal {...defaultProps} />)
  fireEvent.change(screen.getByLabelText(/base url/i), { target: { value: 'http://localhost:4000' } })
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-abc' } })
  fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'gpt-4o' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() =>
    expect(defaultProps.onSave).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:4000',
      apiKey: 'sk-abc',
      model: 'gpt-4o',
    })
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/__tests__/SettingsModal.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement SettingsModal.tsx**

`src/components/SettingsModal.tsx`:
```tsx
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Settings } from '../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (settings: Settings) => void
  initialValues?: Settings | null
}

export function SettingsModal({ isOpen, onClose, onSave, initialValues }: Props) {
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')
  const [model, setModel] = useState(initialValues?.model ?? '')

  useEffect(() => {
    if (initialValues) {
      setBaseUrl(initialValues.baseUrl)
      setApiKey(initialValues.apiKey)
      setModel(initialValues.model)
    }
  }, [initialValues])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const settings: Settings = { baseUrl, apiKey, model }
    await invoke('save_settings', { settings })
    onSave(settings)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="baseUrl" className="block text-sm text-gray-300 mb-1">Base URL</label>
            <input
              id="baseUrl"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
              placeholder="http://localhost:4000"
              required
            />
          </div>
          <div>
            <label htmlFor="apiKey" className="block text-sm text-gray-300 mb-1">API Key</label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
              placeholder="sk-..."
              required
            />
          </div>
          <div>
            <label htmlFor="model" className="block text-sm text-gray-300 mb-1">Model</label>
            <input
              id="model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
              placeholder="gpt-4o"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/__tests__/SettingsModal.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx src/components/__tests__/SettingsModal.test.tsx
git commit -m "feat: add SettingsModal component"
```

---

## Task 7: MessageBubble Component

**Files:**
- Create: `src/components/MessageBubble.tsx`
- Create: `src/components/__tests__/MessageBubble.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/components/__tests__/MessageBubble.test.tsx`:
```tsx
import { it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from '../MessageBubble'

it('renders user message right-aligned', () => {
  const { container } = render(
    <MessageBubble message={{ role: 'user', content: 'Hello', timestamp: '' }} />
  )
  expect(screen.getByText('Hello')).toBeInTheDocument()
  expect(container.firstChild).toHaveClass('justify-end')
})

it('renders assistant message with markdown bold', () => {
  render(
    <MessageBubble message={{ role: 'assistant', content: '**Bold text**', timestamp: '' }} />
  )
  expect(screen.getByRole('strong')).toBeInTheDocument()
})

it('renders error message with red text class', () => {
  const { container } = render(
    <MessageBubble message={{ role: 'assistant', content: 'Error occurred', timestamp: '', isError: true }} />
  )
  expect(container.querySelector('.text-red-400')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/__tests__/MessageBubble.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement MessageBubble.tsx**

`src/components/MessageBubble.tsx`:
```tsx
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../types'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
          isUser
            ? 'bg-blue-600 text-white'
            : message.isError
            ? 'bg-gray-800 text-red-400'
            : 'bg-gray-800 text-gray-100'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <ReactMarkdown
            components={{
              code({ className, children, ...props }) {
                const match = className?.match(/language-(\w+)/) ?? null
                const isBlock = match !== null
                return isBlock ? (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className="bg-gray-700 rounded px-1 text-xs" {...props}>
                    {children}
                  </code>
                )
              },
            }}
          >
            {message.content || '▋'}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/__tests__/MessageBubble.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/MessageBubble.tsx src/components/__tests__/MessageBubble.test.tsx
git commit -m "feat: add MessageBubble with markdown and syntax highlighting"
```

---

## Task 8: ChatWindow Component

**Files:**
- Create: `src/components/ChatWindow.tsx`
- Create: `src/components/__tests__/ChatWindow.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/components/__tests__/ChatWindow.test.tsx`:
```tsx
import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatWindow } from '../ChatWindow'
import { useChatStore } from '../../store/useChatStore'
import { act } from '@testing-library/react'

vi.mock('../../hooks/useChat', () => ({
  useChat: () => ({ sendMessage: vi.fn(), stopStreaming: vi.fn() }),
}))

beforeEach(() => {
  useChatStore.setState({ sessions: [], activeSessionId: null, settings: null, isStreaming: false })
  act(() => useChatStore.getState().createSession())
})

it('renders input placeholder', () => {
  render(<ChatWindow />)
  expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument()
})

it('input is disabled while streaming', () => {
  useChatStore.setState((s) => ({ ...s, isStreaming: true }))
  render(<ChatWindow />)
  expect(screen.getByPlaceholderText(/type a message/i)).toBeDisabled()
})

it('shows Stop button while streaming', () => {
  useChatStore.setState((s) => ({ ...s, isStreaming: true }))
  render(<ChatWindow />)
  expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/__tests__/ChatWindow.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ChatWindow.tsx**

`src/components/ChatWindow.tsx`:
```tsx
import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/useChatStore'
import { useChat } from '../hooks/useChat'
import { MessageBubble } from './MessageBubble'

export function ChatWindow() {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { activeSessionId, sessions, isStreaming } = useChatStore()
  const { sendMessage, stopStreaming } = useChat()

  const session = sessions.find((s) => s.id === activeSessionId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages.length, isStreaming])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    setInput('')
    sendMessage(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {session?.messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/__tests__/ChatWindow.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatWindow.tsx src/components/__tests__/ChatWindow.test.tsx
git commit -m "feat: add ChatWindow with input, streaming state, and auto-scroll"
```

---

## Task 9: Sidebar Component

**Files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/components/__tests__/Sidebar.test.tsx`:
```tsx
import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import { useChatStore } from '../../store/useChatStore'
import { act } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => {
  useChatStore.setState({ sessions: [], activeSessionId: null, settings: null, isStreaming: false })
})

it('renders New Chat button', () => {
  render(<Sidebar onOpenSettings={vi.fn()} />)
  expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
})

it('creates a new session on New Chat click', () => {
  render(<Sidebar onOpenSettings={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /\+ new chat/i }))
  expect(useChatStore.getState().sessions).toHaveLength(1)
})

it('calls onOpenSettings when settings button clicked', () => {
  const onOpenSettings = vi.fn()
  render(<Sidebar onOpenSettings={onOpenSettings} />)
  fireEvent.click(screen.getByRole('button', { name: /settings/i }))
  expect(onOpenSettings).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/__tests__/Sidebar.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement Sidebar.tsx**

`src/components/Sidebar.tsx`:
```tsx
import { invoke } from '@tauri-apps/api/core'
import { useChatStore } from '../store/useChatStore'

interface Props {
  onOpenSettings: () => void
}

export function Sidebar({ onOpenSettings }: Props) {
  const { sessions, activeSessionId, createSession, deleteSession, setActiveSession } = useChatStore()

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteSession(id)
    await invoke('delete_session', { id }).catch(console.error)
  }

  return (
    <div className="w-60 flex flex-col h-full bg-gray-900 border-r border-gray-700">
      <div className="p-3">
        <button
          onClick={createSession}
          className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className={`group flex items-center justify-between rounded-lg px-3 py-2 mb-1 cursor-pointer text-sm transition-colors ${
              session.id === activeSessionId
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span className="truncate flex-1">{session.title}</span>
            <button
              onClick={(e) => handleDelete(e, session.id)}
              className="ml-2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all text-xs"
              title="Delete session"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700">
        <button
          onClick={onOpenSettings}
          className="w-full py-2 px-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg text-sm transition-colors text-left"
        >
          ⚙ Settings
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/__tests__/Sidebar.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/__tests__/Sidebar.test.tsx
git commit -m "feat: add Sidebar with session list and delete"
```

---

## Task 10: App Wiring and First-Launch Gate

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`

Assembles all components. Loads persisted sessions and settings on startup. Auto-opens SettingsModal when settings are missing.

- [ ] **Step 1: Implement App.tsx**

`src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useChatStore } from './store/useChatStore'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { SettingsModal } from './components/SettingsModal'
import { Session, Settings } from './types'

export default function App() {
  const { setSessions, setSettings, settings, activeSessionId } = useChatStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const init = async () => {
      const [sessions, loadedSettings] = await Promise.all([
        invoke<Session[]>('load_sessions').catch(() => [] as Session[]),
        invoke<Settings | null>('load_settings').catch(() => null),
      ])
      setSessions(sessions)
      if (loadedSettings) {
        setSettings(loadedSettings)
      } else {
        setSettingsOpen(true)
      }
    }
    init()
  }, [])

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings)
    setSettingsOpen(false)
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />

      <main className="flex-1 flex flex-col min-w-0">
        {activeSessionId ? (
          <ChatWindow />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Select a session or create a new chat
          </div>
        )}
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        initialValues={settings}
      />
    </div>
  )
}
```

- [ ] **Step 2: Update main.tsx**

`src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Smoke-test in dev mode**

```bash
npm run tauri dev
```

Verify manually:
- App opens, SettingsModal appears on first launch
- Enter BASE_URL / API_KEY / model, save
- Click `+ New Chat`, type a message, press Enter
- LLM response streams in real-time
- Stop button interrupts streaming
- Close and reopen app — sessions are restored

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "feat: wire up app layout with first-launch settings gate"
```

---

## Task 11: Windows Build

- [ ] **Step 1: Build for Windows**

Run on a Windows machine or Windows CI:
```bash
npm run tauri build
```

Expected: `src-tauri/target/release/bundle/nsis/dtd-desktop_*_x64-setup.exe` generated.

- [ ] **Step 2: Verify installer**

Run the `.exe` installer, launch the app, confirm it opens and works end-to-end.

- [ ] **Step 3: Tag release**

```bash
git tag v0.1.0
git commit --allow-empty -m "chore: v0.1.0 release"
```
