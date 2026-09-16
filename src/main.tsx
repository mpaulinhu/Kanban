import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles/globals.css'
import { AuthProvider } from './providers/AuthProvider'
import { AppShell } from './layouts/AppShell'
import { KanbanBoardPage } from './features/kanban/KanbanBoardPage'
import { MarketingCalendarioPage } from './features/kanban/pages/MarketingCalendarioPage'
import { MarketingTemplatesPage } from './features/kanban/pages/MarketingTemplatesPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/quadro" element={<KanbanBoardPage />} />
            <Route path="/calendario" element={<MarketingCalendarioPage />} />
            <Route path="/templates" element={<MarketingTemplatesPage />} />
            <Route path="*" element={<Navigate to="/quadro" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
