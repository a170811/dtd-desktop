import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatWindow } from '../ChatWindow'
import { useChatStore } from '../../store/useChatStore'
import { act } from '@testing-library/react'

vi.mock('../../hooks/useChat', () => ({
  useChat: () => ({ sendMessage: vi.fn(), stopStreaming: vi.fn(), respondToToolCall: vi.fn() }),
}))

beforeEach(() => {
  useChatStore.setState({ sessions: [], activeSessionId: null, settings: null, isStreaming: false, pendingToolCall: null })
  act(() => useChatStore.getState().createSession())
})

it('renders input placeholder', () => {
  render(<ChatWindow />)
  expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument()
})

it('input is disabled while streaming', () => {
  useChatStore.setState((s) => ({ ...s, isStreaming: true }))
  render(<ChatWindow />)
  expect(screen.getByPlaceholderText(/type a message/i)).toBeDisabled()
})

it('shows Stop button while streaming', () => {
  useChatStore.setState((s) => ({ ...s, isStreaming: true }))
  render(<ChatWindow />)
  expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
})
