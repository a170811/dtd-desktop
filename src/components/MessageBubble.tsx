import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../types'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

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
            {message.content || '▋'}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
