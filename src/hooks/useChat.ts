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

    const userMessage: Message = { role: 'user', content, timestamp: new Date().toISOString() }
    store.addMessage(activeSessionId, userMessage)

    const assistantPlaceholder: Message = { role: 'assistant', content: '', timestamp: new Date().toISOString() }
    store.addMessage(activeSessionId, assistantPlaceholder)
    store.setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    let hasError = false
    let wasAborted = false

    try {
      let continueLoop = true
      while (continueLoop) {
        continueLoop = false
        const currentSession = useChatStore.getState().sessions.find((s) => s.id === activeSessionId)!
        // Send all messages except the trailing empty assistant placeholder
        const messagesToSend = currentSession.messages.filter((m, i) => {
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

        if (collectedToolCalls.length > 0) {
          // Update assistant message with toolCalls
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

          const workingDir = currentSession.workingDirectory
          if (!workingDir) {
            // Legacy sessions without a working directory can't execute tools
            for (const toolCall of collectedToolCalls) {
              const toolResultMessage: Message = {
                role: 'tool',
                content: `Error: No working directory set for this session. Create a new session to use tools.`,
                timestamp: new Date().toISOString(),
                toolCallId: toolCall.id,
              }
              store.addMessage(activeSessionId, toolResultMessage)
            }
            const nextPlaceholder: Message = { role: 'assistant', content: '', timestamp: new Date().toISOString() }
            store.addMessage(activeSessionId, nextPlaceholder)
            continueLoop = true
            continue
          }

          for (const toolCall of collectedToolCalls) {
            const latestSession = useChatStore.getState().sessions.find((s) => s.id === activeSessionId)!
            const allowed = latestSession.allowedTools ?? []

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

            const toolResultMessage: Message = {
              role: 'tool',
              content: result,
              timestamp: new Date().toISOString(),
              toolCallId: toolCall.id,
            }
            store.addMessage(activeSessionId, toolResultMessage)
          }

          // Add new assistant placeholder for next round
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

      // Remove trailing empty assistant message
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
    if (toolCallResolverRef.current) {
      // Resolve with 'deny' so the pending promise settles and sendMessage can reach its finally block
      toolCallResolverRef.current.resolve({ action: 'deny' })
      toolCallResolverRef.current = null
      useChatStore.getState().setPendingToolCall(null)
    }
  }

  return { sendMessage, stopStreaming, respondToToolCall }
}
