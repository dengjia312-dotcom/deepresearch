import { Bell, CircleHelp, Menu, Search } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useResearch } from '../../context/ResearchContext'
import { StatusBadge } from '../StatusBadge'

interface TopBarProps {
  onOpenMenu: () => void
}

export function TopBar({ onOpenMenu }: TopBarProps) {
  const location = useLocation()
  const { state } = useResearch()
  const creating = location.pathname === '/'

  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center border-b border-outline bg-white/95 px-4 backdrop-blur lg:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        className="focus-ring mr-3 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-slate-100 lg:hidden"
        aria-label="打开导航"
      >
        <Menu size={20} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-3">
          <p className="truncate text-sm font-semibold text-ink">
            {creating ? '新建研究任务' : state.task.title}
          </p>
          {!creating && <StatusBadge value={state.task.status} />}
        </div>
      </div>

      <div className="ml-4 flex items-center gap-1.5">
        <button
          type="button"
          className="focus-ring hidden h-9 items-center gap-2 rounded-full border border-outline bg-slate-50 px-3 text-xs text-ink-subtle transition hover:border-slate-300 hover:bg-white md:flex"
          aria-label="全局搜索"
        >
          <Search size={14} />
          搜索工作区
          <kbd className="ml-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[10px] text-slate-400">
            ⌘ K
          </kbd>
        </button>
        <button
          type="button"
          className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-slate-100"
          aria-label="通知"
        >
          <Bell size={18} />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-white" />
        </button>
        <button
          type="button"
          className="focus-ring hidden h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-slate-100 sm:flex"
          aria-label="帮助"
        >
          <CircleHelp size={18} />
        </button>
        <span className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-950 text-[10px] font-semibold text-white ring-2 ring-slate-200">
          LY
        </span>
      </div>
    </header>
  )
}
