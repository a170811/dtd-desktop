import { it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from '../MessageBubble'

it('renders user message right-aligned', () => {
  const { container } = render(
    <MessageBubble message={{ role: 'user', content: 'Hello', timestamp: '' }} />
  )
  expect(screen.getByText('Hello')).toBeInTheDocument()
  expect(container.firstChild).toHaveClass('justify-end')
})

it('renders assistant message with markdown bold', () => {
  const { container } = render(
    <MessageBubble message={{ role: 'assistant', content: '**Bold text**', timestamp: '' }} />
  )
  expect(container.querySelector('strong')).toBeInTheDocument()
})

it('renders error message with red text class', () => {
  const { container } = render(
    <MessageBubble message={{ role: 'assistant', content: 'Error occurred', timestamp: '', isError: true }} />
  )
  expect(container.querySelector('.text-red-400')).toBeInTheDocument()
})

it('renders tool call bubbles for assistant messages with toolCalls', () => {
  render(
    <MessageBubble
      message={{
        role: 'assistant',
        content: 'Let me check that file.',
        timestamp: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'test.txt' } }],
      }}
      toolResults={{}}
    />
  )
  expect(screen.getByText(/read_file/)).toBeInTheDocument()
  expect(screen.getByText(/Let me check that file/)).toBeInTheDocument()
})

it('renders tool result messages', () => {
  render(
    <MessageBubble
      message={{
        role: 'tool',
        content: 'file contents here',
        timestamp: '',
        toolCallId: 'c1',
      }}
      toolResults={{}}
    />
  )
  expect(screen.getByText(/file contents here/)).toBeInTheDocument()
})
