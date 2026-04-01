import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useChatStore } from '../store/useChatStore'

interface Props {
  onOpenSettings: () => void
}

export function Sidebar({ onOpenSettings }: Props) {
  const { sessions, activeSessionId, createSessionWithDir, deleteSession, setActiveSession } = useChatStore()

  const handleNewChat = async () => {
    const selected = await open({ directory: true, title: 'Select working directory' })
    if (selected) {
      createSessionWithDir(selected as string)
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteSession(id)
    await invoke('delete_session', { id }).catch(console.error)
  }

  return (
    <div className="w-60 flex flex-col h-full bg-gray-900 border-r border-gray-700">
      <div className="p-3">
        <button
          onClick={handleNewChat}
          className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => setActiveSession(session.id)}
            className={`group flex items-center justify-between rounded-lg px-3 py-2 mb-1 cursor-pointer text-sm transition-colors ${
              session.id === activeSessionId
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span className="truncate flex-1">{session.title}</span>
            <button
              onClick={(e) => handleDelete(e, session.id)}
              className="ml-2 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all text-xs"
              title="Delete session"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700">
        <button
          onClick={onOpenSettings}
          className="w-full py-2 px-3 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg text-sm transition-colors text-left"
        >
          ⚙ Settings
        </button>
      </div>
    </div>
  )
}
