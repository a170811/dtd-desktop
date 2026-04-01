import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../types'
import { ToolCallBubble } from './ToolCallBubble'

interface Props {
  message: Message
  toolResults?: Record<string, string>  // toolCallId -> result content
}

export function MessageBubble({ message, toolResults = {} }: Props) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  if (isTool) {
    return (
      <div className="flex justify-start mb-2 pl-4">
        <div className="max-w-[75%]">
          <ToolCallBubble name="result" input={{}} output={message.content} status="completed" />
        </div>
      </div>
    )
  }

  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
          isUser
            ? 'bg-blue-600 text-white'
            : message.isError
            ? 'bg-gray-800 text-red-400'
            : 'bg-gray-800 text-gray-100'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            <ReactMarkdown
              components={{
                code({ className, children, ...props }) {
                  const match = className?.match(/language-(\w+)/) ?? null
                  const isBlock = match !== null
                  return isBlock ? (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className="bg-gray-700 rounded px-1 text-xs" {...props}>
                      {children}
                    </code>
                  )
                },
              }}
            >
              {message.content || (!hasToolCalls ? '▋' : '')}
            </ReactMarkdown>
            {hasToolCalls && message.toolCalls!.map((tc) => (
              <ToolCallBubble
                key={tc.id}
                name={tc.name}
                input={tc.arguments}
                output={toolResults[tc.id] ?? null}
                status={tc.id in toolResults ? 'completed' : 'running'}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
