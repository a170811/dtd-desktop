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
