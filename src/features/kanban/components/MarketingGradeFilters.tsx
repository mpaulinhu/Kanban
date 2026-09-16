import { useEffect, useMemo, useRef, useState } from 'react'
import type { PMTask } from '../types/pmOffice'

const STATUS_LABEL: Record<string, string> = {
  todo: 'A fazer',
  in_progress: 'Em andamento',
  done: 'Concluída',
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  normal: 'Normal',
  low: 'Baixa',
}

const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low']

const dropItemBase = {
  display: 'block' as const,
  width: '100%',
  textAlign: 'left' as const,
  fontSize: 12,
  fontWeight: 500,
  background: 'transparent',
  padding: '5px 10px',
  borderRadius: 5,
  border: 'none',
  cursor: 'pointer' as const,
  whiteSpace: 'nowrap' as const,
}

const dateInputStyle = {
  fontSize: 12.5,
  padding: '4px 8px',
  border: '1px solid var(--eh-border)',
  borderRadius: 6,
  background: 'var(--eh-surface)',
  color: 'var(--eh-text-strong)',
  outline: 'none',
  cursor: 'pointer' as const,
}

interface MultiFilterDropdownProps {
  label: string
  values: string[]
  options: { value: string; label: string }[]
  onChange: (v: string[]) => void
  onClearThis: () => void
  onClearAll: () => void
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}

function MultiFilterDropdown({
  label,
  values,
  options,
  onChange,
  onClearThis,
  onClearAll,
  isOpen,
  onToggle,
  onClose,
}: MultiFilterDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOut)
    return () => document.removeEventListener('mousedown', handleOut)
  }, [isOpen, onClose])

  const isActive = values.length > 0
  const buttonLabel = isActive
    ? values.length === 1
      ? (options.find((o) => o.value === values[0])?.label ?? values[0])
      : `${label} (${values.length})`
    : label

  function toggle(v: string) {
    if (values.includes(v)) onChange(values.filter((x) => x !== v))
    else onChange([...values, v])
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          fontSize: 12.5,
          fontWeight: isActive ? 600 : 500,
          border: `1px solid ${isActive ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
          borderRadius: 6,
          background: isActive ? 'var(--eh-bar-track)' : 'var(--eh-surface)',
          color: isActive ? 'var(--eh-primary)' : 'var(--eh-text-3)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{buttonLabel}</span>
        <span style={{ fontSize: 9, opacity: 0.6, lineHeight: 1 }}>▾</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 200,
            background: 'var(--eh-surface)',
            border: '1px solid var(--eh-border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: 4,
            minWidth: 175,
          }}
        >
          <button type="button" onClick={() => { onClearThis(); onClose() }} style={{ ...dropItemBase, color: 'var(--eh-muted-2)' }}>
            Limpar este filtro
          </button>
          <button type="button" onClick={() => { onClearAll(); onClose() }} style={{ ...dropItemBase, color: 'var(--eh-muted-2)' }}>
            Limpar todos os filtros
          </button>
          <div style={{ margin: '4px 6px', borderTop: '1px solid var(--eh-border)' }} />

          {options.map((opt) => {
            const checked = values.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                style={{
                  ...dropItemBase,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontWeight: checked ? 700 : 500,
                  color: checked ? 'var(--eh-primary)' : 'var(--eh-text-3)',
                  background: checked ? 'var(--eh-bar-track)' : 'transparent',
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: `1.5px solid ${checked ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
                  background: checked ? 'var(--eh-primary)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: 'white',
                }}>
                  {checked ? '✓' : ''}
                </span>
                {opt.label}
              </button>
            )
          })}

          {options.length === 0 && (
            <span style={{ ...dropItemBase, color: 'var(--eh-muted-2)', fontSize: 11.5, fontStyle: 'italic' }}>
              Sem opções disponíveis
            </span>
          )}
        </div>
      )}
    </div>
  )
}

interface FilterDropdownProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  onClearThis: () => void
  onClearAll: () => void
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}

