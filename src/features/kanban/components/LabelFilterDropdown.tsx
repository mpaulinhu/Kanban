import { useEffect, useId, useRef, useState } from 'react'
import type { PMOfficeLabel } from '../types/pmOffice'
import { labelColorTokens } from '../utils/labelColors'

/** Chave-sentinela do filtro "Sem etiqueta" — mantida em sincronia com a página que consome este componente. */
export const NO_LABEL_FILTER_KEY = '__no_label__'

/**
 * Dropdown de filtro por etiqueta (ELO-3182), com opção explícita "Sem
 * etiqueta" — não é um estado implícito de "nenhum filtro selecionado", é
 * uma seleção própria que restringe às tarefas SEM nenhuma etiqueta.
 *
 * Etiquetas fundidas (`mergedInto` preenchido) não aparecem como opção
 * própria — só o alvo da fusão aparece, e filtrar pelo alvo já cobre os
 * cards que ainda referenciam o id fundido (resolução em `resolveLabelDisplay`).
 *
 * ARIA + Escape (correção do gate ux-ui-reviewer, 15/09/2026): mesmo padrão
 * de `CreatePlannerProjectModal.tsx`/`PlannerBucketTree.tsx` neste mesmo
 * diretório — `aria-haspopup`/`aria-expanded`/`aria-controls` no botão,
 * `role`+`aria-label` no painel, Escape fecha e devolve foco ao botão.
 */
export function LabelFilterDropdown({
  labels,
  selected,
  onChange,
  pedagogia = false,
}: {
  labels: PMOfficeLabel[]
  selected: string[]
  onChange: (next: string[]) => void
  /** ELO-3182 (2ª rodada: botão transparente por padrão, fundo translúcido só
   * no hover/seleção — mesmo padrão de `.eh-pm-header-btn` em
   * MarketingQuadroPage.tsx, ver `NavButton`) sobre o header escuro da
   * Pedagogia — o painel ABERTO continua claro/normal (é um overlay
   * flutuante, não faz parte da barra). `false` (default) preserva o
   * visual atual para Marketing/Administrativo sem nenhuma mudança —
   * na prática elas nunca chegam a passar esta prop, já que hoje não têm
   * etiqueta gravada e o componente nem renderiza (`visibleLabels.length
   * === 0`), mas a prop existe pra não depender só disso silenciosamente. */
  pedagogia?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const visibleLabels = labels.filter((l) => !l.mergedInto)
  const hasSelection = selected.length > 0

  function toggle(key: string) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])
  }

  function closeAndRestoreFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  if (visibleLabels.length === 0) return null

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) { e.stopPropagation(); closeAndRestoreFocus() }
        }}
        className={pedagogia ? 'eh-pm-header-btn' : undefined}
        data-active={pedagogia ? hasSelection || open : undefined}
        style={
          pedagogia
            ? {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid transparent',
                color: 'var(--eh-pm-header-fg)',
                cursor: 'pointer',
              }
            : {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 500,
                border: `1px solid ${hasSelection ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
                background: hasSelection ? 'var(--eh-primary-soft, var(--eh-surface))' : 'var(--eh-surface)',
                color: hasSelection ? 'var(--eh-primary)' : 'var(--eh-text-3)',
                cursor: 'pointer',
              }
        }
      >
        Etiquetas{hasSelection ? ` (${selected.length})` : ''}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Filtrar por etiqueta"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeAndRestoreFocus() }
          }}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 220,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--eh-surface)',
            border: '1px solid var(--eh-border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.16)',
            zIndex: 50,
            padding: 6,
          }}
        >
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              fontSize: 12.5, color: 'var(--eh-text-3)', cursor: 'pointer', borderRadius: 6,
            }}
          >
            <input
              type="checkbox"
              checked={selected.includes(NO_LABEL_FILTER_KEY)}
              onChange={() => toggle(NO_LABEL_FILTER_KEY)}
            />
            Sem etiqueta
          </label>
          <div style={{ height: 1, background: 'var(--eh-border)', margin: '4px 0' }} />
          {visibleLabels.map((label) => {
            const { bg, fg } = labelColorTokens(label.trelloColor)
            return (
              <label
                key={label.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  fontSize: 12.5, color: 'var(--eh-text)', cursor: 'pointer', borderRadius: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(label.id)}
                  onChange={() => toggle(label.id)}
                />
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', padding: '1px 7px',
                    borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: bg, color: fg,
                  }}
                >
                  {label.displayName}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
