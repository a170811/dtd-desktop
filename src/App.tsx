import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useChatStore } from './store/useChatStore'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { SettingsModal } from './components/SettingsModal'
import { Session, Settings } from './types'

export default function App() {
  const { setSessions, setSettings, settings, activeSessionId } = useChatStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const init = async () => {
      const [sessions, loadedSettings] = await Promise.all([
        invoke<Session[]>('load_sessions').catch(() => [] as Session[]),
        invoke<Settings | null>('load_settings').catch(() => null),
      ])
      setSessions(sessions)
      if (loadedSettings) {
        setSettings(loadedSettings)
      } else {
        setSettingsOpen(true)
      }
    }
    init()
  }, [])

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings)
    setSettingsOpen(false)
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />

      <main className="flex-1 flex flex-col min-w-0">
        {activeSessionId ? (
          <ChatWindow />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Select a session or create a new chat
          </div>
        )}
      </main>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        initialValues={settings}
      />
    </div>
  )
}
