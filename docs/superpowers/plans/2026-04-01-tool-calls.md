# Tool Call Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the LLM to call 4 tools (bash, read_file, write_file, edit_file) that execute on the user's local filesystem via the Rust backend, with per-tool user confirmation and session-scoped working directories.

**Architecture:** The Rust backend gains 4 new Tauri commands for tool execution with path validation. The frontend LLM layer (`llm.ts`) is refactored to return structured streaming events (text chunks + tool calls) instead of just text. The chat hook (`useChat.ts`) runs an agent loop: stream → detect tool call → show confirmation UI → invoke Rust → send result back to LLM → repeat. Each session stores its working directory (selected at creation) and list of always-allowed tools.

**Tech Stack:** Tauri 2.x (Rust), React 19, Zustand, TypeScript, Vitest, `@tauri-apps/plugin-dialog` for directory picker.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `ToolCall`, `ToolResultMessage` types; extend `Message`, `Session` |
| `src-tauri/src/commands.rs` | Modify | Add `execute_bash`, `execute_read_file`, `execute_write_file`, `execute_edit_file` commands; update `Session`/`Message` structs |
| `src-tauri/src/lib.rs` | Modify | Register new commands |
| `src-tauri/Cargo.toml` | Modify | Add `tauri-plugin-dialog` dependency |
| `src-tauri/tauri.conf.json` | Modify | Add dialog plugin permissions |
| `src-tauri/capabilities/default.json` | Modify | Add `dialog:default` permission |
| `package.json` | Modify | Add `@tauri-apps/plugin-dialog` dependency |
| `src/lib/llm.ts` | Modify | Return structured events (text + tool calls); send tool definitions in requests |
| `src/lib/tools.ts` | Create | Tool definitions array for both API formats |
| `src/hooks/useChat.ts` | Modify | Agent loop with tool call detection, confirmation, execution, result feedback |
| `src/store/useChatStore.ts` | Modify | Add `pendingToolCall`, `updateSession`, `addAllowedTool` actions; update `createSession` for working directory |
| `src/components/ChatWindow.tsx` | Modify | Render `ToolCallBubble`; pass `pendingToolCall` to confirmation UI |
| `src/components/ToolCallBubble.tsx` | Create | Expandable tool call display with preview + full content |
| `src/components/ToolConfirmDialog.tsx` | Create | Allow / Deny / Always Allow buttons |
| `src/components/Sidebar.tsx` | Modify | Trigger directory picker on new session |
| `src/components/MessageBubble.tsx` | Modify | Handle `role: 'tool'` messages |
| `src/test/setup.ts` | Modify | Add mock for `@tauri-apps/plugin-dialog` |

---

### Task 1: Extend TypeScript types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Write the test for new types**

Create `src/types/__tests__/types.test.ts`:

```typescript
import { it, expect } from 'vitest'
import type { Message, Session, ToolCall } from '../../types'

it('Message type accepts tool role with toolCallId', () => {
  const msg: Message = {
    role: 'tool',
    content: 'file contents here',
    timestamp: '2026-01-01T00:00:00Z',
    toolCallId: 'call_123',
  }
  expect(msg.role).toBe('tool')
  expect(msg.toolCallId).toBe('call_123')
})

it('Message type accepts assistant role with toolCalls', () => {
  const msg: Message = {
    role: 'assistant',
    content: '',
    timestamp: '2026-01-01T00:00:00Z',
    toolCalls: [{ id: 'call_1', name: 'bash', arguments: { command: 'ls' } }],
  }
  expect(msg.toolCalls).toHaveLength(1)
  expect(msg.toolCalls![0].name).toBe('bash')
})

it('Session type includes workingDirectory and allowedTools', () => {
  const session: Session = {
    id: '123',
    title: 'Test',
    createdAt: '2026-01-01T00:00:00Z',
    messages: [],
    workingDirectory: '/home/user/project',
    allowedTools: ['read_file'],
  }
  expect(session.workingDirectory).toBe('/home/user/project')
  expect(session.allowedTools).toContain('read_file')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/types/__tests__/types.test.ts`
Expected: TypeScript compilation errors — `role: 'tool'` not assignable, `toolCallId` / `toolCalls` / `workingDirectory` / `allowedTools` don't exist.

- [ ] **Step 3: Update types**

Replace `src/types.ts` with:

```typescript
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: string
  isError?: boolean
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface Session {
  id: string
  title: string
  createdAt: string
  messages: Message[]
  workingDirectory?: string
  allowedTools?: string[]
}

export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
  apiFormat?: 'responses' | 'completions'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/types/__tests__/types.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to check for regressions**

Run: `npm run test`
Expected: All tests pass. The new optional fields are backwards-compatible.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/types/__tests__/types.test.ts
git commit -m "feat: extend types for tool calls, working directory, and allowed tools"
```

---

### Task 2: Rust tool execution commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write Rust unit tests for path validation and tool execution**

Add to the bottom of `src-tauri/src/commands.rs`, inside the existing `#[cfg(test)] mod tests` block:

```rust
#[test]
fn test_validate_path_within_workdir() {
    let workdir = std::env::temp_dir().join("test_workdir");
    std::fs::create_dir_all(&workdir).unwrap();
    let result = validate_path("test.txt", workdir.to_str().unwrap());
    assert!(result.is_ok());
    let resolved = result.unwrap();
    assert!(resolved.starts_with(&workdir));
    std::fs::remove_dir_all(&workdir).ok();
}

#[test]
fn test_validate_path_escapes_workdir() {
    let workdir = std::env::temp_dir().join("test_workdir2");
    std::fs::create_dir_all(&workdir).unwrap();
    let result = validate_path("../../etc/passwd", workdir.to_str().unwrap());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("escapes"));
    std::fs::remove_dir_all(&workdir).ok();
}

#[test]
fn test_execute_read_file_and_write_file() {
    let workdir = std::env::temp_dir().join("test_rw");
    std::fs::create_dir_all(&workdir).unwrap();
    let write_result = execute_write_file_sync("hello.txt", workdir.to_str().unwrap(), "Hello World");
    assert!(write_result.is_ok());
    let read_result = execute_read_file_sync("hello.txt", workdir.to_str().unwrap(), None);
    assert!(read_result.is_ok());
    assert_eq!(read_result.unwrap(), "Hello World");
    std::fs::remove_dir_all(&workdir).ok();
}

#[test]
fn test_execute_read_file_with_limit() {
    let workdir = std::env::temp_dir().join("test_read_limit");
    std::fs::create_dir_all(&workdir).unwrap();
    let content = "line1\nline2\nline3\nline4\nline5";
    std::fs::write(workdir.join("multi.txt"), content).unwrap();
    let result = execute_read_file_sync("multi.txt", workdir.to_str().unwrap(), Some(2));
    assert!(result.is_ok());
    let output = result.unwrap();
    assert!(output.contains("line1"));
    assert!(output.contains("line2"));
    assert!(output.contains("3 more lines"));
    std::fs::remove_dir_all(&workdir).ok();
}

#[test]
fn test_execute_edit_file() {
    let workdir = std::env::temp_dir().join("test_edit");
    std::fs::create_dir_all(&workdir).unwrap();
    std::fs::write(workdir.join("edit.txt"), "Hello World").unwrap();
    let result = execute_edit_file_sync("edit.txt", workdir.to_str().unwrap(), "World", "Rust");
    assert!(result.is_ok());
    let content = std::fs::read_to_string(workdir.join("edit.txt")).unwrap();
    assert_eq!(content, "Hello Rust");
    std::fs::remove_dir_all(&workdir).ok();
}

#[test]
fn test_execute_edit_file_text_not_found() {
    let workdir = std::env::temp_dir().join("test_edit_notfound");
    std::fs::create_dir_all(&workdir).unwrap();
    std::fs::write(workdir.join("edit2.txt"), "Hello World").unwrap();
    let result = execute_edit_file_sync("edit2.txt", workdir.to_str().unwrap(), "NotHere", "Rust");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
    std::fs::remove_dir_all(&workdir).ok();
}
```

