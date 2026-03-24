import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsModal } from '../SettingsModal'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => vi.clearAllMocks())

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
}

it('renders form fields', () => {
  render(<SettingsModal {...defaultProps} />)
  expect(screen.getByLabelText(/base url/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/model/i)).toBeInTheDocument()
})

it('calls onSave with form values on submit', async () => {
  render(<SettingsModal {...defaultProps} />)
  fireEvent.change(screen.getByLabelText(/base url/i), { target: { value: 'http://localhost:4000' } })
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-abc' } })
  fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'gpt-4o' } })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() =>
    expect(defaultProps.onSave).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:4000',
      apiKey: 'sk-abc',
      model: 'gpt-4o',
    })
  )
})
