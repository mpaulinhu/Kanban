import type { CSSProperties } from 'react'

/**
 * Diálogo de confirmação genérico — substitui `window.confirm` em ações
 * sensíveis (excluir coluna, excluir tarefa).
 *
 * O original importava `Button` de `@grupo-elo-editorial/shared-ui-react`
 * (pacote privado do monorepo, a ÚNICA dependência dele em toda esta tela).
 * Aqui o botão é local, o que remove o pacote do projeto inteiro.
 */

type Variant = 'danger' | 'primary' | 'secondary'

const VARIANT_STYLE: Record<Variant, CSSProperties> = {
  danger: { background: 'var(--eh-danger)', color: '#fff', border: '1px solid transparent' },
  primary: { background: 'var(--eh-primary)', color: '#fff', border: '1px solid transparent' },
  secondary: { background: 'var(--eh-surface)', color: 'var(--eh-text)', border: '1px solid var(--eh-border)' },
}

function DialogButton({
  variant,
  disabled,
  onClick,
  children,
}: {
  variant: Variant
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...VARIANT_STYLE[variant],
        height: 32,
        padding: '0 14px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: 'inherit',
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
  /** Falha da ação confirmada: o diálogo continua aberto mostrando o motivo, em vez de fechar como se tivesse funcionado. */
  error?: string | null
  /** Quando true: "Cancelar" fica como botão primário (direita), ação destrutiva fica secundária (esquerda). */
  primaryCancel?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg p-6"
        style={{
          background: 'var(--eh-surface)',
          border: '1px solid var(--eh-border)',
          boxShadow: 'var(--eh-shadow-menu)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold" style={{ color: 'var(--eh-text-strong)' }}>
          {title}
        </h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--eh-text-2)' }}>{message}</p>
        {/* role="alert" — a mensagem surge sem mover o foco. */}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: 'var(--eh-danger-bg)', color: 'var(--eh-danger-fg)' }}
          >
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {primaryCancel ? (
            <>
              <DialogButton variant="secondary" onClick={onConfirm} disabled={loading}>
                {loading ? confirmBusyLabel : confirmLabel}
              </DialogButton>
              <DialogButton variant="primary" onClick={onCancel} disabled={loading}>
                Cancelar
              </DialogButton>
            </>
          ) : (
            <>
              <DialogButton variant="secondary" onClick={onCancel} disabled={loading}>
                Cancelar
              </DialogButton>
              <DialogButton variant={variant} onClick={onConfirm} disabled={loading}>
                {loading ? confirmBusyLabel : confirmLabel}
              </DialogButton>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