- [ ] **Step 2: Run Rust tests to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: Compilation errors — `validate_path`, `execute_write_file_sync`, `execute_read_file_sync`, `execute_edit_file_sync` not found.

- [ ] **Step 3: Implement path validation and sync helpers**

Add to `src-tauri/src/commands.rs` (before the Tauri command functions):

```rust
use std::process::Command;

const MAX_OUTPUT_BYTES: usize = 50_000;

fn validate_path(path: &str, working_dir: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(working_dir).canonicalize().map_err(|e| e.to_string())?;
    let target = base.join(path);
    let resolved = if target.exists() {
        target.canonicalize().map_err(|e| e.to_string())?
    } else {
        // For new files: canonicalize the parent, then append the file name
        let parent = target.parent().ok_or("Invalid path")?;
        let parent_resolved = if parent.exists() {
            parent.canonicalize().map_err(|e| e.to_string())?
        } else {
            // Parent doesn't exist yet — will be created by write_file
            // Walk up to find an existing ancestor, ensure it's inside working_dir
            let mut ancestor = parent.to_path_buf();
            while !ancestor.exists() {
                ancestor = ancestor.parent().ok_or("Invalid path")?.to_path_buf();
            }
            let ancestor_resolved = ancestor.canonicalize().map_err(|e| e.to_string())?;
            if !ancestor_resolved.starts_with(&base) {
                return Err(format!("Path escapes working directory: {}", path));
            }
            return Ok(target);
        };
        parent_resolved.join(target.file_name().ok_or("Invalid path")?)
    };
    if !resolved.starts_with(&base) {
        return Err(format!("Path escapes working directory: {}", path));
    }
    Ok(resolved)
}

fn truncate_output(s: String) -> String {
    if s.len() > MAX_OUTPUT_BYTES {
        let mut truncated = s[..MAX_OUTPUT_BYTES].to_string();
        truncated.push_str(&format!("\n... (truncated, {} total bytes)", s.len()));
        truncated
    } else {
        s
    }
}

fn execute_read_file_sync(path: &str, working_dir: &str, limit: Option<u32>) -> Result<String, String> {
    let fp = validate_path(path, working_dir)?;
    let text = std::fs::read_to_string(&fp).map_err(|e| format!("Error: {}", e))?;
    let lines: Vec<&str> = text.lines().collect();
    if let Some(lim) = limit {
        let lim = lim as usize;
        if lim < lines.len() {
            let mut result: Vec<&str> = lines[..lim].to_vec();
            let remaining = lines.len() - lim;
            let footer = format!("... ({} more lines)", remaining);
            return Ok(truncate_output(format!("{}\n{}", result.join("\n"), footer)));
        }
    }
    Ok(truncate_output(lines.join("\n")))
}

fn execute_write_file_sync(path: &str, working_dir: &str, content: &str) -> Result<String, String> {
    let fp = validate_path(path, working_dir)?;
    if let Some(parent) = fp.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Error: {}", e))?;
    }
    std::fs::write(&fp, content).map_err(|e| format!("Error: {}", e))?;
    Ok(format!("Wrote {} bytes to {}", content.len(), path))
}

fn execute_edit_file_sync(path: &str, working_dir: &str, old_text: &str, new_text: &str) -> Result<String, String> {
    let fp = validate_path(path, working_dir)?;
    let content = std::fs::read_to_string(&fp).map_err(|e| format!("Error: {}", e))?;
    if !content.contains(old_text) {
        return Err(format!("Text not found in {}", path));
    }
    let new_content = content.replacen(old_text, new_text, 1);
    std::fs::write(&fp, new_content).map_err(|e| format!("Error: {}", e))?;
    Ok(format!("Edited {}", path))
}

fn execute_bash_sync(command: &str, working_dir: &str) -> Result<String, String> {
    let dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
    if dangerous.iter().any(|d| command.contains(d)) {
        return Err("Dangerous command blocked".to_string());
    }
    let output = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", command])
            .current_dir(working_dir)
            .output()
    } else {
        Command::new("sh")
            .args(["-c", command])
            .current_dir(working_dir)
            .output()
    };
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let stderr = String::from_utf8_lossy(&o.stderr);
            let combined = format!("{}{}", stdout, stderr).trim().to_string();
            if combined.is_empty() {
                Ok("(no output)".to_string())
            } else {
                Ok(truncate_output(combined))
            }
        }
        Err(e) => Err(format!("Error: {}", e)),
    }
}
```

- [ ] **Step 4: Run Rust tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: All tests pass.

- [ ] **Step 5: Add Tauri command wrappers and update Session/Message structs**

Update the `Message` struct in `src-tauri/src/commands.rs`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
}
```

Add the Tauri command functions:

```rust
#[tauri::command]
pub async fn execute_bash(command: String, working_dir: String) -> Result<String, String> {
    execute_bash_sync(&command, &working_dir)
}

#[tauri::command]
pub async fn execute_read_file(path: String, working_dir: String, limit: Option<u32>) -> Result<String, String> {
    execute_read_file_sync(&path, &working_dir, limit)
}

#[tauri::command]
pub async fn execute_write_file(path: String, working_dir: String, content: String) -> Result<String, String> {
    execute_write_file_sync(&path, &working_dir, &content)
}

