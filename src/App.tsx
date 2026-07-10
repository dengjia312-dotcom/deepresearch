import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { OutlinePage } from './pages/OutlinePage'
import { ReportPage } from './pages/ReportPage'
import { ResearchPlanPage } from './pages/ResearchPlanPage'
import { ResearchPoolPage } from './pages/ResearchPoolPage'
import { SearchResultsPage } from './pages/SearchResultsPage'
import { SourceDetailPage } from './pages/SourceDetailPage'
import { TaskCreationPage } from './pages/TaskCreationPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<TaskCreationPage />} />
        <Route path="/plan" element={<ResearchPlanPage />} />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="/sources/:sourceId" element={<SourceDetailPage />} />
        <Route path="/pool" element={<ResearchPoolPage />} />
        <Route path="/outline" element={<OutlinePage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
