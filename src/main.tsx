import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles/globals.css'
import { AuthProvider } from './providers/AuthProvider'
import { AppShell } from './layouts/AppShell'
import { KanbanBoardPage } from './features/kanban/KanbanBoardPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/quadro" element={<KanbanBoardPage />} />
            <Route path="*" element={<Navigate to="/quadro" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
