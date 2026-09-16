import { useEffect, useRef } from 'react'

/**
 * Diálogo de confirmação genérico — substitui `window.confirm` em ações
 * sensíveis (excluir tarefa, subtarefa, etiqueta, usuário). É compartilhado
 * por várias telas; qualquer mudança aqui aparece em todas elas junto.
 *
 * O ícone de alerta num círculo colorido não é enfeite: é o padrão consolidado
 * de diálogo destrutivo, que deixa reconhecer "isso apaga algo" antes mesmo de
 * ler o texto.
 *
 * Os botões são locais e usam os tokens `--eh-*` do app, em vez de vir de uma
 * biblioteca de componentes externa — mantém o diálogo consistente com o
 * restante da UI sem arrastar uma dependência só por causa dele.
 */

type Variant = 'danger' | 'primary'

const VARIANT_ICON_STYLE: Record<Variant, { bg: string; fg: string }> = {
  danger: { bg: 'var(--eh-danger-bg)', fg: 'var(--eh-danger-fg)' },
  primary: { bg: 'var(--eh-bar-track)', fg: 'var(--eh-primary)' },
}

const VARIANT_CONFIRM_STYLE: Record<Variant, { bg: string; bgHover: string }> = {
  danger: { bg: 'var(--eh-danger)', bgHover: '#a8331f' },
  primary: { bg: 'var(--eh-primary)', bgHover: 'var(--eh-primary-hover)' },
}

function DialogButton({
  kind,
  variant,
  disabled,
  autoFocus,
  onClick,
  children,
}: {
  kind: 'confirm' | 'cancel'
  variant: Variant
  disabled?: boolean
  autoFocus?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const confirmStyle = VARIANT_CONFIRM_STYLE[variant]
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      disabled={disabled}
      className="transition-colors"
      style={
        kind === 'confirm'
          ? {
              height: 38,
              padding: '0 18px',
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 600,
              background: confirmStyle.bg,
              color: '#ffffff',
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }
          : {
              height: 38,
              padding: '0 18px',
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 600,
              background: 'transparent',
              color: 'var(--eh-text-2)',
              border: '1px solid var(--eh-border)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }
      }
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = kind === 'confirm' ? confirmStyle.bgHover : 'var(--eh-surface-2)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.background = kind === 'confirm' ? confirmStyle.bg : 'transparent'
      }}
    >
      {children}
    </button>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  confirmBusyLabel = 'Processando…',
  variant = 'danger',
  loading,
  error,
  primaryCancel = false,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel?: string
  confirmBusyLabel?: string
  variant?: 'danger' | 'primary'
  loading: boolean
  /**
   * Mensagem de falha da ação confirmada. Opcional — os usos que
   * não a passam seguem idênticos. Quando presente, o diálogo continua aberto
   * mostrando o motivo, em vez de fechar como se a ação tivesse funcionado.
   */
  error?: string | null
  /** Quando true: "Cancelar" fica como botão primário (direita), ação destrutiva fica secundária (esquerda) */
  primaryCancel?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const icon = VARIANT_ICON_STYLE[variant]
  // Escape fecha, mas o backdrop NÃO fecha durante `loading`: clicar fora
  // enquanto a exclusão está em andamento parecia cancelar a ação, quando na
  // verdade ela já tinha sido disparada.
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [loading, onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={() => { if (!loading) onCancel() }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm outline-none"
        style={{
          background: 'var(--eh-surface)',
          borderRadius: 16,
          boxShadow: '0 20px 48px -12px rgba(15,23,42,0.3), 0 0 0 1px rgba(15,23,42,0.04)',
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            background: icon.bg,
            color: icon.fg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h2 id="confirm-dialog-title" className="text-base font-semibold" style={{ color: 'var(--eh-text-strong)' }}>
          {title}
        </h2>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--eh-text-2)', lineHeight: 1.5 }}>{message}</p>
        {/* Role="alert" — a mensagem surge sem mover o foco. */}
        {error && (
          <div
            role="alert"
            className="mt-3 rounded-lg px-3 py-2 text-sm font-medium"
            style={{ background: 'var(--eh-danger-bg)', color: 'var(--eh-danger-fg)' }}
          >
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {primaryCancel ? (
            <>
              <DialogButton kind="cancel" variant={variant} onClick={onConfirm} disabled={loading}>
                {loading ? confirmBusyLabel : confirmLabel}
              </DialogButton>
              <DialogButton kind="confirm" variant="primary" autoFocus onClick={onCancel} disabled={loading}>
                Cancelar
              </DialogButton>
            </>
          ) : (
            <>
              <DialogButton kind="cancel" variant={variant} onClick={onCancel} disabled={loading}>
                Cancelar
              </DialogButton>
              <DialogButton kind="confirm" variant={variant} autoFocus onClick={onConfirm} disabled={loading}>
                {loading ? confirmBusyLabel : confirmLabel}
              </DialogButton>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
