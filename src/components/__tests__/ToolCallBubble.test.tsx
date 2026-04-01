import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolCallBubble } from '../ToolCallBubble'

it('renders tool name and preview', () => {
  render(
    <ToolCallBubble
      name="bash"
      input={{ command: 'ls -la /home/user/project' }}
      output={null}
      status="completed"
    />
  )
  expect(screen.getByText(/bash/)).toBeInTheDocument()
  expect(screen.getByText(/ls -la/)).toBeInTheDocument()
})

it('shows output preview when output is provided', () => {
  render(
    <ToolCallBubble
      name="read_file"
      input={{ path: 'test.txt' }}
      output="line1\nline2\nline3\nline4\nline5\nline6"
      status="completed"
    />
  )
  expect(screen.getByText(/read_file/)).toBeInTheDocument()
  expect(screen.getByText(/line1/)).toBeInTheDocument()
})

it('expands to show full content on click', () => {
  const longOutput = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
  render(
    <ToolCallBubble
      name="bash"
      input={{ command: 'cat big.txt' }}
      output={longOutput}
      status="completed"
    />
  )
  const toggle = screen.getByRole('button')
  fireEvent.click(toggle)
  expect(screen.getByText(/line19/)).toBeInTheDocument()
})

it('shows running state', () => {
  render(
    <ToolCallBubble
      name="bash"
      input={{ command: 'npm install' }}
      output={null}
      status="running"
    />
  )
  expect(screen.getByText(/running/i)).toBeInTheDocument()
})
