import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolConfirmDialog } from '../ToolConfirmDialog'

it('renders tool name and arguments', () => {
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'bash', arguments: { command: 'ls' } }}
      onRespond={vi.fn()}
    />
  )
  expect(screen.getByText(/bash/)).toBeInTheDocument()
  expect(screen.getByText(/ls/)).toBeInTheDocument()
})

it('calls onRespond with allow when Allow is clicked', () => {
  const onRespond = vi.fn()
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'bash', arguments: { command: 'ls' } }}
      onRespond={onRespond}
    />
  )
  fireEvent.click(screen.getByText('Allow'))
  expect(onRespond).toHaveBeenCalledWith('allow')
})

it('calls onRespond with deny when Deny is clicked', () => {
  const onRespond = vi.fn()
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'read_file', arguments: { path: 'x.txt' } }}
      onRespond={onRespond}
    />
  )
  fireEvent.click(screen.getByText('Deny'))
  expect(onRespond).toHaveBeenCalledWith('deny')
})

it('calls onRespond with always_allow and shows tool name', () => {
  const onRespond = vi.fn()
  render(
    <ToolConfirmDialog
      toolCall={{ id: 'c1', name: 'read_file', arguments: { path: 'x.txt' } }}
      onRespond={onRespond}
    />
  )
  const alwaysBtn = screen.getByText(/Always allow read_file/)
  fireEvent.click(alwaysBtn)
  expect(onRespond).toHaveBeenCalledWith('always_allow')
})
