import { useEffect, useRef, useState } from 'react'

/**
 * Campo de texto "documento" (ELO-3182, refinamento visual Pedagogia) —
 * fora do modo de edição mostra texto puro (sem rótulo de campo, sem
 * borda); clicar abre um `<input>`/`<textarea>` inline; blur ou Enter
 * (Ctrl+Enter no multilinha) salva; Escape cancela sem gravar.
 *
 * Design deliberado pra evitar perda silenciosa de dado (risco levantado
 * explicitamente pelo Marcos — "salvar no blur sem botão Salvar" pode
 * gravar toda vez que o usuário clica fora):
 * - `onSave` só é chamado se o valor MUDOU de fato (`trim()` comparado ao
 *   valor original) — clicar e sair sem editar não dispara escrita.
 * - Erro de gravação fica visível (`saveError` local, banner vermelho
 *   inline) — nunca só `console.error`. O campo VOLTA pro modo de edição
 *   com o valor que falhou, para o usuário não perder o que digitou.
 * - Enquanto uma gravação está em voo (`saving`), um segundo blur/Enter é
 *   ignorado (evita corrida de duas escritas concorrentes pro mesmo campo).
 *
 * Risco residual CONHECIDO e ACEITO (documentado, não ignorado): clicar no
 * ✕/backdrop do modal enquanto este campo está em edição dispara blur ANTES
 * do fechamento — confirmado empiricamente (ordem de eventos do DOM é
 * garantida pela spec: blur do elemento anterior sempre roda antes do click
 * do novo alvo; testado com Playwright headless real, não só teoria). A
 * escrita no Firestore é iniciada e continua em voo mesmo após o modal
 * desmontar (promises não são canceladas por unmount). O único cenário não
 * coberto: a escrita FALHAR depois que o modal já fechou — o banner de erro
 * não tem onde aparecer (o componente já desmontou), sobra só o
 * `console.error`. Bloquear o fechamento até toda escrita pendente terminar
 * resolveria isso, mas é uma mudança de UX maior (modal "trava" ao fechar)
 * não pedida — risco aceito conscientemente, não silencioso: está
 * documentado aqui e no relatório da issue.
 */
