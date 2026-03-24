import type { Conversation } from '@raincheck/contracts'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Plus, Settings2 } from 'lucide-react'

type SidebarProps = {
  collapsed: boolean
  conversations: Array<Conversation>
  onCreateConversation: () => void
  onToggle: () => void
  onOpenSettings: () => void
}

export function ConversationSidebar({
  collapsed,
  conversations,
  onCreateConversation,
  onToggle,
  onOpenSettings,
}: SidebarProps) {
  return (
    <aside className={collapsed ? 'sidebar is-collapsed' : 'sidebar'}>
      <div className="sidebar-header">
        {!collapsed ? (
          <p className="sidebar-brand">RainCheck</p>
        ) : null}
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
        {conversations.map((conversation) => (
          <Link
            activeProps={{ className: 'conversation-link is-active' }}
            className="conversation-link"
            key={conversation.id}
            params={{ id: conversation.id }}
            to="/chat/$id"
          >
            {!collapsed ? (
              <>
                <span className="conversation-title">{conversation.title}</span>
                <span className="conversation-preview">
                  {conversation.latestPreview ?? 'New thread'}
                </span>
              </>
            ) : (
              <span className="conversation-dot" />
            )}
          </Link>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="ghost-icon-button" onClick={onOpenSettings} type="button">
          <Settings2 size={16} />
        </button>
      </div>
    </aside>
  )
}
