import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UserAvatar } from '../UserAvatar/UserAvatar'
import { useMediaQuery } from '@/hooks/useMediaQuery'

export interface UserProfilePopoverAction {
  label: string
  onClick: () => void
}

/**
 * Popover de perfil de um usuário: ao clicar num avatar, abre um cartão com header colorido
 * (foto grande + nome + e-mail, já que este app não tem "@handle") e uma
 * lista opcional de ações abaixo (ex.: "Remover do Cartão" no modal de
 * tarefa; sem ação nenhuma no avatar do próprio usuário na Sidebar).
 *
 * Componente compartilhado (era exclusivo de `features/pm`, generalizado
 * para o avatar de usuário logado no rodapé da Sidebar) — mesmo padrão de
 * posicionamento/portal/foco de `LabelPickerPopover.tsx` (ancorado no
 * elemento clicado, recalcula em resize/scroll, fecha com Escape/clique
 * fora, devolve foco ao ancorador).
 */
export function UserProfilePopover({
  anchorRef,
  open,
  onClose,
  name,
  email,
  photoURL,
  actions,
}: {
  anchorRef: { current: HTMLElement | null }
  open: boolean
  onClose: () => void
  name: string
  email?: string
  photoURL?: string
  actions?: UserProfilePopoverAction[]
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const isMobile = useMediaQuery('(max-width: 640px)')
  const POPOVER_W = isMobile ? Math.min(304, window.innerWidth - 24) : 304

  const [recalcTick, setRecalcTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const onResize = () => setRecalcTick((t) => t + 1)
    // Rolagem FECHA em vez de reposicionar. Acompanhar o âncora parecia o
    // certo, mas o popover é `position: fixed` e não é recortado por nenhum
    // container: ao rolar a coluna do quadro, ele seguia o avatar para fora
    // da área visível e passava por cima do cabeçalho da página.
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, onClose])

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const GAP = 6
    const EDGE = 12
    const POPOVER_H = 200

    const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - POPOVER_W - GAP))

    const espacoAbaixo = window.innerHeight - rect.bottom - GAP - EDGE
    const abrirParaCima = espacoAbaixo < POPOVER_H
    const top = abrirParaCima ? Math.max(EDGE, rect.top - GAP - POPOVER_H) : rect.bottom + GAP

    setPos({ top, left })
  }, [open, anchorRef, POPOVER_W, recalcTick])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onClose, anchorRef])

  function closeAndRestoreFocus() {
    onClose()
    anchorRef.current?.focus()
  }

  if (!open || !pos) return null

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={`Perfil de ${name}`}
      className="fixed z-[200] overflow-hidden"
      style={{
        top: pos.top,
        left: pos.left,
        width: POPOVER_W,
        background: 'var(--eh-surface)',
        border: '1px solid var(--eh-border)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeAndRestoreFocus() }
      }}
    >
      <div className="relative p-4" style={{ background: '#0c66e4', color: '#fff' }}>
        <button
          type="button"
          onClick={closeAndRestoreFocus}
          aria-label="Fechar"
          className="absolute right-2 top-2 flex items-center justify-center"
          style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', opacity: 0.85 }}
        >
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="10" y1="2" x2="2" y2="10" /><line x1="2" y1="2" x2="10" y2="10" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <UserAvatar name={name} photoURL={photoURL} size={48} bg="rgba(255,255,255,0.25)" fg="#fff" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: '#fff' }}>{name}</p>
            {email && <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>{email}</p>}
          </div>
        </div>
      </div>
      {actions && actions.length > 0 && (
        <div className="p-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => { action.onClick(); closeAndRestoreFocus() }}
              className="w-full text-left px-3 py-2 text-sm rounded-md"
              style={{ background: 'transparent', border: 'none', color: 'var(--eh-text)', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-pm-neutral-surface)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
