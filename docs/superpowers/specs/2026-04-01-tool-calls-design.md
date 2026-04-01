# Tool Call Feature Design

## Overview

Add 4 tools (bash, read_file, write_file, edit_file) to dtd-desktop, enabling the LLM to operate on the user's local filesystem. Tools execute in the Rust backend, require user confirmation (with per-tool bypass), and each session is bound to a working directory selected at creation time.

## Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `bash` | `command: string` | Execute shell command. cwd = session working directory. Timeout 120s. |
| `read_file` | `path: string`, `limit?: number` | Read file contents. `limit` caps line count. Path must be within working directory. |
| `write_file` | `path: string`, `content: string` | Write file. Auto-creates parent directories. Path must be within working directory. |
| `edit_file` | `path: string`, `old_text: string`, `new_text: string` | Replace first occurrence of `old_text` with `new_text`. Path must be within working directory. |

## Working Directory

- New session creation triggers a directory picker dialog (Tauri `open` dialog).
- Stored in session data; immutable once set.
- `read_file`, `write_file`, `edit_file`: resolved path must be under working directory.
- `bash`: cwd set to working directory, no further path restriction on command content.

## User Confirmation Flow

When a tool call arrives:

1. UI displays tool name + parameters.
2. User chooses: **Allow** / **Deny** / **Always allow [tool_name]**.
3. "Always allow" records are stored per-session in `allowedTools: string[]`.
4. Denied tool calls return an error message to the LLM so it can adapt.
5. Bypassed tools execute automatically without confirmation.

## LLM Integration

Both API formats must support tool calls.

### Chat Completions

- **Request**: Add `tools` array to request body (OpenAI function calling format).
- **Streaming**: Parse `choices[0].delta.tool_calls` to accumulate tool call chunks (id, function name, arguments arrive incrementally).
- **Result**: Send back as `role: "tool"` message with `tool_call_id`.

### Responses API

- **Request**: Add `tools` array to request body.
- **Streaming**: Parse `function_call` output items.
- **Result**: Send back as function result per Responses API format.

## Agent Loop

```
LLM streaming
  → detect tool_call → pause streaming
  → show confirmation UI (unless bypassed)
  → user allows → invoke Rust command → get result
  → send tool result back to LLM → continue streaming
  → repeat until LLM stops calling tools
```

## Rust Backend — New Tauri Commands

```
execute_bash(command, working_dir) → Result<String, String>
execute_read_file(path, working_dir, limit?) → Result<String, String>
execute_write_file(path, working_dir, content) → Result<String, String>
execute_edit_file(path, working_dir, old_text, new_text) → Result<String, String>
```

Each command internally:

- **Path validation** (bash excluded): resolve path, confirm it is under `working_dir`.
- **bash**: macOS/Linux uses `sh -c`, Windows uses `cmd /C`. Determined via `cfg!(target_os)`.
- **Output truncation**: Cap at 50 KB to prevent memory issues.
- **Dangerous command blocking** (bash): Block patterns like `rm -rf /`, `sudo`, `shutdown`, `reboot`.

## Data Structure Changes

### Session — new fields

```typescript
workingDirectory: string | null   // absolute path, set at session creation
allowedTools: string[]            // tool names the user has "always allowed"
```

### Message — extended

```typescript
interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: string
  isError?: boolean
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[]  // on assistant messages
  toolCallId?: string   // on tool result messages
}
```

### Rust structs updated accordingly

`Session` gains `working_directory: Option<String>` and `allowed_tools: Vec<String>`.
`Message` gains `tool_calls: Option<Vec<ToolCall>>`, `tool_call_id: Option<String>`, and `role` accepts `"tool"`.

## UI

### Tool call display

- **Invocation**: Tool name + first few lines of arguments as preview. Expandable to full arguments.
- **Result**: First few lines of output as preview. Expandable to full content.
- **Pending confirmation**: Shows Allow / Deny / Always Allow buttons inline.
- **Failed**: Shows error message.

### New session flow

- "New Session" button triggers directory picker first.
- If user cancels the picker, session is not created.
- Working directory shown in session header or sidebar.

## Cross-Platform

- **bash**: `sh -c` on macOS/Linux, `cmd /C` on Windows. Via `cfg!(target_os = "windows")`.
- **Path separators**: Handled by Rust's `std::path::Path`.
- **Directory picker**: Tauri dialog plugin, works on both platforms.
- **File encoding**: UTF-8 assumed for read/write/edit operations.