function FilterDropdown({
  label,
  value,
  options,
  onChange,
  onClearThis,
  onClearAll,
  isOpen,
  onToggle,
  onClose,
}: FilterDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleOut)
    return () => document.removeEventListener('mousedown', handleOut)
  }, [isOpen, onClose])

  const activeLabel = value ? (options.find((o) => o.value === value)?.label ?? value) : null
  const isActive = !!value

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          fontSize: 12.5,
          fontWeight: isActive ? 600 : 500,
          border: `1px solid ${isActive ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
          borderRadius: 6,
          background: isActive ? 'var(--eh-bar-track)' : 'var(--eh-surface)',
          color: isActive ? 'var(--eh-primary)' : 'var(--eh-text-3)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{activeLabel ?? label}</span>
        <span style={{ fontSize: 9, opacity: 0.6, lineHeight: 1 }}>▾</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 200,
            background: 'var(--eh-surface)',
            border: '1px solid var(--eh-border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: 4,
            minWidth: 175,
          }}
        >
          {/* Ações fixas no topo */}
          <button
            type="button"
            onClick={() => { onClearThis(); onClose() }}
            style={{ ...dropItemBase, color: 'var(--eh-muted-2)' }}
          >
            Limpar este filtro
          </button>
          <button
            type="button"
            onClick={() => { onClearAll(); onClose() }}
            style={{ ...dropItemBase, color: 'var(--eh-muted-2)' }}
          >
            Limpar todos os filtros
          </button>
          <div style={{ margin: '4px 6px', borderTop: '1px solid var(--eh-border)' }} />

          {/* Valores dinâmicos */}
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); onClose() }}
              style={{
                ...dropItemBase,
                fontWeight: value === opt.value ? 700 : 500,
                color: value === opt.value ? 'var(--eh-primary)' : 'var(--eh-text-3)',
                background: value === opt.value ? 'var(--eh-bar-track)' : 'transparent',
              }}
            >
              {opt.label}
            </button>
          ))}

          {options.length === 0 && (
            <span
              style={{
                ...dropItemBase,
                color: 'var(--eh-muted-2)',
                fontSize: 11.5,
                fontStyle: 'italic',
              }}
            >
              Sem opções disponíveis
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export interface MarketingGradeFiltersProps {
  tasks: PMTask[]
  bucketMap: Record<string, string>
  filterStatus: string[]
  filterPriority: string[]
  filterCategory: string[]
  filterAssignee: string[]
  filterDateFrom: string
  filterDateTo: string
  /** ELO-2564: filtro rápido — só tarefas com badge "Fora do Prazo" */
  filterOverdueOnly: boolean
  assigneeOptions: string[]
  onFilterStatusChange: (v: string[]) => void
  onFilterPriorityChange: (v: string[]) => void
  onFilterCategoryChange: (v: string[]) => void
  onAssigneeChange: (v: string[]) => void
  onFilterDateFromChange: (v: string) => void
  onFilterDateToChange: (v: string) => void
  onFilterOverdueOnlyChange: (v: boolean) => void
  onClearAllFilters: () => void
}

export function MarketingGradeFilters({
  tasks,
  bucketMap,
  filterStatus,
  filterPriority,
  filterCategory,
  filterAssignee,
  filterDateFrom,
  filterDateTo,
  filterOverdueOnly,
  assigneeOptions,
  onFilterStatusChange,
  onFilterPriorityChange,
  onFilterCategoryChange,
  onAssigneeChange,
  onFilterDateFromChange,
  onFilterDateToChange,
  onFilterOverdueOnlyChange,
  onClearAllFilters,
}: MarketingGradeFiltersProps) {
  const [openDropdown, setOpenDropdown] = useState<'status' | 'priority' | 'category' | 'assignee' | null>(null)

  const statusOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const t of tasks) if (t.status) seen.add(t.status)
    return ['todo', 'in_progress', 'done']
      .filter((v) => seen.has(v))
      .map((v) => ({ value: v, label: STATUS_LABEL[v] ?? v }))
  }, [tasks])

  const priorityOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const t of tasks) if (t.priority) seen.add(t.priority)
    return PRIORITY_ORDER
      .filter((v) => seen.has(v))
      .map((v) => ({ value: v, label: PRIORITY_LABEL[v] ?? v }))
  }, [tasks])

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const t of tasks) if (t.bucketId) seen.add(t.bucketId)
    return [...seen]
      .map((v) => ({ value: v, label: bucketMap[v] ?? v }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [tasks, bucketMap])

  const assigneeDropdownOptions = useMemo(
    () => assigneeOptions.map((name) => ({ value: name, label: name })),
    [assigneeOptions],
  )

  const hasAnyFilter =
    filterStatus.length > 0 || filterPriority.length > 0 || filterCategory.length > 0 || filterAssignee.length > 0 || filterDateFrom || filterDateTo || filterOverdueOnly

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 24px',
        background: 'var(--eh-surface)',
        borderBottom: '1px solid var(--eh-border)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: 'var(--eh-muted-2)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Filtrar:
      </span>

      <MultiFilterDropdown
        label="Status"
        values={filterStatus}
        options={statusOptions}
        onChange={onFilterStatusChange}
        onClearThis={() => onFilterStatusChange([])}
        onClearAll={onClearAllFilters}
        isOpen={openDropdown === 'status'}
        onToggle={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
        onClose={() => setOpenDropdown(null)}
      />

      <MultiFilterDropdown
        label="Prioridade"
        values={filterPriority}
        options={priorityOptions}
        onChange={onFilterPriorityChange}
        onClearThis={() => onFilterPriorityChange([])}
        onClearAll={onClearAllFilters}
        isOpen={openDropdown === 'priority'}
        onToggle={() => setOpenDropdown(openDropdown === 'priority' ? null : 'priority')}
        onClose={() => setOpenDropdown(null)}
      />

      <MultiFilterDropdown
        label="Categoria"
        values={filterCategory}
        options={categoryOptions}
        onChange={onFilterCategoryChange}
        onClearThis={() => onFilterCategoryChange([])}
        onClearAll={onClearAllFilters}
        isOpen={openDropdown === 'category'}
        onToggle={() => setOpenDropdown(openDropdown === 'category' ? null : 'category')}
        onClose={() => setOpenDropdown(null)}
      />

      <MultiFilterDropdown
        label="Atribuído"
        values={filterAssignee}
        options={assigneeDropdownOptions}
        onChange={onAssigneeChange}
        onClearThis={() => onAssigneeChange([])}
        onClearAll={onClearAllFilters}
        isOpen={openDropdown === 'assignee'}
        onToggle={() => setOpenDropdown(openDropdown === 'assignee' ? null : 'assignee')}
        onClose={() => setOpenDropdown(null)}
      />

      {/* ELO-2564: filtro rápido — só tarefas fora do prazo (concluídas atrasadas + em aberto vencidas) */}
      <button
        type="button"
        onClick={() => onFilterOverdueOnlyChange(!filterOverdueOnly)}
        aria-pressed={filterOverdueOnly}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          fontSize: 12.5,
          fontWeight: filterOverdueOnly ? 600 : 500,
          border: `1px solid ${filterOverdueOnly ? 'var(--eh-danger-fg)' : 'var(--eh-border)'}`,
          borderRadius: 6,
          background: filterOverdueOnly ? 'var(--eh-danger-bg)' : 'var(--eh-surface)',
          color: filterOverdueOnly ? 'var(--eh-danger-fg)' : 'var(--eh-text-3)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Fora do Prazo
      </button>

      {/* flexWrap: este bloco (rótulo + 2 <input type="date"> + "até") é filho
          do container com flexWrap lá fora, mas sozinho ele já passa de 390px
          — <input type="date"> nativo tem largura intrínseca própria. Sem
          quebra interna, "até dd/mm/aaaa" vazava pela borda direita da tela. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--eh-muted-2)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Período:
        </span>
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => onFilterDateFromChange(e.target.value)}
          style={dateInputStyle}
          aria-label="Data de início do período"
        />
        <span style={{ fontSize: 12, color: 'var(--eh-muted-2)' }}>até</span>
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => onFilterDateToChange(e.target.value)}
          style={dateInputStyle}
          aria-label="Data de fim do período"
        />
      </div>

      {hasAnyFilter && (
        <button
          type="button"
          onClick={onClearAllFilters}
          style={{
            fontSize: 11.5,
            color: 'var(--eh-danger)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            marginLeft: 4,
            padding: '2px 4px',
          }}
        >
          Limpar tudo ✕
        </button>
      )}
    </div>
  )
}
