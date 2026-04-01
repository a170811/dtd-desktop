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

it('sets pendingToolCall when LLM emits a tool_call event for non-allowed tool', async () => {
  const toolCall = { id: 'call_1', name: 'bash', arguments: { command: 'ls' } }

  vi.mocked(llm.streamChat).mockImplementation(async (_msgs, _settings, onEvent, _signal) => {
    onEvent({ type: 'tool_call', toolCall })
  })

  const { result } = renderHook(() => useChat())
  // Don't await — sendMessage will pause waiting for tool confirmation
  act(() => {
    result.current.sendMessage('list files')
  })

  // Wait for the promise to reach the pending state
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

  expect(useChatStore.getState().pendingToolCall).toEqual(toolCall)
})
