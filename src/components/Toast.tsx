import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const DURATION = 8000

export function StartDateToast({
  date,
  onOpenTask,
  onClose,
}: {
  date: Date
  onOpenTask: () => void
  onClose: () => void
}) {
  const progressRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(onClose, DURATION)
    requestAnimationFrame(() => {
      if (progressRef.current) {
        progressRef.current.style.transition = `width ${DURATION}ms linear`
        progressRef.current.style.width = '0%'
      }
    })
    return () => clearTimeout(timer)
  }, [onClose])

  const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 'min(380px, calc(100vw - 32px))',
        background: 'var(--eh-surface)',
        border: '1px solid var(--eh-border)',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>📅</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--eh-text-strong)' }}>
              Data de início definida: {dateStr}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--eh-text-2)', lineHeight: 1.4 }}>
              Para corrigir, clique em{' '}
              <strong style={{ color: 'var(--eh-text-3)' }}>"Abrir tarefa"</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar notificação"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 15,
              color: 'var(--eh-muted-2)',
              lineHeight: 1,
              padding: 2,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => { onOpenTask(); onClose() }}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              background: 'var(--eh-primary)',
              color: '#fff',
              border: 'none',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Abrir tarefa
          </button>
        </div>
      </div>
      <div style={{ height: 3, background: 'var(--eh-border)', position: 'relative' }}>
        <div
          ref={progressRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: '100%',
            background: 'var(--eh-primary)',
          }}
        />
      </div>
    </div>,
    document.body,
  )
}

/**
 * Toast genérico de confirmação de ação, com botão opcional de desfazer.
 * Existe porque uma ação como arquivar sem nenhum feedback é indistinguível
 * de exclusão ou de erro silencioso. Mesmo padrão visual/acessível de `StartDateToast`
 * (`role="status"`, `aria-live="polite"`, portal, barra de progresso) —
 * generalizado para não duplicar o esqueleto por caso de uso.
 *
 * `variant: 'error'` usa a cor de perigo no ícone/barra — para o `.catch`
 * de uma escrita que falhou, quando "engolir em console.error" deixaria o
 * usuário sem explicação nenhuma do porquê o card não mudou de estado.
 */
export function ActionToast({
  message,
  variant = 'success',
  actionLabel,
  onAction,
  onClose,
}: {
  message: string
  variant?: 'success' | 'error'
  /** Ausente = sem botão de ação (ex.: toast de erro, que só informa). */
  actionLabel?: string
  onAction?: () => void
  onClose: () => void
}) {
  const progressRef = useRef<HTMLDivElement>(null)
  const accentColor = variant === 'error' ? 'var(--eh-danger)' : 'var(--eh-primary)'

  useEffect(() => {
    const timer = setTimeout(onClose, DURATION)
    requestAnimationFrame(() => {
      if (progressRef.current) {
        progressRef.current.style.transition = `width ${DURATION}ms linear`
        progressRef.current.style.width = '0%'
      }
    })
    return () => clearTimeout(timer)
  }, [onClose])

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 'min(380px, calc(100vw - 32px))',
        background: 'var(--eh-surface)',
        border: '1px solid var(--eh-border)',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>
            {variant === 'error' ? '⚠️' : '✅'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--eh-text-strong)' }}>
              {message}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar notificação"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 15,
              color: 'var(--eh-muted-2)',
              lineHeight: 1,
              padding: 2,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
        {actionLabel && onAction && (
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { onAction(); onClose() }}
              style={{
                padding: '5px 14px',
                borderRadius: 6,
                background: accentColor,
                color: '#fff',
                border: 'none',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>
      <div style={{ height: 3, background: 'var(--eh-border)', position: 'relative' }}>
        <div
          ref={progressRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: '100%',
            background: accentColor,
          }}
        />
      </div>
    </div>,
    document.body,
  )
}
