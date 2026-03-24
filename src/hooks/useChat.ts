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

    if (store.isStreaming) return

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
