import {
  BellRing,
  FileText,
  FlaskConical,
  ListTree,
  Plus,
  Search,
  Settings,
  UserRound,
  X,
  Database,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useResearch } from '../../context/ResearchContext'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

const navigation = [
  { label: 'AI 搜索', path: '/search', icon: Search },
  { label: '资料池', path: '/pool', icon: Database },
  { label: '研究大纲', path: '/outline', icon: ListTree },
  { label: '研究报告', path: '/report', icon: FileText },
]

function isNavigationActive(pathname: string, path: string) {
  if (path === '/search') {
    return pathname === '/'
      || pathname.startsWith('/plan')
      || pathname.startsWith('/search')
  }
  if (path === '/pool') {
    return pathname.startsWith('/pool') || pathname.startsWith('/sources/')
  }
  return pathname.startsWith(path)
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation()
  const { state } = useResearch()
  const aiSearchPath = !state.researchPlan
    ? '/'
    : state.researchPlan.confirmedAt
      ? '/search'
      : '/plan'

  return (
    <>
      <button
        type="button"
        aria-label="关闭导航"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[1px] transition lg:hidden ${
          open ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-sidebar flex-col border-r border-outline bg-surface px-5 py-5 transition-transform duration-200 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-12 items-center justify-between">
          <Link to="/" onClick={onClose} className="focus-ring flex items-center gap-3 rounded-lg">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-white shadow-panel">
              <FlaskConical size={23} strokeWidth={2} />
            </span>
            <span>
              <span className="block text-[15px] font-bold tracking-[-0.02em] text-ink">
                AI RESEARCH
              </span>
              <span className="block text-[11px] font-semibold tracking-[0.12em] text-ink-muted">
                WORKSPACE
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-slate-100 lg:hidden"
            aria-label="关闭侧栏"
          >
            <X size={19} />
          </button>
        </div>

        <Link
          to="/"
          onClick={onClose}
          className="focus-ring btn-primary mt-7 w-full"
        >
          <Plus size={16} />
          新建研究任务
        </Link>

        <nav className="mt-6 space-y-1.5" aria-label="主要导航">
          {navigation.map((item) => {
            const Icon = item.icon
            const active = isNavigationActive(location.pathname, item.path)
            return (
              <Link
                key={item.path}
                to={item.path === '/search' ? aiSearchPath : item.path}
                onClick={onClose}
                className={`focus-ring relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${
                  active
                    ? 'bg-slate-100 text-primary-deep'
                    : 'text-ink-muted hover:bg-slate-50 hover:text-ink'
                }`}
              >
                {active && (
                  <span className="absolute -left-5 top-2 h-7 w-0.5 rounded-r-full bg-primary" />
                )}
                <Icon size={18} strokeWidth={active ? 2.3 : 1.8} />
                {item.label}
                {item.path === '/pool' && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto border-t border-outline pt-4">
          <button
            type="button"
            className="focus-ring flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-ink-muted hover:bg-slate-50 hover:text-ink"
          >
            <Settings size={18} />
            设置
          </button>
          <button
            type="button"
            className="focus-ring mt-1 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-ink-muted hover:bg-slate-50 hover:text-ink"
          >
            <UserRound size={18} />
            个人资料
          </button>
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
              LY
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink">林言</p>
              <p className="truncate text-[11px] text-ink-subtle">研究工作区</p>
            </div>
            <BellRing size={15} className="text-ink-subtle" />
          </div>
        </div>
      </aside>
    </>
  )
}
