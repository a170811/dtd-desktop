import { useState } from 'react'

interface Props {
  name: string
  input: Record<string, unknown>
  output: string | null
  status: 'pending' | 'running' | 'completed' | 'denied'
}

const PREVIEW_LINES = 5

function getPreview(text: string): { preview: string; hasMore: boolean } {
  const lines = text.split('\n')
  if (lines.length <= PREVIEW_LINES) {
    return { preview: text, hasMore: false }
  }
  return {
    preview: lines.slice(0, PREVIEW_LINES).join('\n'),
    hasMore: true,
  }
}

function formatInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
}

export function ToolCallBubble({ name, input, output, status }: Props) {
  const [expanded, setExpanded] = useState(false)

  const inputText = formatInput(input)
  const inputPreview = getPreview(inputText)
  const outputPreview = output ? getPreview(output) : null

  const statusLabel =
    status === 'running' ? '⟳ Running...' :
    status === 'denied' ? '✕ Denied' :
    status === 'completed' ? '✓' : '⏳'

  const statusColor =
    status === 'running' ? 'text-yellow-400' :
    status === 'denied' ? 'text-red-400' :
    status === 'completed' ? 'text-green-400' : 'text-gray-400'

  return (
    <div className="my-2 rounded-lg border border-gray-700 bg-gray-850 text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800 rounded-lg transition-colors text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-blue-400">{name}</span>
          <span className={statusColor}>{statusLabel}</span>
        </span>
        <span className="text-gray-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {!expanded && (
        <div className="px-3 pb-2">
          <pre className="text-gray-400 text-xs whitespace-pre-wrap truncate">
            {inputPreview.preview.slice(0, 120)}{inputPreview.preview.length > 120 ? '...' : ''}
          </pre>
          {output && outputPreview && (
            <pre className="text-gray-300 text-xs whitespace-pre-wrap mt-1 border-t border-gray-700 pt-1">
              {outputPreview.preview}
              {outputPreview.hasMore && <span className="text-gray-500">...</span>}
            </pre>
          )}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <div className="text-xs text-gray-500 mb-1">Input</div>
            <pre className="text-gray-300 text-xs whitespace-pre-wrap bg-gray-900 rounded p-2">{inputText}</pre>
          </div>
          {output && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Output</div>
              <pre className="text-gray-300 text-xs whitespace-pre-wrap bg-gray-900 rounded p-2 max-h-64 overflow-y-auto">{output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
