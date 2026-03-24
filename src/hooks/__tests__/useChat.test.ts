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
