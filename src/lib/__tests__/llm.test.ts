import { it, expect, vi, beforeEach } from 'vitest'
import { streamChat } from '../llm'
import { Settings } from '../../types'

const settings: Settings = {
  baseUrl: 'http://localhost:4000',
  apiKey: 'sk-test',
  model: 'gpt-4o',
}

const makeStreamBody = (chunks: string[]) => {
  const encoder = new TextEncoder()
  const lines = chunks.map(
    (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
  )
  lines.push('data: [DONE]\n\n')
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

it('calls onChunk for each content delta', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    body: makeStreamBody(['Hello', ' world']),
  })

  const chunks: string[] = []
  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    settings,
    (c) => chunks.push(c),
    new AbortController().signal,
  )

  expect(chunks).toEqual(['Hello', ' world'])
})

it('throws on non-ok response', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized',
  })

  await expect(
    streamChat(
      [{ role: 'user', content: 'hi', timestamp: '' }],
      settings,
      vi.fn(),
      new AbortController().signal,
    )
  ).rejects.toThrow('401')
})
