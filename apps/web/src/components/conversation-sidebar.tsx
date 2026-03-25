import type { Conversation } from '@raincheck/contracts'
import { Link } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type SidebarProps = {
  collapsed: boolean
  conversations: Array<Conversation>
  deletingConversationId?: string | null
  onCreateConversation: () => void
  onDeleteConversation: (conversation: Conversation) => void
  onRenameConversation: (conversation: Conversation, title: string) => void
  onTogglePin: (conversation: Conversation) => void
  onToggle: () => void
  onOpenSettings: () => void
}

/* ── Context-menu popover ────────────────────── */

function ConversationMenu({
  anchorRef,
  conversation,
  onClose,
  onRename,
  onTogglePin,
  onDelete,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  conversation: Conversation
  onClose: () => void
  onRename: () => void
  onTogglePin: () => void
  onDelete: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
  })

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    function reposition() {
      const rect = anchor!.getBoundingClientRect()
      const popoverHeight = popoverRef.current?.offsetHeight ?? 160
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const newStyle: React.CSSProperties = {
        position: 'fixed',
        left: rect.right + 4,
        visibility: 'visible',
      }
      if (spaceBelow >= popoverHeight) {
        newStyle.top = rect.top
      } else {
        newStyle.bottom = window.innerHeight - rect.bottom
      }
      setStyle(newStyle)
    }

    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [anchorRef])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (
        anchor &&
        !anchor.contains(event.target as Node) &&
        popover &&
        !popover.contains(event.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [anchorRef, onClose])

  return createPortal(
    <div className="context-menu" ref={popoverRef} style={style}>
      <button
        className="context-menu-item"
        onClick={() => {
          onTogglePin()
          onClose()
        }}
        type="button"
      >
        {conversation.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        {conversation.pinned ? 'Unpin' : 'Pin'}
      </button>
      <button
        className="context-menu-item"
        onClick={() => {
          onRename()
          onClose()
        }}
        type="button"
      >
        <Pencil size={14} />
        Rename
      </button>
      <button
        className="context-menu-item is-danger"
        onClick={() => {
          onDelete()
          onClose()
        }}
        type="button"
      >
        <Trash2 size={14} />
        Delete
      </button>
    </div>,
    document.body,
  )
}

/* ── Inline rename input ─────────────────────── */

function InlineRename({
  conversation,
  onCommit,
  onCancel,
}: {
  conversation: Conversation
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(conversation.title)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function commit() {
    const trimmed = value.trim()
    if (trimmed && trimmed !== conversation.title) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      className="conversation-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}

/* ── Conversation row ────────────────────────── */

function ConversationRow({
  conversation,
  isDeleting,
  onDelete,
  onRename,
  onTogglePin,
}: {
  conversation: Conversation
  isDeleting: boolean
  onDelete: () => void
  onRename: (title: string) => void
  onTogglePin: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="conversation-row">
      <Link
        activeProps={{ className: 'conversation-link is-active' }}
        className="conversation-link"
        params={{ id: conversation.id }}
        to="/chat/$id"
      >
        {renaming ? (
          <InlineRename
            conversation={conversation}
            onCommit={(title) => {
              onRename(title)
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <span className="conversation-title">{conversation.title}</span>
            <span className="conversation-preview">
              {conversation.latestPreview ?? 'New thread'}
            </span>
          </>
        )}
      </Link>
      <button
        ref={menuBtnRef}
        aria-label="Conversation options"
        className={
          menuOpen
            ? 'conversation-menu-btn is-visible'
            : 'conversation-menu-btn'
        }
        disabled={isDeleting}
        onClick={() => setMenuOpen((o) => !o)}
        type="button"
      >
        <Ellipsis size={16} />
      </button>
      {menuOpen && (
        <ConversationMenu
          anchorRef={menuBtnRef}
          conversation={conversation}
          onClose={() => setMenuOpen(false)}
          onRename={() => setRenaming(true)}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

/* ── Sidebar ─────────────────────────────────── */

export function ConversationSidebar({
  collapsed,
  conversations,
  deletingConversationId,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onTogglePin,
  onToggle,
  onOpenSettings,
}: SidebarProps) {
  const pinned = conversations.filter((c) => c.pinned)
  const unpinned = conversations.filter((c) => !c.pinned)

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
        {collapsed
          ? conversations.map((conversation) => (
              <Link
                activeProps={{ className: 'conversation-link is-active' }}
                className="conversation-link"
                key={conversation.id}
                params={{ id: conversation.id }}
                to="/chat/$id"
              >
                <span className="conversation-dot" />
              </Link>
            ))
          : (
            <>
              {pinned.length > 0 && (
                <>
                  <div className="conversation-section-label">Pinned</div>
                  {pinned.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      isDeleting={deletingConversationId === conversation.id}
                      onDelete={() => onDeleteConversation(conversation)}
                      onRename={(title) =>
                        onRenameConversation(conversation, title)
                      }
                      onTogglePin={() => onTogglePin(conversation)}
                    />
                  ))}
                </>
              )}
              {pinned.length > 0 && unpinned.length > 0 && (
                <div className="conversation-section-label">Recent</div>
              )}
              {unpinned.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  isDeleting={deletingConversationId === conversation.id}
                  onDelete={() => onDeleteConversation(conversation)}
                  onRename={(title) =>
                    onRenameConversation(conversation, title)
                  }
                  onTogglePin={() => onTogglePin(conversation)}
                />
              ))}
            </>
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
