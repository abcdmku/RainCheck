import type { MessageRecord } from '@raincheck/contracts'
import type { UIMessage } from '@tanstack/ai-react'

export function mapRecordsToUiMessages(
  messages: Array<MessageRecord>,
): Array<UIMessage> {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map((part) => {
      if (
        part.type === 'text' &&
        typeof part.content !== 'string' &&
        typeof part.text === 'string'
      ) {
        return {
          type: 'text',
          content: part.text,
        }
      }

      return part as any
    }),
    citations: message.citations,
    artifacts: message.artifacts,
    createdAt: new Date(message.createdAt),
  }))
}

export function getMessageText(message: {
  parts: Array<{
    type?: string
    content?: string
    text?: string
  }>
}) {
  return message.parts
    .map((part) => {
      if (part.type === 'text' && typeof part.content === 'string') {
        return part.content
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .join('')
}