#[tauri::command]
pub async fn execute_edit_file(path: String, working_dir: String, old_text: String, new_text: String) -> Result<String, String> {
    execute_edit_file_sync(&path, &working_dir, &old_text, &new_text)
}
```

- [ ] **Step 6: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add to `generate_handler!`:

```rust
.invoke_handler(tauri::generate_handler![
    greet,
    commands::load_sessions,
    commands::save_session,
    commands::delete_session,
    commands::load_settings,
    commands::save_settings,
    commands::execute_bash,
    commands::execute_read_file,
    commands::execute_write_file,
    commands::execute_edit_file,
])
```

- [ ] **Step 7: Update existing Rust test for Session roundtrip**

Update the `test_session_roundtrip` test to include the new fields:

```rust
#[test]
fn test_session_roundtrip() {
    let session = Session {
        id: "test-id".to_string(),
        title: "Test".to_string(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
        messages: vec![],
        working_directory: Some("/tmp/test".to_string()),
        allowed_tools: vec!["read_file".to_string()],
    };
    let json = serde_json::to_string(&session).unwrap();
    let parsed: Session = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, "test-id");
    assert_eq!(parsed.working_directory, Some("/tmp/test".to_string()));
    assert_eq!(parsed.allowed_tools, vec!["read_file".to_string()]);
}
```

- [ ] **Step 8: Run all Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add Rust tool execution commands (bash, read_file, write_file, edit_file)"
```

---

### Task 3: Add dialog plugin for directory picker

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/test/setup.ts`

- [ ] **Step 1: Install npm and Cargo dependencies**

```bash
npm install @tauri-apps/plugin-dialog
```

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register the plugin in lib.rs**

In `src-tauri/src/lib.rs`, add `.plugin(tauri_plugin_dialog::init())` before `.invoke_handler(...)`:

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // ... existing handlers ...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Add dialog permission to capabilities**

Update `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "fs:default",
    "dialog:default"
  ]
}
```

- [ ] **Step 4: Add mock for dialog plugin in test setup**

Add to `src/test/setup.ts`:

```typescript
// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))
```

- [ ] **Step 5: Verify build compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json src/test/setup.ts
git commit -m "feat: add tauri dialog plugin for directory picker"
```

---

### Task 4: Tool definitions

**Files:**
- Create: `src/lib/tools.ts`
- Create: `src/lib/__tests__/tools.test.ts`

- [ ] **Step 1: Write test**

Create `src/lib/__tests__/tools.test.ts`:

```typescript
import { it, expect } from 'vitest'
import { getToolDefinitions } from '../tools'

it('returns 4 tool definitions for completions format', () => {
  const tools = getToolDefinitions('completions')
  expect(tools).toHaveLength(4)
  const names = tools.map((t: any) => t.function.name)
  expect(names).toEqual(['bash', 'read_file', 'write_file', 'edit_file'])
})

it('returns 4 tool definitions for responses format', () => {
  const tools = getToolDefinitions('responses')
  expect(tools).toHaveLength(4)
  const names = tools.map((t: any) => t.name)
  expect(names).toEqual(['bash', 'read_file', 'write_file', 'edit_file'])
})

it('completions format wraps each tool in {type: "function", function: {...}}', () => {
  const tools = getToolDefinitions('completions')
  for (const tool of tools) {
    expect(tool).toHaveProperty('type', 'function')
    expect(tool).toHaveProperty('function.name')
    expect(tool).toHaveProperty('function.parameters')
  }
})

it('responses format has name, type, description, parameters at top level', () => {
  const tools = getToolDefinitions('responses')
  for (const tool of tools) {
    expect(tool).toHaveProperty('name')
    expect(tool).toHaveProperty('type', 'function')
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('parameters')
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/__tests__/tools.test.ts`
Expected: FAIL — module `../tools` not found.

- [ ] **Step 3: Implement tool definitions**

Create `src/lib/tools.ts`:

```typescript
interface ToolParameter {
  type: string
  properties: Record<string, { type: string; description?: string }>
  required: string[]
}

interface RawTool {
  name: string
  description: string
  parameters: ToolParameter
}

const TOOLS: RawTool[] = [
  {
    name: 'bash',
    description: 'Run a shell command in the working directory.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Path is relative to the working directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        limit: { type: 'integer', description: 'Max number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if needed. Path is relative to the working directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace the first occurrence of old_text with new_text in a file. Path is relative to the working directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        old_text: { type: 'string', description: 'Exact text to find' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
]

export function getToolDefinitions(apiFormat: 'completions' | 'responses') {
  if (apiFormat === 'completions') {
    return TOOLS.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }
  // Responses API format
  return TOOLS.map((tool) => ({
    name: tool.name,
    type: 'function' as const,
    description: tool.description,
    parameters: tool.parameters,
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/__tests__/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tools.ts src/lib/__tests__/tools.test.ts
git commit -m "feat: add tool definitions for both API formats"
```

---

### Task 5: Refactor LLM layer for structured streaming events

**Files:**
- Modify: `src/lib/llm.ts`
- Modify: `src/lib/__tests__/llm.test.ts`

This is the largest change. `streamChat` currently fires `onChunk(text)`. It needs to fire structured events so the caller can distinguish text deltas from tool calls.

- [ ] **Step 1: Write tests for tool call streaming**

Add to `src/lib/__tests__/llm.test.ts`:

```typescript
import { StreamEvent } from '../llm'

const makeCompletionsToolCallStream = () => {
  const encoder = new TextEncoder()
  const lines = [
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            function: { name: 'bash', arguments: '{"com' },
          }],
        },
      }],
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: 'mand":"ls"}' },
          }],
        },
      }],
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    })}\n\n`,
    'data: [DONE]\n\n',
  ]
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

const makeResponsesToolCallStream = () => {
  const encoder = new TextEncoder()
  const lines = [
    `data: ${JSON.stringify({
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'read_file',
      },
    })}\n\n`,
    `data: ${JSON.stringify({
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      delta: '{"path":',
    })}\n\n`,
    `data: ${JSON.stringify({
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      delta: '"test.txt"}',
    })}\n\n`,
    `data: ${JSON.stringify({
      type: 'response.function_call_arguments.done',
      item_id: 'fc_1',
      arguments: '{"path":"test.txt"}',
    })}\n\n`,
    `data: ${JSON.stringify({ type: 'response.done' })}\n\n`,
  ]
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

it('completions: emits tool_call events for function calling', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeCompletionsToolCallStream(),
  }))

  const events: StreamEvent[] = []
  await streamChat(
    [{ role: 'user', content: 'list files', timestamp: '' }],
    completionsSettings,
    (event) => events.push(event),
    new AbortController().signal,
  )

  const toolEvents = events.filter((e) => e.type === 'tool_call')
  expect(toolEvents).toHaveLength(1)
  expect(toolEvents[0]).toMatchObject({
    type: 'tool_call',
    toolCall: { id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
  })
})

