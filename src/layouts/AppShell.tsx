import { Outlet } from 'react-router-dom'

/**
 * Casca do app, reduzida ao que o quadro realmente precisa.
 *
 * O padding de 24px do `<main>` é deliberado, não decorativo: a página do
 * quadro o COMPENSA com margem negativa do mesmo tamanho
 * (`PEDAGOGIA_MAIN_PADDING_PX` em `KanbanBoardPage.tsx`/
 * `MarketingCalendarioPage.tsx`) para sangrar até as bordas da tela. Mudar
 * este número aqui sem mudar lá deixa uma faixa branca em volta do quadro.
 *
 * Existiu aqui um modo "ampliado" (`ImmersiveContext`, ligado por um botão no
 * header do Quadro) para esconder o cabeçalho do app — herdado do CoreHub, de
 * onde este Kanban foi copiado. Removido: este `AppShell` já não tem
 * cabeçalho/sidebar global nenhum pra esconder, então o toggle não mudava
 * nada visível na tela além do próprio botão. Era também a única diferença
 * de largura entre a barra de abas do Quadro e a do Calendário (que nunca
 * teve esse botão), o que fazia a barra "pular" de posição ao trocar de
 * tela.
 */
const MAIN_PADDING_PX = 24

export function AppShell() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--eh-bg)' }}>
      <main
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0, padding: MAIN_PADDING_PX }}
      >
        <Outlet />
      </main>
    </div>
  )
}
