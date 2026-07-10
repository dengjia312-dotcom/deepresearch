import { CheckCircle2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useResearch } from '../../context/ResearchContext'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()
  const { state, setNotice } = useResearch()

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    mainRef.current?.scrollTo({ top: 0, left: 0 })
  }, [location.pathname])

  return (
    <div className="h-dvh overflow-hidden bg-canvas text-ink">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex h-dvh min-w-0 flex-col lg:pl-sidebar">
        <TopBar onOpenMenu={() => setSidebarOpen(true)} />
        <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-4 bottom-5 z-[70] flex justify-center lg:left-sidebar"
      >
        {state.notice && (
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-slate-200 bg-slate-950 px-4 py-3 text-sm text-white shadow-ambient">
            <CheckCircle2 size={17} className="shrink-0 text-emerald-400" />
            <span>{state.notice}</span>
            <button
              type="button"
              onClick={() => setNotice('')}
              className="focus-ring ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