it('responses: emits tool_call events for function calling', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeResponsesToolCallStream(),
  }))

  const events: StreamEvent[] = []
  await streamChat(
    [{ role: 'user', content: 'read test.txt', timestamp: '' }],
    responsesSettings,
    (event) => events.push(event),
    new AbortController().signal,
  )

  const toolEvents = events.filter((e) => e.type === 'tool_call')
  expect(toolEvents).toHaveLength(1)
  expect(toolEvents[0]).toMatchObject({
    type: 'tool_call',
    toolCall: { id: 'call_1', name: 'read_file', arguments: { path: 'test.txt' } },
  })
})
```

- [ ] **Step 2: Update existing tests for the new callback signature**

The existing tests use `onChunk(text: string)`. Update them to use the new `onEvent(event: StreamEvent)` signature. Replace calls like:

```typescript
// Old:
(c) => chunks.push(c)
// New:
(e) => { if (e.type === 'text_delta') chunks.push(e.text) }
```

Update all 4 existing tests in `llm.test.ts` accordingly. For example the first test becomes:

```typescript
it('completions: calls onEvent for each content delta', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeCompletionsStream(['Hello', ' world']),
  }))

  const chunks: string[] = []
  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    completionsSettings,
    (e) => { if (e.type === 'text_delta') chunks.push(e.text) },
    new AbortController().signal,
  )

  expect(chunks).toEqual(['Hello', ' world'])
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- src/lib/__tests__/llm.test.ts`
Expected: FAIL — `StreamEvent` not exported, callback type mismatch.

- [ ] **Step 4: Implement structured streaming**

Replace `src/lib/llm.ts` with:

```typescript
import { Message, Settings, ToolCall } from '../types'
import { getToolDefinitions } from './tools'

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }

export async function streamChat(
  messages: Message[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const format = settings.apiFormat ?? 'completions'
  if (format === 'responses') {
    return streamResponses(messages, settings, onEvent, signal)
  }
  return streamCompletions(messages, settings, onEvent, signal)
}

function buildCompletionsMessages(messages: Message[]) {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return { role: 'tool' as const, tool_call_id: msg.toolCallId, content: msg.content }
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
    }
    return { role: msg.role, content: msg.content }
  })
}

function buildResponsesInput(messages: Message[]) {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return { type: 'function_call_output' as const, call_id: msg.toolCallId, output: msg.content }
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      // For responses API, return the assistant content items plus function calls
      const items: any[] = []
      if (msg.content) {
        items.push({ type: 'message', role: 'assistant', content: msg.content })
      }
      for (const tc of msg.toolCalls) {
        items.push({
          type: 'function_call',
          id: tc.id,
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        })
      }
      return items
    }
    return { role: msg.role, content: msg.content }
  }).flat()
}

async function streamCompletions(
  messages: Message[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const tools = getToolDefinitions('completions')
  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: buildCompletionsMessages(messages),
      stream: true,
      tools,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LLM request failed: ${response.status} ${text}`)
  }

  if (!response.body) throw new Error('LLM response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Accumulate tool calls across chunks (arguments arrive incrementally)
  const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map()

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
      if (data === '[DONE]') {
        // Emit any accumulated tool calls
        for (const [, tc] of toolCallAccum) {
          try {
            const args = JSON.parse(tc.arguments)
            onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: args } })
          } catch {
            onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: {} } })
          }
        }
        return
      }
      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta

        // Text content
        if (delta?.content) {
          onEvent({ type: 'text_delta', text: delta.content })
        }

        // Tool calls (streamed incrementally)
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCallAccum.has(idx)) {
              toolCallAccum.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' })
            }
            const accum = toolCallAccum.get(idx)!
            if (tc.id) accum.id = tc.id
            if (tc.function?.name) accum.name = tc.function.name
            if (tc.function?.arguments) accum.arguments += tc.function.arguments
          }
        }

        // Check for finish_reason indicating tool calls
        const finishReason = parsed.choices?.[0]?.finish_reason
        if (finishReason === 'tool_calls' || finishReason === 'stop') {
          if (toolCallAccum.size > 0 && finishReason === 'tool_calls') {
            for (const [, tc] of toolCallAccum) {
              try {
                const args = JSON.parse(tc.arguments)
                onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: args } })
              } catch {
                onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: {} } })
              }
            }
            toolCallAccum.clear()
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}

async function streamResponses(
  messages: Message[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const tools = getToolDefinitions('responses')
  const response = await fetch(`${settings.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      input: buildResponsesInput(messages),
      stream: true,
      tools,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LLM request failed: ${response.status} ${text}`)
  }

  if (!response.body) throw new Error('LLM response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Track function calls by item_id
  const funcCalls: Map<string, { id: string; name: string; arguments: string }> = new Map()

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
      try {
        const parsed = JSON.parse(data)

        if (parsed.type === 'response.output_text.delta') {
          if (parsed.delta) onEvent({ type: 'text_delta', text: parsed.delta })
        } else if (parsed.type === 'response.output_item.added' && parsed.item?.type === 'function_call') {
          funcCalls.set(parsed.item.id, {
            id: parsed.item.call_id,
            name: parsed.item.name,
            arguments: '',
          })
        } else if (parsed.type === 'response.function_call_arguments.delta') {
          const fc = funcCalls.get(parsed.item_id)
          if (fc) fc.arguments += parsed.delta
        } else if (parsed.type === 'response.function_call_arguments.done') {
          const fc = funcCalls.get(parsed.item_id)
          if (fc) {
            try {
              const args = JSON.parse(parsed.arguments ?? fc.arguments)
              onEvent({ type: 'tool_call', toolCall: { id: fc.id, name: fc.name, arguments: args } })
            } catch {
              onEvent({ type: 'tool_call', toolCall: { id: fc.id, name: fc.name, arguments: {} } })
            }
            funcCalls.delete(parsed.item_id)
          }
        } else if (parsed.type === 'response.done') {
          return
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- src/lib/__tests__/llm.test.ts`
Expected: All pass (both old and new tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm.ts src/lib/__tests__/llm.test.ts
git commit -m "feat: refactor LLM streaming to emit structured events (text + tool calls)"
```

---

### Task 6: Update Zustand store for tool call state

**Files:**
- Modify: `src/store/useChatStore.ts`
- Modify: `src/store/__tests__/useChatStore.test.ts`

- [ ] **Step 1: Write tests for new store actions**

Add to `src/store/__tests__/useChatStore.test.ts`:

```typescript
describe('createSessionWithDir', () => {
  it('creates a session with a working directory', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSessionWithDir('/home/user/project'))
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].workingDirectory).toBe('/home/user/project')
    expect(result.current.sessions[0].allowedTools).toEqual([])
    expect(result.current.activeSessionId).toBe(result.current.sessions[0].id)
  })
})

describe('addAllowedTool', () => {
  it('adds a tool name to the session allowedTools', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSessionWithDir('/tmp'))
    const id = result.current.sessions[0].id
    act(() => result.current.addAllowedTool(id, 'read_file'))
    expect(result.current.sessions[0].allowedTools).toContain('read_file')
  })

  it('does not duplicate tool names', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSessionWithDir('/tmp'))
    const id = result.current.sessions[0].id
    act(() => result.current.addAllowedTool(id, 'read_file'))
    act(() => result.current.addAllowedTool(id, 'read_file'))
    expect(result.current.sessions[0].allowedTools!.filter((t) => t === 'read_file')).toHaveLength(1)
  })
})

describe('updateSession', () => {
  it('updates session fields', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSessionWithDir('/tmp'))
    const id = result.current.sessions[0].id
    act(() => result.current.updateSession(id, { title: 'Updated' }))
    expect(result.current.sessions[0].title).toBe('Updated')
  })
})

