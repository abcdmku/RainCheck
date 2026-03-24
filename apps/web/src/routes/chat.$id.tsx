import { createFileRoute } from '@tanstack/react-router'

import { ChatShell } from '../components/chat-shell'

export const Route = createFileRoute('/chat/$id')({
  component: ChatConversationRoute,
})

function ChatConversationRoute() {
  const { id } = Route.useParams()
  return <ChatShell conversationId={id} />
}
