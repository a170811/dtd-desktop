import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Settings } from '../types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (settings: Settings) => void
  initialValues?: Settings | null
}

export function SettingsModal({ isOpen, onClose, onSave, initialValues }: Props) {
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')
  const [model, setModel] = useState(initialValues?.model ?? '')
  const [apiFormat, setApiFormat] = useState<'responses' | 'completions'>(initialValues?.apiFormat ?? 'completions')

  useEffect(() => {
    if (initialValues) {
      setBaseUrl(initialValues.baseUrl)
      setApiKey(initialValues.apiKey)
      setModel(initialValues.model)
      setApiFormat(initialValues.apiFormat ?? 'completions')
    }
  }, [initialValues])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const settings: Settings = { baseUrl, apiKey, model, apiFormat }
    await invoke('save_settings', { settings })
    onSave(settings)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="baseUrl" className="block text-sm text-gray-300 mb-1">Base URL</label>
            <input
              id="baseUrl"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
              placeholder="http://localhost:4000"
              required
            />
          </div>
          <div>
            <label htmlFor="apiKey" className="block text-sm text-gray-300 mb-1">API Key</label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
              placeholder="sk-..."
              required
            />
          </div>
          <div>
            <label htmlFor="model" className="block text-sm text-gray-300 mb-1">Model</label>
            <input
              id="model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
              placeholder="gpt-4o"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">API Format</label>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as 'responses' | 'completions')}
              className="w-full bg-gray-800 text-white rounded px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
            >
              <option value="completions">Chat Completions (/v1/chat/completions)</option>
              <option value="responses">Responses (/v1/responses)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
