import { Message, Settings, ToolCall } from '../types'
import { getToolDefinitions } from './tools'

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }

export async function streamChat(
  messages: Message[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const format = settings.apiFormat ?? 'completions'
  if (format === 'responses') {
    return streamResponses(messages, settings, onEvent, signal)
  }
  return streamCompletions(messages, settings, onEvent, signal)
}

function buildCompletionsMessages(messages: Message[]) {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return { role: 'tool' as const, tool_call_id: msg.toolCallId, content: msg.content }
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
    }
    return { role: msg.role, content: msg.content }
  })
}

function buildResponsesInput(messages: Message[]) {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return { type: 'function_call_output' as const, call_id: msg.toolCallId, output: msg.content }
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const items: any[] = []
      if (msg.content) {
        items.push({ type: 'message', role: 'assistant', content: msg.content })
      }
      for (const tc of msg.toolCalls) {
        items.push({
          type: 'function_call',
          id: tc.id,
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        })
      }
      return items
    }
    return { role: msg.role, content: msg.content }
  }).flat()
}

async function streamCompletions(
  messages: Message[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const tools = getToolDefinitions('completions')
  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: buildCompletionsMessages(messages),
      stream: true,
      tools,
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
  const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map()

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
      if (data === '[DONE]') {
        for (const [, tc] of toolCallAccum) {
          try {
            const args = JSON.parse(tc.arguments)
            onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: args } })
          } catch {
            onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: {} } })
          }
        }
        return
      }
      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (delta?.content) {
          onEvent({ type: 'text_delta', text: delta.content })
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCallAccum.has(idx)) {
              toolCallAccum.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' })
            }
            const accum = toolCallAccum.get(idx)!
            if (tc.id) accum.id = tc.id
            if (tc.function?.name) accum.name = tc.function.name
            if (tc.function?.arguments) accum.arguments += tc.function.arguments
          }
        }
        const finishReason = parsed.choices?.[0]?.finish_reason
        if (finishReason === 'tool_calls') {
          for (const [, tc] of toolCallAccum) {
            try {
              const args = JSON.parse(tc.arguments)
              onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: args } })
            } catch {
              onEvent({ type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: {} } })
            }
          }
          toolCallAccum.clear()
        }
      } catch { /* skip malformed */ }
    }
  }
}

async function streamResponses(
  messages: Message[],
  settings: Settings,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const tools = getToolDefinitions('responses')
  const response = await fetch(`${settings.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      input: buildResponsesInput(messages),
      stream: true,
      tools,
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
  const funcCalls: Map<string, { id: string; name: string; arguments: string }> = new Map()

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
          if (parsed.delta) onEvent({ type: 'text_delta', text: parsed.delta })
        } else if (parsed.type === 'response.output_item.added' && parsed.item?.type === 'function_call') {
          funcCalls.set(parsed.item.id, {
            id: parsed.item.call_id,
            name: parsed.item.name,
            arguments: '',
          })
        } else if (parsed.type === 'response.function_call_arguments.delta') {
          const fc = funcCalls.get(parsed.item_id)
          if (fc) fc.arguments += parsed.delta
        } else if (parsed.type === 'response.function_call_arguments.done') {
          const fc = funcCalls.get(parsed.item_id)
          if (fc) {
            try {
              const args = JSON.parse(parsed.arguments ?? fc.arguments)
              onEvent({ type: 'tool_call', toolCall: { id: fc.id, name: fc.name, arguments: args } })
            } catch {
              onEvent({ type: 'tool_call', toolCall: { id: fc.id, name: fc.name, arguments: {} } })
            }
            funcCalls.delete(parsed.item_id)
          }
        } else if (parsed.type === 'response.done') {
          return
        }
      } catch { /* skip malformed */ }
    }
  }
}
