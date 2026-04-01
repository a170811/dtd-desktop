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
  addAllowedTool: (sessionId: string, toolName: string) => void
  updateSession: (sessionId: string, updates: Partial<Session>) => void
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

  createSessionWithDir: (workingDirectory) => {
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

  addAllowedTool: (sessionId, toolName) => {
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id !== sessionId) return s
        const existing = s.allowedTools ?? []
        if (existing.includes(toolName)) return s
        return { ...s, allowedTools: [...existing, toolName] }
      }),
    }))
  },

  updateSession: (sessionId, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    }))
  },

  setPendingToolCall: (toolCall) => set({ pendingToolCall: toolCall }),

  setStreaming: (value) => set({ isStreaming: value }),
  setSessions: (sessions) => set({ sessions }),
  setSettings: (settings) => set({ settings }),
}))