describe('pendingToolCall', () => {
  it('sets and clears pending tool call', () => {
    const { result } = renderHook(() => useChatStore())
    const tc = { id: 'call_1', name: 'bash', arguments: { command: 'ls' } }
    act(() => result.current.setPendingToolCall(tc))
    expect(result.current.pendingToolCall).toEqual(tc)
    act(() => result.current.setPendingToolCall(null))
    expect(result.current.pendingToolCall).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/store/__tests__/useChatStore.test.ts`
Expected: FAIL — `createSessionWithDir`, `addAllowedTool`, `updateSession`, `setPendingToolCall` not found.

- [ ] **Step 3: Implement new store actions**

Update `src/store/useChatStore.ts`:

```typescript
import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { Session, Message, Settings, ToolCall } from '../types'

interface ChatStore {
  sessions: Session[]
  activeSessionId: string | null
  settings: Settings | null
  isStreaming: boolean
  pendingToolCall: ToolCall | null

  createSession: () => void
  createSessionWithDir: (workingDirectory: string) => void
  deleteSession: (id: string) => void
  setActiveSession: (id: string) => void
  addMessage: (sessionId: string, message: Message) => void
  appendChunk: (sessionId: string, chunk: string) => void
  setStreaming: (value: boolean) => void
  setSessions: (sessions: Session[]) => void
  setSettings: (settings: Settings) => void
  updateSession: (sessionId: string, updates: Partial<Session>) => void
  addAllowedTool: (sessionId: string, toolName: string) => void
  setPendingToolCall: (toolCall: ToolCall | null) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  settings: null,
  isStreaming: false,
  pendingToolCall: null,

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

  createSessionWithDir: (workingDirectory: string) => {
    const session: Session = {
      id: uuidv4(),
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      messages: [],
      workingDirectory,
      allowedTools: [],
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

  updateSession: (sessionId, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    }))
  },

  addAllowedTool: (sessionId, toolName) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id !== sessionId) return s
        const allowed = s.allowedTools ?? []
        if (allowed.includes(toolName)) return s
        return { ...s, allowedTools: [...allowed, toolName] }
      }),
    }))
  },

  setPendingToolCall: (toolCall) => set({ pendingToolCall: toolCall }),
}))
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/store/__tests__/useChatStore.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/useChatStore.ts src/store/__tests__/useChatStore.test.ts
git commit -m "feat: add store actions for tool calls, working directory, and allowed tools"
```

---

### Task 7: Agent loop in useChat hook

**Files:**
- Modify: `src/hooks/useChat.ts`
- Modify: `src/hooks/__tests__/useChat.test.ts`

- [ ] **Step 1: Write tests for the agent loop**

Replace `src/hooks/__tests__/useChat.test.ts`:

```typescript
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
    pendingToolCall: null,
  })
  act(() => useChatStore.getState().createSessionWithDir('/tmp'))
})

