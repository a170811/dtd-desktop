import { ToolCall } from '../types'

interface Props {
  toolCall: ToolCall
  onRespond: (action: 'allow' | 'deny' | 'always_allow') => void
}

export function ToolConfirmDialog({ toolCall, onRespond }: Props) {
  const argsDisplay = Object.entries(toolCall.arguments)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')

  return (
    <div className="my-2 rounded-lg border border-yellow-600 bg-gray-900 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400">⚠</span>
        <span className="text-white font-medium">Tool call requested</span>
      </div>

      <pre className="text-gray-300 text-xs whitespace-pre-wrap bg-gray-800 rounded p-2 mb-3">
        {argsDisplay}
      </pre>

      <div className="flex gap-2">
        <button
          onClick={() => onRespond('allow')}
          className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
        >
          Allow
        </button>
        <button
          onClick={() => onRespond('deny')}
          className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => onRespond('always_allow')}
          className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
        >
          Always allow {toolCall.name}
        </button>
      </div>
    </div>
  )
}
