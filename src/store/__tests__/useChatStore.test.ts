import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatStore } from '../useChatStore'

beforeEach(() => {
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    settings: null,
    isStreaming: false,
  })
})

describe('createSession', () => {
  it('adds a new session and sets it active', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.activeSessionId).toBe(result.current.sessions[0].id)
  })

  it('sets title from first message', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    const id = result.current.sessions[0].id
    act(() => result.current.addMessage(id, { role: 'user', content: 'Hello world this is a test', timestamp: new Date().toISOString() }))
    expect(result.current.sessions[0].title).toBe('Hello world this is a test')
  })
})

describe('deleteSession', () => {
  it('removes the session', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    const id = result.current.sessions[0].id
    act(() => result.current.deleteSession(id))
    expect(result.current.sessions).toHaveLength(0)
    expect(result.current.activeSessionId).toBeNull()
  })
})

describe('appendChunk', () => {
  it('accumulates chunks on the last assistant message', () => {
    const { result } = renderHook(() => useChatStore())
    act(() => result.current.createSession())
    const id = result.current.sessions[0].id
    act(() => result.current.addMessage(id, { role: 'assistant', content: '', timestamp: new Date().toISOString() }))
    act(() => result.current.appendChunk(id, 'Hello'))
    act(() => result.current.appendChunk(id, ' world'))
    const msg = result.current.sessions[0].messages[0]
    expect(msg.content).toBe('Hello world')
  })
})
