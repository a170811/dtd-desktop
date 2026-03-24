import { Message, Settings } from '../types'

export async function streamChat(
  messages: Message[],
  settings: Settings,
  onChunk: (chunk: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${settings.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      input: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`LLM request failed: ${response.status} ${text}`)
  }

  if (!response.body) throw new Error('LLM response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'response.output_text.delta') {
          if (parsed.delta) onChunk(parsed.delta)
        } else if (parsed.type === 'response.done') {
          return
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}
