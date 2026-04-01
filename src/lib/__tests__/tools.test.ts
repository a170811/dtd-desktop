import { it, expect } from 'vitest'
import { getToolDefinitions } from '../tools'

it('returns 4 tool definitions for completions format', () => {
  const tools = getToolDefinitions('completions')
  expect(tools).toHaveLength(4)
  const names = tools.map((t: any) => t.function.name)
  expect(names).toEqual(['bash', 'read_file', 'write_file', 'edit_file'])
})

it('returns 4 tool definitions for responses format', () => {
  const tools = getToolDefinitions('responses')
  expect(tools).toHaveLength(4)
  const names = tools.map((t: any) => t.name)
  expect(names).toEqual(['bash', 'read_file', 'write_file', 'edit_file'])
})

it('completions format wraps each tool in {type: "function", function: {...}}', () => {
  const tools = getToolDefinitions('completions')
  for (const tool of tools) {
    expect(tool).toHaveProperty('type', 'function')
    expect(tool).toHaveProperty('function.name')
    expect(tool).toHaveProperty('function.parameters')
  }
})

it('responses format has name, type, description, parameters at top level', () => {
  const tools = getToolDefinitions('responses')
  for (const tool of tools) {
    expect(tool).toHaveProperty('name')
    expect(tool).toHaveProperty('type', 'function')
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('parameters')
  }
})
