interface ToolParameter {
  type: string
  properties: Record<string, { type: string; description?: string }>
  required: string[]
}

interface RawTool {
  name: string
  description: string
  parameters: ToolParameter
}

const TOOLS: RawTool[] = [
  {
    name: 'bash',
    description: 'Run a shell command in the working directory.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Path is relative to the working directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        limit: { type: 'integer', description: 'Max number of lines to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if needed. Path is relative to the working directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace the first occurrence of old_text with new_text in a file. Path is relative to the working directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        old_text: { type: 'string', description: 'Exact text to find' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
]

export function getToolDefinitions(apiFormat: 'completions' | 'responses') {
  if (apiFormat === 'completions') {
    return TOOLS.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }
  // Responses API format
  return TOOLS.map((tool) => ({
    name: tool.name,
    type: 'function' as const,
    description: tool.description,
    parameters: tool.parameters,
  }))
}
