import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import {
  getTaskRoute,
  type ResearchTaskPage,
  useResearch,
} from './context/ResearchContext'
import { OutlinePage } from './pages/OutlinePage'
import { ReportPage } from './pages/ReportPage'
import { ResearchPlanPage } from './pages/ResearchPlanPage'
import { ResearchPoolPage } from './pages/ResearchPoolPage'
import { SearchResultsPage } from './pages/SearchResultsPage'
import { SourceDetailPage } from './pages/SourceDetailPage'
import { TaskCreationPage } from './pages/TaskCreationPage'

function TaskRouteGuard() {
  const { taskId = '' } = useParams()
  const { activeTaskId, hasTask, switchTask, isHydrating } = useResearch()
  const exists = hasTask(taskId)

  useEffect(() => {
    if (exists && activeTaskId !== taskId) switchTask(taskId)
  }, [activeTaskId, exists, switchTask, taskId])

  if (isHydrating) return null
  if (!exists) return <Navigate to="/" replace />
  if (activeTaskId !== taskId) return null
  return <Outlet />
}

function LegacyTaskRedirect({ page }: { page: ResearchTaskPage }) {
  const { activeTaskId, isHydrating } = useResearch()
  if (isHydrating) return null
  return activeTaskId
    ? <Navigate to={getTaskRoute(activeTaskId, page)} replace />
    : <Navigate to="/" replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<TaskCreationPage />} />
        <Route path="/tasks/:taskId" element={<TaskRouteGuard />}>
          <Route path="plan" element={<ResearchPlanPage />} />
          <Route path="search" element={<SearchResultsPage />} />
          <Route path="sources/:sourceId" element={<SourceDetailPage />} />
          <Route path="pool" element={<ResearchPoolPage />} />
          <Route path="outline" element={<OutlinePage />} />
          <Route path="report" element={<ReportPage />} />
        </Route>
        <Route path="/plan" element={<LegacyTaskRedirect page="plan" />} />
        <Route path="/search" element={<LegacyTaskRedirect page="search" />} />
        <Route path="/pool" element={<LegacyTaskRedirect page="pool" />} />
        <Route path="/outline" element={<LegacyTaskRedirect page="outline" />} />
        <Route path="/report" element={<LegacyTaskRedirect page="report" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