export function InlineEditableText({
  value,
  onSave,
  placeholder,
  multiline = false,
  fontSize,
  fontWeight,
  lineHeight,
  color,
  minHeight,
  ariaLabel,
  disabled = false,
  boxed = false,
}: {
  value: string
  onSave: (next: string) => Promise<void>
  placeholder?: string
  multiline?: boolean
  fontSize?: number
  fontWeight?: number
  lineHeight?: number | string
  color?: string
  minHeight?: number
  ariaLabel: string
  /** Viewer (`readOnly`) — mostra o texto, mas clicar não abre edição. */
  disabled?: boolean
  /**
   * ELO-3182 (refino, pedido do Marcos: "Descrição tem um bloquinho... o
   * nosso é discreto demais, quase invisível até clicar"). `false` (default)
   * preserva o comportamento original — texto puro em repouso, fundo só no
   * hover — usado pelo título (não deve parecer um campo de formulário).
   * `true` aplica fundo + borda JÁ NO REPOUSO, imitando a caixa do campo de
   * Descrição do Trello: dá presença ao campo mesmo antes de clicar, em vez
   * de ficar invisível até o hover.
   */
  boxed?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  // Sincroniza o draft com o valor externo quando NÃO está editando — evita
  // sobrescrever o que o usuário está digitando se `value` mudar por outro
  // motivo (ex.: outro campo do mesmo save disparou um re-render do task).
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    if (disabled || saving) return
    setSaveError(null)
    setDraft(value)
    setEditing(true)
  }

  async function commit() {
    const trimmed = draft.trim()
    const originalTrimmed = value.trim()
    // Nada mudou — sai do modo de edição sem gravar (evita escrita a cada
    // clique-fora, que é exatamente o risco de "salvar no blur sem botão").
    if (trimmed === originalTrimmed) {
      setEditing(false)
      setSaveError(null)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (err) {
      // Erro fica visível pro usuário — nunca só console.error. O campo
      // permanece em edição com o texto que falhou, para não perder o que
      // foi digitado.
      console.error('[InlineEditableText] falha ao salvar', err)
      setSaveError('Não foi possível salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
    setSaveError(null)
  }

  const textStyle = { fontSize, fontWeight, lineHeight, color }

  if (!editing) {
    return (
      <div
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? undefined : 0}
        aria-label={disabled ? undefined : `Editar ${ariaLabel}`}
        onClick={startEditing}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startEditing() }
        }}
        style={{
          ...textStyle,
          cursor: disabled ? 'default' : 'text',
          whiteSpace: multiline ? 'pre-wrap' : undefined,
          wordBreak: 'break-word',
          borderRadius: 4,
          // `boxed`: fundo + borda JÁ NO REPOUSO (padding maior para a caixa
          // não ficar apertada) — mede aproximadamente a caixa de Descrição
          // do Trello (~90px de altura medidos em trello-3-modal.png).
          // `!boxed` preserva byte a byte o comportamento anterior (usado
          // pelo título): sem fundo/borda em repouso, padding compacto.
          padding: boxed ? '10px 12px' : '2px 4px',
          margin: boxed ? 0 : '-2px -4px',
          background: boxed ? 'var(--eh-pm-neutral-surface)' : 'transparent',
          // `--eh-muted-4`, NÃO `--eh-border`: medido explicitamente (gate de
          // WCAG 1.4.11, contorno de componente ⩾3:1) — `--eh-border` contra
          // `--eh-pm-neutral-surface` mede só 1,13:1 no claro e a composição
          // equivalente no escuro mede 1,03:1, os dois MUITO abaixo do piso.
          // `--eh-muted-4` mede 3,29:1 (claro) e 4,93:1 (escuro) — token já
          // existente no sistema, sem precisar de cor nova em globals.css.
          border: boxed ? '1px solid var(--eh-muted-4)' : undefined,
          minHeight: multiline ? minHeight : undefined,
        }}
        onMouseEnter={(e) => { if (!disabled && !boxed) e.currentTarget.style.background = 'var(--eh-pm-neutral-surface)' }}
        onMouseLeave={(e) => { if (!boxed) e.currentTarget.style.background = 'transparent' }}
      >
        {/* ELO-3182 (refino visual, correção de contraste): era --eh-muted-2
            (2,42:1 sobre --eh-pm-neutral-surface, abaixo de AA — débito
            conhecido do token, ver docs internos) — trocado pra --eh-text-3
            (7,10:1 no claro / 7,37:1 no escuro), que já é o tom "cinza
            secundário" usado no resto do PM Office (ex.: TaskAttachments.tsx)
            e mantém a hierarquia visual de "texto de instrução", só que
            legível. Placeholder tecnicamente não é sujeito ao critério de
            contraste da WCAG 1.4.3 (é conteúdo incidental, não informação),
            mas não há motivo pra manter o valor mais fraco quando um token
            já disponível resolve sem custo. */}
        {value || <span style={{ color: 'var(--eh-text-3)' }}>{placeholder}</span>}
      </div>
    )
  }

  const sharedProps = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => { if (!saving) void commit() },
    disabled: saving,
    placeholder,
    className: 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
    style: { ...textStyle, borderRadius: 4, resize: multiline ? ('vertical' as const) : undefined, minHeight: multiline ? minHeight : undefined },
  }

  return (
    <div>
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          {...sharedProps}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
            // Ctrl+Enter (ou Cmd+Enter no Mac) salva — Enter sozinho quebra linha, como um textarea normal.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void commit() }
          }}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          {...sharedProps}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
          }}
        />
      )}
      {saveError && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
          {saveError}
        </p>
      )}
    </div>
  )
}
