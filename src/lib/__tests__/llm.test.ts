import { it, expect, vi, beforeEach } from 'vitest'
import { streamChat } from '../llm'
import { Settings } from '../../types'

const baseSettings: Settings = {
  baseUrl: 'http://localhost:4000',
  apiKey: 'sk-test',
  model: 'gpt-4o',
}

const responsesSettings: Settings = { ...baseSettings, apiFormat: 'responses' }
const completionsSettings: Settings = { ...baseSettings, apiFormat: 'completions' }

const makeResponsesStream = (chunks: string[]) => {
  const encoder = new TextEncoder()
  const lines = chunks.map(
    (c) => `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: c })}\n\n`
  )
  lines.push(`data: ${JSON.stringify({ type: 'response.done' })}\n\n`)
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

const makeCompletionsStream = (chunks: string[]) => {
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

it('completions: calls onChunk for each content delta', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeCompletionsStream(['Hello', ' world']),
  }))

  const chunks: string[] = []
  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    completionsSettings,
    (c) => chunks.push(c),
    new AbortController().signal,
  )

  expect(chunks).toEqual(['Hello', ' world'])
})

it('completions: defaults to completions when apiFormat is unset', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    body: makeCompletionsStream(['hi']),
  })
  vi.stubGlobal('fetch', fetchMock)

  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    baseSettings,
    vi.fn(),
    new AbortController().signal,
  )

  expect(fetchMock.mock.calls[0][0]).toContain('/v1/chat/completions')
})

it('responses: calls onChunk for each content delta', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeResponsesStream(['Hello', ' world']),
  }))

  const chunks: string[] = []
  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    responsesSettings,
    (c) => chunks.push(c),
    new AbortController().signal,
  )

  expect(chunks).toEqual(['Hello', ' world'])
})

it('throws on non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized',
  }))

  await expect(
    streamChat(
      [{ role: 'user', content: 'hi', timestamp: '' }],
      completionsSettings,
      vi.fn(),
      new AbortController().signal,
    )
  ).rejects.toThrow('401')
})
