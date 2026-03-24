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
  render(
    <MessageBubble message={{ role: 'assistant', content: '**Bold text**', timestamp: '' }} />
  )
  expect(screen.getByRole('strong')).toBeInTheDocument()
})

it('renders error message with red text class', () => {
  const { container } = render(
    <MessageBubble message={{ role: 'assistant', content: 'Error occurred', timestamp: '', isError: true }} />
  )
  expect(container.querySelector('.text-red-400')).toBeInTheDocument()
})
