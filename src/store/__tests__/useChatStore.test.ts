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
