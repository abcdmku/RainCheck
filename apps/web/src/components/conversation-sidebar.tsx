import type { Conversation } from '@raincheck/contracts'
import { Link } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'

type SidebarProps = {
  collapsed: boolean
  conversations: Array<Conversation>
  deletingConversationId?: string | null
  onCreateConversation: () => void
  onDeleteConversation: (conversation: Conversation) => void
  onToggle: () => void
  onOpenSettings: () => void
}

export function ConversationSidebar({
  collapsed,
  conversations,
  deletingConversationId,
  onCreateConversation,
  onDeleteConversation,
  onToggle,
  onOpenSettings,
}: SidebarProps) {
  return (
    <aside className={collapsed ? 'sidebar is-collapsed' : 'sidebar'}>
      <div className="sidebar-header">
        {!collapsed ? <p className="sidebar-brand">RainCheck</p> : null}
        <button
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="ghost-icon-button"
          onClick={onToggle}
          type="button"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        {!collapsed ? (
          <button
            className="primary-quiet-button"
            onClick={onCreateConversation}
            type="button"
          >
            <Plus size={14} />
            New
          </button>
        ) : null}
      </div>

      <div className="conversation-list">
        {conversations.map((conversation) =>
          collapsed ? (
            <Link
              activeProps={{ className: 'conversation-link is-active' }}
              className="conversation-link"
              key={conversation.id}
              params={{ id: conversation.id }}
              to="/chat/$id"
            >
              <span className="conversation-dot" />
            </Link>
          ) : (
            <div className="conversation-row" key={conversation.id}>
              <Link
                activeProps={{ className: 'conversation-link is-active' }}
                className="conversation-link"
                params={{ id: conversation.id }}
                to="/chat/$id"
              >
                <span className="conversation-title">{conversation.title}</span>
                <span className="conversation-preview">
                  {conversation.latestPreview ?? 'New thread'}
                </span>
              </Link>
              <button
                aria-label={`Delete conversation ${conversation.title}`}
                className="conversation-delete"
                disabled={deletingConversationId === conversation.id}
                onClick={() => onDeleteConversation(conversation)}
                title={`Delete ${conversation.title}`}
                type="button"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ),
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className="ghost-icon-button"
          onClick={onOpenSettings}
          type="button"
        >
          <Settings2 size={16} />
        </button>
      </div>
    </aside>
  )
}
