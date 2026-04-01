import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import { useChatStore } from '../../store/useChatStore'
import { open } from '@tauri-apps/plugin-dialog'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue('/mock/dir'),
}))

beforeEach(() => {
  useChatStore.setState({ sessions: [], activeSessionId: null, settings: null, isStreaming: false })
})

it('renders New Chat button', () => {
  render(<Sidebar onOpenSettings={vi.fn()} />)
  expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
})

it('creates a new session with directory on New Chat click', async () => {
  render(<Sidebar onOpenSettings={vi.fn()} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /\+ new chat/i }))
  })
  expect(open).toHaveBeenCalledWith({ directory: true, title: 'Select working directory' })
  expect(useChatStore.getState().sessions).toHaveLength(1)
  expect(useChatStore.getState().sessions[0].workingDirectory).toBe('/mock/dir')
})

it('calls onOpenSettings when settings button clicked', () => {
  const onOpenSettings = vi.fn()
  render(<Sidebar onOpenSettings={onOpenSettings} />)
  fireEvent.click(screen.getByRole('button', { name: /settings/i }))
  expect(onOpenSettings).toHaveBeenCalled()
})
