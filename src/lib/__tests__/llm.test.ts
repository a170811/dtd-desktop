import { it, expect, vi, beforeEach } from 'vitest'
import { streamChat, StreamEvent } from '../llm'
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

const makeCompletionsToolCallStream = () => {
  const encoder = new TextEncoder()
  const lines = [
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            function: { name: 'bash', arguments: '{"com' },
          }],
        },
      }],
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: 'mand":"ls"}' },
          }],
        },
      }],
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    })}\n\n`,
    'data: [DONE]\n\n',
  ]
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

const makeResponsesToolCallStream = () => {
  const encoder = new TextEncoder()
  const lines = [
    `data: ${JSON.stringify({
      type: 'response.output_item.added',
      item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file' },
    })}\n\n`,
    `data: ${JSON.stringify({
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      delta: '{"path":',
    })}\n\n`,
    `data: ${JSON.stringify({
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      delta: '"test.txt"}',
    })}\n\n`,
    `data: ${JSON.stringify({
      type: 'response.function_call_arguments.done',
      item_id: 'fc_1',
      arguments: '{"path":"test.txt"}',
    })}\n\n`,
    `data: ${JSON.stringify({ type: 'response.done' })}\n\n`,
  ]
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

it('completions: calls onEvent with text_delta for each content delta', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeCompletionsStream(['Hello', ' world']),
  }))

  const chunks: string[] = []
  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    completionsSettings,
    (e) => { if (e.type === 'text_delta') chunks.push(e.text) },
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

it('responses: calls onEvent with text_delta for each content delta', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeResponsesStream(['Hello', ' world']),
  }))

  const chunks: string[] = []
  await streamChat(
    [{ role: 'user', content: 'hi', timestamp: '' }],
    responsesSettings,
    (e) => { if (e.type === 'text_delta') chunks.push(e.text) },
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

it('completions: emits tool_call event when finish_reason is tool_calls', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeCompletionsToolCallStream(),
  }))

  const events: StreamEvent[] = []
  await streamChat(
    [{ role: 'user', content: 'run ls', timestamp: '' }],
    completionsSettings,
    (e) => events.push(e),
    new AbortController().signal,
  )

  const toolCallEvents = events.filter((e) => e.type === 'tool_call')
  expect(toolCallEvents).toHaveLength(1)
  expect(toolCallEvents[0]).toMatchObject({
    type: 'tool_call',
    toolCall: {
      id: 'call_1',
      name: 'bash',
      arguments: { command: 'ls' },
    },
  })
})

it('responses: emits tool_call event on function_call_arguments.done', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: makeResponsesToolCallStream(),
  }))

  const events: StreamEvent[] = []
  await streamChat(
    [{ role: 'user', content: 'read a file', timestamp: '' }],
    responsesSettings,
    (e) => events.push(e),
    new AbortController().signal,
  )

  const toolCallEvents = events.filter((e) => e.type === 'tool_call')
  expect(toolCallEvents).toHaveLength(1)
  expect(toolCallEvents[0]).toMatchObject({
    type: 'tool_call',
    toolCall: {
      id: 'call_1',
      name: 'read_file',
      arguments: { path: 'test.txt' },
    },
  })
})
