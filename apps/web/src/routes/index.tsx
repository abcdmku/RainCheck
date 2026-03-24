import { createFileRoute } from '@tanstack/react-router'

import { ChatShell } from '../components/chat-shell'

export const Route = createFileRoute('/')({
  component: ChatIndexRoute,
})

function ChatIndexRoute() {
  return <ChatShell />
}
