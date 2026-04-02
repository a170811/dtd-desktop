# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**dtd-desktop** — a Tauri 2.x desktop chatbot (similar to Claude Desktop) that connects to a LiteLLM-compatible API. Packaged as a standalone Windows `.exe` for sharing in environments with LiteLLM available.

## Commands

```bash
# Frontend dev server only
npm run dev

# Full Tauri dev (frontend + Rust, launches app window)
npm run tauri dev

# Run frontend tests
npm run test

# Run tests in watch mode
npm run test:watch

# Build production app (Windows .exe / macOS .app)
npm run tauri build

# Rust tests only
cd src-tauri && cargo test

# Download Node.js + Python runtimes for bundling (Windows build only)
npm run setup-runtime
```

## Architecture

### Design principle: frontend-first, Rust for file I/O only

The React frontend makes HTTP calls **directly** to the LiteLLM API and handles SSE streaming natively via `fetch` + `ReadableStream`. The Rust backend is used **exclusively** for reading/writing local JSON files. This keeps streaming logic in the browser ecosystem and minimises Rust complexity.

```
React (fetch + ReadableStream) ──────→ LiteLLM API  (POST /v1/responses, stream:true)
React ←────── Tauri Commands ────────→ Local JSON files (appDataDir)
```

### Frontend layers

- **`src/lib/llm.ts`** — raw fetch wrapper for the LiteLLM Responses API (`/v1/responses`). Parses SSE events; fires `onChunk` for `response.output_text.delta` events.
- **`src/hooks/useChat.ts`** — orchestrates a send: adds messages to store, calls `streamChat`, appends chunks, persists session on clean completion via `invoke('save_session')`. Holds `AbortController` for stop-streaming.
- **`src/store/useChatStore.ts`** — Zustand store: `sessions`, `activeSessionId`, `settings`, `isStreaming`. Session title auto-set to first 30 chars of first user message.
- **`src/components/`** — `Sidebar` (session list + new/delete), `ChatWindow` (message list + input), `MessageBubble` (markdown + syntax highlight), `SettingsModal` (baseUrl / apiKey / model).

### Rust backend (`src-tauri/src/commands.rs`)

Five Tauri commands, all `async`, returning `Result<T, String>`:

| Command | Purpose |
|---------|---------|
| `load_sessions` | Read all `<uuid>.json` from `appDataDir/sessions/`, sorted by `createdAt` |
| `save_session` | Write session to `appDataDir/sessions/<id>.json` |
| `delete_session` | Delete `appDataDir/sessions/<id>.json` |
| `load_settings` | Read `appDataDir/settings.json`, returns `null` if absent |
| `save_settings` | Write `appDataDir/settings.json` |

### Bundled runtimes

Node.js 22 LTS portable and Python 3.13 embeddable are bundled as Tauri resources (Windows only). `scripts/setup-runtime.mjs` downloads and prepares them at build time into `src-tauri/resources/`. At runtime, `execute_bash()` injects `PATH`, `NODE_PATH`, and `PYTHONPATH` environment variables pointing to the bundled runtimes via `src-tauri/src/runtime.rs`.

Pre-installed packages: Node.js (`docx`, `pptxgenjs`, `pdf-lib`), Python (`pypdf`, `pdfplumber`, `reportlab`, `openpyxl`, `pandas`, `markitdown[pptx]`, `Pillow`, `pdf2image`).

### Data persistence

- Sessions: `%APPDATA%\dtd-desktop\sessions\<uuid>.json` (Windows) / `~/Library/Application Support/dtd-desktop/sessions/` (macOS)
- Settings: same root, `settings.json`
- Sessions are only written on **clean stream completion** (not on error or abort)
- App auto-opens SettingsModal on first launch if `settings.json` doesn't exist

### LiteLLM API integration

`llm.ts` calls `POST {baseUrl}/v1/responses` (OpenAI Responses API format, not `/v1/chat/completions`). The `baseUrl` in settings must **not** include a path suffix. Streaming events use `response.output_text.delta` and `response.done`.

## Testing

Frontend tests use Vitest + Testing Library (jsdom). Test files live alongside source in `__tests__/` directories. Tauri APIs (`@tauri-apps/api/core`) are mocked in `src/test/setup.ts`.

```bash
# Run a single test file
npm run test -- src/hooks/__tests__/useChat.test.ts
```

Rust unit tests (serde roundtrips) are in `src-tauri/src/commands.rs` under `#[cfg(test)]`.
