import { useEffect, useId, useRef, useState } from 'react'
import type { UserRecord } from '../api/usersApi'

/** Chave-sentinela do filtro "Sem responsável", análoga à de "Sem etiqueta". */
export const NO_ASSIGNEE_FILTER_KEY = '__no_assignee__'

/**
 * Casca comum dos filtros do cabeçalho — botão + painel flutuante.
 *
 * Existe para que Responsável, Status e Ordenação sejam três controles
 * independentes lado a lado (e não um painel só), mantendo entre eles e o
 * `LabelFilterDropdown` o mesmo comportamento: fecha ao clicar fora, Escape
 * fecha e devolve o foco ao botão, e o mesmo par de estilos claro/escuro.
 */
function FilterDropdown({
  label,
  badge,
  active,
  panelLabel,
  pedagogia,
  children,
}: {
  label: string
  /** Número ao lado do rótulo. Ausente quando o controle não "esconde" nada. */
  badge?: number
  active: boolean
  panelLabel: string
  pedagogia: boolean
  children: (close: () => void) => React.ReactNode
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

  function closeAndRestoreFocus() {
    setOpen(false)
    buttonRef.current?.focus()
  }

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
        data-active={pedagogia ? active || open : undefined}
        style={
          pedagogia
            ? {
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                borderRadius: 7, fontSize: 13, fontWeight: 500,
                border: '1px solid transparent', color: 'var(--eh-pm-header-fg)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }
            : {
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                borderRadius: 7, fontSize: 13, fontWeight: 500,
                border: `1px solid ${active ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
                background: active ? 'var(--eh-primary-soft, var(--eh-surface))' : 'var(--eh-surface)',
                color: active ? 'var(--eh-primary)' : 'var(--eh-text-3)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }
        }
      >
        {label}
        {/* Badge SOBREPOSTO (`position: absolute`), não concatenado no texto
            do rótulo — um contador inline (`Etiquetas (1)`) muda a largura
            do próprio botão a cada seleção, empurrando os filtros seguintes
            e tudo à direita deles (busca, "Mostrar arquivadas", abas). Mais
            visível numa barra cheia sem vão elástico sobrando (o cabeçalho
            do Calendário, por exemplo) do que no Quadro, mas o bug era do
            componente compartilhado — corrigido aqui pros dois. */}
        {badge ? (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              minWidth: 15,
              height: 15,
              padding: '0 3px',
              borderRadius: 999,
              fontSize: 9.5,
              fontWeight: 700,
              lineHeight: '15px',
              textAlign: 'center',
              background: pedagogia ? 'var(--eh-pm-header-fg)' : 'var(--eh-primary)',
              color: pedagogia ? 'var(--eh-pm-header-fg-inverse)' : 'var(--eh-surface)',
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={panelLabel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeAndRestoreFocus() }
          }}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 210,
            maxHeight: 340,
            overflowY: 'auto',
            background: 'var(--eh-surface)',
            border: '1px solid var(--eh-border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.16)',
            zIndex: 50,
            padding: 6,
          }}
        >
          {children(closeAndRestoreFocus)}
        </div>
      )}
    </div>
  )
}

const checkboxRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  fontSize: 12.5,
  color: 'var(--eh-text)',
  cursor: 'pointer',
  borderRadius: 6,
}

function toggle(list: string[], key: string, onChange: (next: string[]) => void) {
  onChange(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])
}

/** Filtro por responsável, com opção explícita "Sem responsável". */
export function AssigneeFilterDropdown({
  users,
  selected,
  onChange,
  pedagogia = false,
}: {
  users: UserRecord[]
  selected: string[]
  onChange: (next: string[]) => void
  pedagogia?: boolean
}) {
  if (users.length === 0) return null
  return (
    <FilterDropdown
      label="Responsável"
      badge={selected.length}
      active={selected.length > 0}
      panelLabel="Filtrar por responsável"
      pedagogia={pedagogia}
    >
      {() => (
        <>
          <label style={{ ...checkboxRow, color: 'var(--eh-text-3)' }}>
            <input
              type="checkbox"
              checked={selected.includes(NO_ASSIGNEE_FILTER_KEY)}
              onChange={() => toggle(selected, NO_ASSIGNEE_FILTER_KEY, onChange)}
            />
            Sem responsável
          </label>
          <div style={{ height: 1, background: 'var(--eh-border)', margin: '4px 0' }} />
          {users.map((u) => (
            <label key={u.uid} style={checkboxRow}>
              <input
                type="checkbox"
                checked={selected.includes(u.uid)}
                onChange={() => toggle(selected, u.uid, onChange)}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.name}
              </span>
            </label>
          ))}
        </>
      )}
    </FilterDropdown>
  )
}

/** Filtro por status da tarefa. */
export function StatusFilterDropdown({
  options,
  selected,
  onChange,
  pedagogia = false,
}: {
  options: { id: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
  pedagogia?: boolean
}) {
  return (
    <FilterDropdown
      label="Status"
      badge={selected.length}
      active={selected.length > 0}
      panelLabel="Filtrar por status"
      pedagogia={pedagogia}
    >
      {() => (
        <>
          {options.map((o) => (
            <label key={o.id} style={checkboxRow}>
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => toggle(selected, o.id, onChange)}
              />
              {o.label}
            </label>
          ))}
        </>
      )}
    </FilterDropdown>
  )
}

/**
 * Ordenação. Sem `badge`: ela reorganiza os cards, não esconde nenhum, então
 * um contador sugeriria que há tarefas fora de vista.
 */
export function SortDropdown({
  options,
  value,
  onChange,
  pedagogia = false,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (next: string) => void
  pedagogia?: boolean
}) {
  return (
    <FilterDropdown
      label="Ordenar"
      active={value !== 'manual'}
      panelLabel="Ordenar tarefas"
      pedagogia={pedagogia}
    >
      {(close) => (
        <>
          {options.map((o) => (
            <label key={o.id} style={checkboxRow}>
              <input
                type="radio"
                name="board-sort"
                checked={value === o.id}
                onChange={() => { onChange(o.id); close() }}
              />
              {o.label}
            </label>
          ))}
        </>
      )}
    </FilterDropdown>
  )
}
