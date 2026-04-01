import { it, expect } from 'vitest'
import type { Message, Session, ToolCall } from '../../types'

it('Message type accepts tool role with toolCallId', () => {
  const msg: Message = {
    role: 'tool',
    content: 'file contents here',
    timestamp: '2026-01-01T00:00:00Z',
    toolCallId: 'call_123',
  }
  expect(msg.role).toBe('tool')
  expect(msg.toolCallId).toBe('call_123')
})

it('Message type accepts assistant role with toolCalls', () => {
  const toolCall: ToolCall = { id: 'call_1', name: 'bash', arguments: { command: 'ls' } }
  const msg: Message = {
    role: 'assistant',
    content: '',
    timestamp: '2026-01-01T00:00:00Z',
    toolCalls: [toolCall],
  }
  expect(msg.toolCalls).toHaveLength(1)
  expect(msg.toolCalls![0].name).toBe('bash')
})

it('Session type includes workingDirectory and allowedTools', () => {
  const session: Session = {
    id: '123',
    title: 'Test',
    createdAt: '2026-01-01T00:00:00Z',
    messages: [],
    workingDirectory: '/home/user/project',
    allowedTools: ['read_file'],
  }
  expect(session.workingDirectory).toBe('/home/user/project')
  expect(session.allowedTools).toContain('read_file')
})
