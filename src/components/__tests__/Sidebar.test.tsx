import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import { useChatStore } from '../../store/useChatStore'
import { act } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => {
  useChatStore.setState({ sessions: [], activeSessionId: null, settings: null, isStreaming: false })
})

it('renders New Chat button', () => {
  render(<Sidebar onOpenSettings={vi.fn()} />)
  expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
})

it('creates a new session on New Chat click', () => {
  render(<Sidebar onOpenSettings={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /\+ new chat/i }))
  expect(useChatStore.getState().sessions).toHaveLength(1)
})

it('calls onOpenSettings when settings button clicked', () => {
  const onOpenSettings = vi.fn()
  render(<Sidebar onOpenSettings={onOpenSettings} />)
  fireEvent.click(screen.getByRole('button', { name: /settings/i }))
  expect(onOpenSettings).toHaveBeenCalled()
})
