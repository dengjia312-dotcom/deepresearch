import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ResearchProvider } from './context/ResearchContext'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ResearchProvider>
        <App />
      </ResearchProvider>
    </BrowserRouter>
  </StrictMode>,
)
