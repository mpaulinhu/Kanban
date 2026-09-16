import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ImmersiveContext, shouldResetImmersive } from './ImmersiveContext'

/**
 * Casca do app, reduzida ao que o quadro realmente precisa.
 *
 * O padding de 24px do `<main>` é deliberado, não decorativo: a página do
 * quadro o COMPENSA com margem negativa do mesmo tamanho
 * (`PEDAGOGIA_MAIN_PADDING_PX` em `KanbanBoardPage.tsx`) para sangrar até as
 * bordas da tela. Mudar este número aqui sem mudar lá deixa uma faixa branca
 * em volta do quadro.
 */
const MAIN_PADDING_PX = 24

export function AppShell() {
  const [immersive, setImmersive] = useState(false)
  const location = useLocation()
  const prevPathname = useRef(location.pathname)

  useEffect(() => {
    if (shouldResetImmersive(prevPathname.current, location.pathname)) {
      setImmersive(false)
    }
    prevPathname.current = location.pathname
  }, [location.pathname])

  return (
    <ImmersiveContext.Provider value={{ immersive, setImmersive }}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--eh-bg)' }}>
        {/* O padding fica SEMPRE, inclusive em modo ampliado — a página já o
            compensa com margem negativa própria, independente de o cabeçalho
            estar visível. Zerá-lo aqui faria o quadro vazar 24px para fora da
            tela, porque a compensação do outro lado continua valendo. */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ minHeight: 0, padding: MAIN_PADDING_PX }}
        >
          <Outlet />
        </main>
      </div>
    </ImmersiveContext.Provider>
  )
}
