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

  // Build toolResults map from tool messages in session
  const toolResults: Record<string, string> = {}
  if (session) {
    for (const msg of session.messages) {
      if (msg.role === 'tool' && msg.toolCallId) {
        toolResults[msg.toolCallId] = msg.content
      }
    }
  }

  // Filter out tool messages (they're shown via ToolCallBubble on the assistant message)
  const visibleMessages = session?.messages.filter((m) => m.role !== 'tool') ?? []

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

  return (
    <div className="flex flex-col h-full">
      {session?.workingDirectory && (
        <div className="px-4 py-1 text-xs text-gray-500 border-b border-gray-700 bg-gray-900 truncate">
          {session.workingDirectory}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {visibleMessages.map((msg, i) => (
          <MessageBubble key={i} message={msg} toolResults={toolResults} />
        ))}
        {pendingToolCall && (
          <ToolConfirmDialog toolCall={pendingToolCall} onRespond={respondToToolCall} />
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