it('adds user message and assistant placeholder, streams text chunks', async () => {
  vi.mocked(llm.streamChat).mockImplementation(async (_msgs, _settings, onEvent, _signal) => {
    onEvent({ type: 'text_delta', text: 'Hello' })
    onEvent({ type: 'text_delta', text: ' world' })
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

it('sets pendingToolCall when LLM emits a tool_call event', async () => {
  const toolCall = { id: 'call_1', name: 'bash', arguments: { command: 'ls' } }

  vi.mocked(llm.streamChat).mockImplementation(async (_msgs, _settings, onEvent, _signal) => {
    onEvent({ type: 'tool_call', toolCall })
  })

  const { result } = renderHook(() => useChat())
  // Don't await — sendMessage will be waiting for tool confirmation
  act(() => {
    result.current.sendMessage('list files')
  })

  // Wait a tick for the promise to settle up to the pending state
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

  expect(useChatStore.getState().pendingToolCall).toEqual(toolCall)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/hooks/__tests__/useChat.test.ts`
Expected: Some failures — `createSessionWithDir` used in setup, `onEvent` signature mismatch with current mock expectations, `pendingToolCall` test fails.

- [ ] **Step 3: Implement the agent loop**

Replace `src/hooks/useChat.ts`:

```typescript
import { useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useChatStore } from '../store/useChatStore'
import { streamChat, StreamEvent } from '../lib/llm'
import { Message, ToolCall } from '../types'

export function useChat() {
  const store = useChatStore()
  const abortRef = useRef<AbortController | null>(null)
  const toolCallResolverRef = useRef<{
    resolve: (decision: { action: 'allow' | 'deny' | 'always_allow' }) => void
  } | null>(null)

  const waitForToolConfirmation = (toolCall: ToolCall): Promise<{ action: 'allow' | 'deny' | 'always_allow' }> => {
    return new Promise((resolve) => {
      toolCallResolverRef.current = { resolve }
      useChatStore.getState().setPendingToolCall(toolCall)
    })
  }

  const respondToToolCall = useCallback((action: 'allow' | 'deny' | 'always_allow') => {
    if (toolCallResolverRef.current) {
      toolCallResolverRef.current.resolve({ action })
      toolCallResolverRef.current = null
      useChatStore.getState().setPendingToolCall(null)
    }
  }, [])

  const executeToolCall = async (toolCall: ToolCall, workingDir: string): Promise<string> => {
    try {
      switch (toolCall.name) {
        case 'bash':
          return await invoke<string>('execute_bash', {
            command: toolCall.arguments.command as string,
            workingDir,
          })
        case 'read_file':
          return await invoke<string>('execute_read_file', {
            path: toolCall.arguments.path as string,
            workingDir,
            limit: (toolCall.arguments.limit as number) ?? null,
          })
        case 'write_file':
          return await invoke<string>('execute_write_file', {
            path: toolCall.arguments.path as string,
            workingDir,
            content: toolCall.arguments.content as string,
          })
        case 'edit_file':
          return await invoke<string>('execute_edit_file', {
            path: toolCall.arguments.path as string,
            workingDir,
            oldText: toolCall.arguments.old_text as string,
            newText: toolCall.arguments.new_text as string,
          })
        default:
          return `Unknown tool: ${toolCall.name}`
      }
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const sendMessage = async (content: string) => {
    const { activeSessionId, sessions, settings } = useChatStore.getState()
    if (!activeSessionId || !settings) return

    const session = sessions.find((s) => s.id === activeSessionId)
    if (!session) return

    if (useChatStore.getState().isStreaming) return

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

    let hasError = false
    let wasAborted = false

    try {
      // Agent loop: stream, handle tool calls, repeat
      let continueLoop = true
      while (continueLoop) {
        continueLoop = false
        const currentSession = useChatStore.getState().sessions.find((s) => s.id === activeSessionId)!
        const allMessages = currentSession.messages.slice(0, -1) // Exclude the empty assistant placeholder at end
        // But we need all messages except the last empty assistant for context
        const messagesToSend = currentSession.messages.filter((m, i) => {
          // Include all messages except the last one if it's an empty assistant placeholder
          if (i === currentSession.messages.length - 1 && m.role === 'assistant' && m.content === '' && !m.toolCalls) {
            return false
          }
          return true
        })

        const collectedToolCalls: ToolCall[] = []

        await streamChat(messagesToSend, settings, (event: StreamEvent) => {
          if (event.type === 'text_delta') {
            store.appendChunk(activeSessionId, event.text)
          } else if (event.type === 'tool_call') {
            collectedToolCalls.push(event.toolCall)
          }
        }, controller.signal)

        // Process tool calls if any
        if (collectedToolCalls.length > 0) {
          // Update the assistant message with toolCalls
          useChatStore.setState((state) => ({
            sessions: state.sessions.map((s) => {
              if (s.id !== activeSessionId) return s
              const messages = [...s.messages]
              const last = messages[messages.length - 1]
              if (last && last.role === 'assistant') {
                messages[messages.length - 1] = { ...last, toolCalls: collectedToolCalls }
              }
              return { ...s, messages }
            }),
          }))

          const workingDir = currentSession.workingDirectory ?? ''

          for (const toolCall of collectedToolCalls) {
            const allowed = currentSession.allowedTools ?? []

            let action: 'allow' | 'deny' | 'always_allow'
            if (allowed.includes(toolCall.name)) {
              action = 'allow'
            } else {
              const decision = await waitForToolConfirmation(toolCall)
              action = decision.action
            }

            let result: string
            if (action === 'deny') {
              result = `Tool call denied by user: ${toolCall.name}`
            } else {
              if (action === 'always_allow') {
                store.addAllowedTool(activeSessionId, toolCall.name)
              }
              result = await executeToolCall(toolCall, workingDir)
            }

            // Add tool result message
            const toolResultMessage: Message = {
              role: 'tool',
              content: result,
              timestamp: new Date().toISOString(),
              toolCallId: toolCall.id,
            }
            store.addMessage(activeSessionId, toolResultMessage)
          }

          // Add new assistant placeholder for the next round
          const nextPlaceholder: Message = {
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
          }
          store.addMessage(activeSessionId, nextPlaceholder)
          continueLoop = true
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        wasAborted = true
      } else {
        hasError = true
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        useChatStore.setState((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== activeSessionId) return s
            const messages = [...s.messages]
            const last = messages[messages.length - 1]
            if (last) {
              messages[messages.length - 1] = { ...last, content: errorMsg, isError: true }
            }
            return { ...s, messages }
          }),
        }))
      }
    } finally {
      store.setStreaming(false)
      abortRef.current = null

      // Remove trailing empty assistant message if present
      useChatStore.setState((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== activeSessionId) return s
          const messages = [...s.messages]
          const last = messages[messages.length - 1]
          if (last && last.role === 'assistant' && last.content === '' && !last.toolCalls && !last.isError) {
            messages.pop()
          }
          return { ...s, messages }
        }),
      }))

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
    // Also cancel any pending tool confirmation
    if (toolCallResolverRef.current) {
      toolCallResolverRef.current = null
      useChatStore.getState().setPendingToolCall(null)
    }
  }

  return { sendMessage, stopStreaming, respondToToolCall }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- src/hooks/__tests__/useChat.test.ts`
Expected: All pass.

- [ ] **Step 5: Run all tests**

Run: `npm run test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useChat.ts src/hooks/__tests__/useChat.test.ts
git commit -m "feat: implement agent loop with tool call confirmation in useChat"
```

---

### Task 8: ToolCallBubble component

**Files:**
- Create: `src/components/ToolCallBubble.tsx`
- Create: `src/components/__tests__/ToolCallBubble.test.tsx`

- [ ] **Step 1: Write test**

Create `src/components/__tests__/ToolCallBubble.test.tsx`:

```typescript
import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolCallBubble } from '../ToolCallBubble'

it('renders tool name and preview', () => {
  render(
    <ToolCallBubble
      name="bash"
      input={{ command: 'ls -la /home/user/project' }}
      output={null}
      status="completed"
    />
  )
  expect(screen.getByText(/bash/)).toBeInTheDocument()
  expect(screen.getByText(/ls -la/)).toBeInTheDocument()
})

it('shows output preview when output is provided', () => {
  render(
    <ToolCallBubble
      name="read_file"
      input={{ path: 'test.txt' }}
      output="line1\nline2\nline3\nline4\nline5\nline6"
      status="completed"
    />
  )
  expect(screen.getByText(/read_file/)).toBeInTheDocument()
  expect(screen.getByText(/line1/)).toBeInTheDocument()
})

it('expands to show full content on click', () => {
  const longOutput = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
  render(
    <ToolCallBubble
      name="bash"
      input={{ command: 'cat big.txt' }}
      output={longOutput}
      status="completed"
    />
  )
  const toggle = screen.getByRole('button')
  fireEvent.click(toggle)
  expect(screen.getByText(/line19/)).toBeInTheDocument()
})

it('shows running state', () => {
  render(
    <ToolCallBubble
      name="bash"
      input={{ command: 'npm install' }}
      output={null}
      status="running"
    />
  )
  expect(screen.getByText(/running/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/__tests__/ToolCallBubble.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ToolCallBubble**

Create `src/components/ToolCallBubble.tsx`:

```tsx
import { useState } from 'react'

interface Props {
  name: string
  input: Record<string, unknown>
  output: string | null
  status: 'pending' | 'running' | 'completed' | 'denied'
}

const PREVIEW_LINES = 5

function getPreview(text: string): { preview: string; hasMore: boolean } {
  const lines = text.split('\n')
  if (lines.length <= PREVIEW_LINES) {
    return { preview: text, hasMore: false }
  }
  return {
    preview: lines.slice(0, PREVIEW_LINES).join('\n'),
    hasMore: true,
  }
}

function formatInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
}

export function ToolCallBubble({ name, input, output, status }: Props) {
  const [expanded, setExpanded] = useState(false)

  const inputText = formatInput(input)
  const inputPreview = getPreview(inputText)
  const outputPreview = output ? getPreview(output) : null

  const statusLabel =
    status === 'running' ? '⟳ Running...' :
    status === 'denied' ? '✕ Denied' :
    status === 'completed' ? '✓' : '⏳'

  const statusColor =
    status === 'running' ? 'text-yellow-400' :
    status === 'denied' ? 'text-red-400' :
    status === 'completed' ? 'text-green-400' : 'text-gray-400'

  return (
    <div className="my-2 rounded-lg border border-gray-700 bg-gray-850 text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-blue-400">{name}</span>
          <span className={statusColor}>{statusLabel}</span>
        </span>
        <span className="text-gray-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {!expanded && (
        <div className="px-3 pb-2">
          <pre className="text-gray-400 text-xs whitespace-pre-wrap truncate">
            {inputPreview.preview.slice(0, 120)}{inputPreview.preview.length > 120 ? '...' : ''}
          </pre>
          {output && outputPreview && (
            <pre className="text-gray-300 text-xs whitespace-pre-wrap mt-1 border-t border-gray-700 pt-1">
              {outputPreview.preview}
              {outputPreview.hasMore && <span className="text-gray-500">...</span>}
            </pre>
          )}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <div className="text-xs text-gray-500 mb-1">Input</div>
            <pre className="text-gray-300 text-xs whitespace-pre-wrap bg-gray-900 rounded p-2">{inputText}</pre>
          </div>
          {output && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Output</div>
              <pre className="text-gray-300 text-xs whitespace-pre-wrap bg-gray-900 rounded p-2 max-h-64 overflow-y-auto">{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test**

Run: `npm run test -- src/components/__tests__/ToolCallBubble.test.tsx`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ToolCallBubble.tsx src/components/__tests__/ToolCallBubble.test.tsx
git commit -m "feat: add ToolCallBubble component for displaying tool calls"
```

---

### Task 9: ToolConfirmDialog component

**Files:**
- Create: `src/components/ToolConfirmDialog.tsx`
- Create: `src/components/__tests__/ToolConfirmDialog.test.tsx`

- [ ] **Step 1: Write test**

Create `src/components/__tests__/ToolConfirmDialog.test.tsx`:

```typescript
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolConfirmDialog } from '../ToolConfirmDialog'

it('renders tool name and arguments', () => {
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'bash', arguments: { command: 'ls' } }}
      onRespond={vi.fn()}
    />
  )
  expect(screen.getByText(/bash/)).toBeInTheDocument()
  expect(screen.getByText(/ls/)).toBeInTheDocument()
})

it('calls onRespond with allow when Allow is clicked', () => {
  const onRespond = vi.fn()
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'bash', arguments: { command: 'ls' } }}
      onRespond={onRespond}
    />
  )
  fireEvent.click(screen.getByText('Allow'))
  expect(onRespond).toHaveBeenCalledWith('allow')
})

it('calls onRespond with deny when Deny is clicked', () => {
  const onRespond = vi.fn()
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'read_file', arguments: { path: 'x.txt' } }}
      onRespond={onRespond}
    />
  )
  fireEvent.click(screen.getByText('Deny'))
  expect(onRespond).toHaveBeenCalledWith('deny')
})

it('calls onRespond with always_allow and shows tool name', () => {
  const onRespond = vi.fn()
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'read_file', arguments: { path: 'x.txt' } }}
      onRespond={onRespond}
    />
  )
  const alwaysBtn = screen.getByText(/Always allow read_file/)
  fireEvent.click(alwaysBtn)
  expect(onRespond).toHaveBeenCalledWith('always_allow')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/__tests__/ToolConfirmDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ToolConfirmDialog**

Create `src/components/ToolConfirmDialog.tsx`:

```tsx
import { ToolCall } from '../types'

interface Props {
  toolCall: ToolCall
  onRespond: (action: 'allow' | 'deny' | 'always_allow') => void
}

export function ToolConfirmDialog({ toolCall, onRespond }: Props) {
  const argsDisplay = Object.entries(toolCall.arguments)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')

  return (
    <div className="my-2 rounded-lg border border-yellow-600 bg-gray-900 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400">⚠</span>
        <span className="text-white font-medium">
          Tool call: <span className="font-mono text-blue-400">{toolCall.name}</span>
        </span>
      </div>

      <pre className="text-gray-300 text-xs whitespace-pre-wrap bg-gray-800 rounded p-2 mb-3">
        {argsDisplay}
      </pre>

      <div className="flex gap-2">
        <button
          onClick={() => onRespond('allow')}
          className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
        >
          Allow
        </button>
        <button
          onClick={() => onRespond('deny')}
          className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => onRespond('always_allow')}
          className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
        >
          Always allow {toolCall.name}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test**

Run: `npm run test -- src/components/__tests__/ToolConfirmDialog.test.tsx`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ToolConfirmDialog.tsx src/components/__tests__/ToolConfirmDialog.test.tsx
git commit -m "feat: add ToolConfirmDialog component with allow/deny/always-allow"
```

---

### Task 10: Update MessageBubble to render tool messages

**Files:**
- Modify: `src/components/MessageBubble.tsx`
- Modify: `src/components/__tests__/MessageBubble.test.tsx`

- [ ] **Step 1: Write tests for tool message rendering**

Add to `src/components/__tests__/MessageBubble.test.tsx`:

```typescript
it('renders tool call bubbles for assistant messages with toolCalls', () => {
  render(
    <MessageBubble
      message={{
        role: 'assistant',
        content: 'Let me check that file.',
        timestamp: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'test.txt' } }],
      }}
      toolResults={{}}
    />
  )
  expect(screen.getByText(/read_file/)).toBeInTheDocument()
  expect(screen.getByText(/Let me check that file/)).toBeInTheDocument()
})

it('renders tool result messages with ToolCallBubble', () => {
  render(
    <MessageBubble
      message={{
        role: 'tool',
        content: 'file contents here',
        timestamp: '',
        toolCallId: 'c1',
      }}
      toolResults={{}}
    />
  )
  // Tool result messages are rendered as part of the assistant flow, not standalone
  // They should show the content
  expect(screen.getByText(/file contents here/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to see what needs updating**

Run: `npm run test -- src/components/__tests__/MessageBubble.test.tsx`
Expected: Failures — new props not matching existing component signature.

- [ ] **Step 3: Update MessageBubble**

Replace `src/components/MessageBubble.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../types'
import { ToolCallBubble } from './ToolCallBubble'

interface Props {
  message: Message
  toolResults?: Record<string, string>  // toolCallId -> result content
}

export function MessageBubble({ message, toolResults = {} }: Props) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  if (isTool) {
    return (
      <div className="flex justify-start mb-2 pl-4">
        <div className="max-w-[75%]">
          <ToolCallBubble
            name="result"
            input={{}}
            output={message.content}
            status="completed"
          />
        </div>
      </div>
    )
  }

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
          <>
            {message.content && (
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
            {!message.content && !message.toolCalls && (
              <ReactMarkdown>{'▋'}</ReactMarkdown>
            )}
            {message.toolCalls?.map((tc) => (
              <ToolCallBubble
                key={tc.id}
                name={tc.name}
                input={tc.arguments}
                output={toolResults[tc.id] ?? null}
                status={toolResults[tc.id] !== undefined ? 'completed' : 'running'}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update existing MessageBubble tests for new optional prop**

Review existing tests in `src/components/__tests__/MessageBubble.test.tsx`. If they don't pass `toolResults`, they should still work since it defaults to `{}`. If any fail due to import changes, fix them.

- [ ] **Step 5: Run tests**

Run: `npm run test -- src/components/__tests__/MessageBubble.test.tsx`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/MessageBubble.tsx src/components/__tests__/MessageBubble.test.tsx
git commit -m "feat: update MessageBubble to render tool calls and tool results"
```

---

### Task 11: Update ChatWindow to integrate tool confirmation

**Files:**
- Modify: `src/components/ChatWindow.tsx`

- [ ] **Step 1: Update ChatWindow**

Replace `src/components/ChatWindow.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../store/useChatStore'
import { useChat } from '../hooks/useChat'
import { MessageBubble } from './MessageBubble'
import { ToolConfirmDialog } from './ToolConfirmDialog'

export function ChatWindow() {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { activeSessionId, sessions, isStreaming, pendingToolCall } = useChatStore()
  const { sendMessage, stopStreaming, respondToToolCall } = useChat()

  const session = sessions.find((s) => s.id === activeSessionId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages.length, isStreaming, pendingToolCall])

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

  // Build a map of toolCallId -> result content for display
  const toolResults: Record<string, string> = {}
  if (session) {
    for (const msg of session.messages) {
      if (msg.role === 'tool' && msg.toolCallId) {
        toolResults[msg.toolCallId] = msg.content
      }
    }
  }

  // Filter out tool messages from the main list (they're shown inside ToolCallBubble via toolResults)
  const visibleMessages = session?.messages.filter((m) => m.role !== 'tool') ?? []

  return (
    <div className="flex flex-col h-full">
      {session?.workingDirectory && (
        <div className="px-4 py-1.5 bg-gray-900 border-b border-gray-700 text-xs text-gray-500 font-mono truncate">
          📁 {session.workingDirectory}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {visibleMessages.map((msg, i) => (
          <MessageBubble key={i} message={msg} toolResults={toolResults} />
        ))}

        {pendingToolCall && (
          <ToolConfirmDialog
            toolCall={pendingToolCall}
            onRespond={respondToToolCall}
          />
        )}

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

- [ ] **Step 2: Run ChatWindow tests**

Run: `npm run test -- src/components/__tests__/ChatWindow.test.tsx`
Expected: Likely needs updates for `respondToToolCall` from `useChat`. Fix any failures.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatWindow.tsx src/components/__tests__/ChatWindow.test.tsx
git commit -m "feat: integrate tool confirmation dialog and tool result display in ChatWindow"
```

---

### Task 12: Update Sidebar for directory picker on new session

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Update Sidebar to use directory picker**

Replace `src/components/Sidebar.tsx`:

```tsx
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useChatStore } from '../store/useChatStore'

interface Props {
  onOpenSettings: () => void
}

export function Sidebar({ onOpenSettings }: Props) {
  const { sessions, activeSessionId, createSessionWithDir, deleteSession, setActiveSession } = useChatStore()

  const handleNewChat = async () => {
    const selected = await open({ directory: true, title: 'Select working directory' })
    if (selected) {
      createSessionWithDir(selected as string)
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteSession(id)
    await invoke('delete_session', { id }).catch(console.error)
  }

  return (
    <div className="w-60 flex flex-col h-full bg-gray-900 border-r border-gray-700">
      <div className="p-3">
        <button
          onClick={handleNewChat}
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

- [ ] **Step 2: Update Sidebar test**

In `src/components/__tests__/Sidebar.test.tsx`, update the mock and test for directory picker:

Add at top of test file:
```typescript
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue('/mock/dir'),
}))
```

Update the "new chat" test to verify `createSessionWithDir` is called (via store state check) after clicking the button and awaiting the dialog.

- [ ] **Step 3: Run Sidebar tests**

Run: `npm run test -- src/components/__tests__/Sidebar.test.tsx`
Expected: All pass.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/__tests__/Sidebar.test.tsx
git commit -m "feat: trigger directory picker on new session creation"
```

---

### Task 13: Update Rust Settings struct for apiFormat

**Files:**
- Modify: `src-tauri/src/commands.rs`

The Rust `Settings` struct currently doesn't have `apiFormat`. Since the frontend sends it via `save_settings`, we need to add it to avoid deserialization failures.

- [ ] **Step 1: Update Settings struct**

In `src-tauri/src/commands.rs`, update:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_format: Option<String>,
}
```

- [ ] **Step 2: Update the settings roundtrip test**

```rust
#[test]
fn test_settings_roundtrip() {
    let settings = Settings {
        base_url: "http://localhost:4000".to_string(),
        api_key: "sk-test".to_string(),
        model: "gpt-4o".to_string(),
        api_format: Some("completions".to_string()),
    };
    let json = serde_json::to_string(&settings).unwrap();
    let parsed: Settings = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.base_url, "http://localhost:4000");
    assert_eq!(parsed.api_format, Some("completions".to_string()));
}
```

- [ ] **Step 3: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "fix: add apiFormat to Rust Settings struct for frontend compatibility"
```

---

### Task 14: Integration test — full end-to-end flow

**Files:**
- Modify: `src/hooks/__tests__/useChat.test.ts`

- [ ] **Step 1: Write an integration test for the full agent loop**

Add to `src/hooks/__tests__/useChat.test.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core'

it('executes tool call and sends result back to LLM when allowed', async () => {
  let callCount = 0
  vi.mocked(llm.streamChat).mockImplementation(async (_msgs, _settings, onEvent, _signal) => {
    callCount++
    if (callCount === 1) {
      // First call: LLM requests a tool call
      onEvent({ type: 'text_delta', text: 'Let me read that.' })
      onEvent({ type: 'tool_call', toolCall: { id: 'c1', name: 'read_file', arguments: { path: 'test.txt' } } })
    } else {
      // Second call: LLM responds with the tool result
      onEvent({ type: 'text_delta', text: 'The file says hello.' })
    }
  })
  vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: any) => {
    if (cmd === 'execute_read_file') return 'hello world'
    return undefined as any
  })

  // Pre-allow read_file so we don't need confirmation
  useChatStore.setState((state) => ({
    sessions: state.sessions.map((s) => ({ ...s, allowedTools: ['read_file'] })),
  }))

  const { result } = renderHook(() => useChat())
  await act(async () => {
    await result.current.sendMessage('read test.txt')
  })

  const session = useChatStore.getState().sessions[0]
  // Should have: user, assistant(with toolCalls), tool result, assistant(final)
  expect(session.messages).toHaveLength(4)
  expect(session.messages[0].role).toBe('user')
  expect(session.messages[1].role).toBe('assistant')
  expect(session.messages[1].toolCalls).toHaveLength(1)
  expect(session.messages[2].role).toBe('tool')
  expect(session.messages[2].content).toBe('hello world')
  expect(session.messages[3].role).toBe('assistant')
  expect(session.messages[3].content).toBe('The file says hello.')
})
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- src/hooks/__tests__/useChat.test.ts`
Expected: All pass.

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/__tests__/useChat.test.ts
git commit -m "test: add integration test for full agent loop with tool execution"
```

---

### Task 15: Verify Tauri build compiles

- [ ] **Step 1: Check TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Check Rust compilation**

Run: `cd src-tauri && cargo check`
Expected: No errors.

- [ ] **Step 3: Run full test suite one final time**

Run: `npm run test && cd src-tauri && cargo test`
Expected: All pass.

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "chore: fixups from build verification"
```
