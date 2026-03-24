export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isError?: boolean
}

export interface Session {
  id: string
  title: string
  createdAt: string
  messages: Message[]
}

export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
}
