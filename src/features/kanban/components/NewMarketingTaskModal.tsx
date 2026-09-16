import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ChecklistItem, MarketingTaskTemplate, PMBucket, RecurrenceConfig } from '../types/pmOffice'
import { RecurrenceControl } from './RecurrenceControl'
import { onlyInternalUsers } from '@/lib/internalDomains'
import type { UserRecord } from '../api/usersApi'
import {
  isMarketingTemplateSeedAttempted,
  migrateCasteloEloTemplates,
  migrateMarketingTemplatesCategorias,
  seedMarketingTemplatesIfNeeded,
  subscribeTemplates,
} from '../api/marketingPlannerApi'

interface NewMarketingTaskModalProps {
  bucket: PMBucket
  users: UserRecord[]
  onClose: () => void
  onConfirm: (
    title: string,
    opts: { dueDate?: Date; checklist: ChecklistItem[]; recurrence?: RecurrenceConfig; assignees: string[]; assigneesNames: string[] },
  ) => Promise<void>
  /**
   * Área dona dos templates exibidos.
   * Default `'marketing'` — comportamento inalterado para as telas
   * existentes. Administrativo/Pedagogia nascem sem seed automático:
   * `seedMarketingTemplatesIfNeeded`/migrações de categoria legada só rodam
   * para `'marketing'`, que é o único conteúdo a que elas se referem.
   */
  area?: 'marketing' | 'administrativo' | 'pedagogia'
}

// ── Estilos base ──────────────────────────────────────────────────────────────

const S = {
  label: {
    display: 'block' as const,
    fontSize: 12,
    fontWeight: 600 as const,
    color: 'var(--eh-text-3)',
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
    marginBottom: 5,
  } satisfies CSSProperties,
  input: (hasError = false): CSSProperties => ({
    width: '100%',
    padding: '9px 12px',
    border: `1.5px solid ${hasError ? 'var(--eh-danger)' : 'var(--eh-border-input)'}`,
    borderRadius: 8,
    fontSize: 13.5,
    fontFamily: 'inherit',
    color: 'var(--eh-text)',
    background: 'var(--eh-surface)',
    outline: 'none',
    boxSizing: 'border-box' as const,
  }),
  btn: (primary: boolean, disabled = false): CSSProperties => ({
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600 as const,
    color: primary ? 'var(--eh-surface)' : 'var(--eh-text-2)',
    background: primary
      ? disabled ? 'var(--eh-muted-2)' : 'var(--eh-text-strong)'
      : 'var(--eh-bg)',
    border: primary ? 'none' : '1px solid var(--eh-border)',
    borderRadius: 8,
    padding: '8px 18px',
    cursor: disabled ? 'default' as const : 'pointer' as const,
    opacity: disabled ? 0.55 : 1,
    flexShrink: 0,
  }),
}

// ── Componente de item de checklist editável ──────────────────────────────────

function ChecklistItemRow({
  text,
  index,
  onUpdate,
  onRemove,
  onKeyDownEnter,
}: {
  text: string
  index: number
  onUpdate: (index: number, value: string) => void
  onRemove: (index: number) => void
  onKeyDownEnter: (index: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ color: 'var(--eh-muted-2)', fontSize: 12, flexShrink: 0, width: 14, textAlign: 'right' }}>
        {index + 1}.
      </span>
      <input
        value={text}
        onChange={(e) => onUpdate(index, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onKeyDownEnter(index) }
        }}
        style={{
          flex: 1,
          padding: '5px 8px',
          fontSize: 13,
          border: '1px solid var(--eh-border)',
          borderRadius: 6,
          fontFamily: 'inherit',
          color: 'var(--eh-text)',
          background: 'var(--eh-surface)',
          outline: 'none',
        }}
        aria-label={`Item de checklist ${index + 1}`}
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Remover item ${index + 1}`}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--eh-text-2)',
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
          padding: '0 2px',
        }}
      >
        ×
      </button>
    </div>
  )
}

// ── Card de template para seleção ─────────────────────────────────────────────

function TemplateSelectCard({
  tpl,
  expanded,
  selected,
  onToggleExpand,
  onUse,
}: {
  tpl: MarketingTaskTemplate
  expanded: boolean
  selected: boolean
  onToggleExpand: () => void
  onUse: () => void
}) {
  const cardStyle: CSSProperties = {
    border: `1.5px solid ${selected ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
    borderRadius: 8,
    overflow: 'hidden',
    background: selected ? 'var(--eh-bar-track)' : 'var(--eh-bg)',
    marginBottom: 6,
  }

  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '9px 12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left' as const,
          fontFamily: 'inherit',
        }}
      >
        <span
          style={{
            display: 'block',
            width: 6,
            height: 6,
            flexShrink: 0,
            borderRight: '1.5px solid var(--eh-text-2)',
            borderBottom: '1.5px solid var(--eh-text-2)',
            transform: `rotate(${expanded ? '45deg' : '-45deg'})`,
            transition: 'transform .12s',
            marginTop: expanded ? -3 : 1,
          }}
        />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--eh-text)' }}>
          {tpl.name}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--eh-text-3)', flexShrink: 0 }}>
          {tpl.checklist.length} item{tpl.checklist.length !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--eh-border)', padding: '8px 12px 10px 28px' }}>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', marginBottom: 10 }}>
            {tpl.checklist.map((item, idx) => (
              <li
                key={idx}
                style={{
                  fontSize: 12.5,
                  color: 'var(--eh-text-2)',
                  padding: '2px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ color: 'var(--eh-muted-2)', fontSize: 11 }}>{idx + 1}.</span>
                {item}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUse() }}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: selected ? 'var(--eh-primary)' : 'var(--eh-text-2)',
              background: 'none',
              border: `1px solid ${selected ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {selected ? 'Template selecionado' : 'Usar este template'}
          </button>
        </div>
      )}
    </div>
  )
}

// Normaliza nome de bucket/categoria para comparação: remove variantes Unicode de
// hífen (U+2010–U+2015, U+2212 etc.) e espaço não-separável (U+00A0 etc.)
function normalizeBucketName(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[­‐‑‒–—―−﹘﹣－]/g, '-')
    .replace(/[               　]/g, ' ')
    .trim()
}

// ── Modal principal ───────────────────────────────────────────────────────────

export function NewMarketingTaskModal({ bucket, users, onClose, onConfirm, area = 'marketing' }: NewMarketingTaskModalProps) {
  const [title, setTitle] = useState('')
  const [dueDateStr, setDueDateStr] = useState('')
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([])
  const [selectedAssigneesNames, setSelectedAssigneesNames] = useState<string[]>([])
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false)
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrenceConfig['pattern']>('daily')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([])
  const [checklistItems, setChecklistItems] = useState<string[]>([])
  const [newItemText, setNewItemText] = useState('')
  const [templates, setTemplates] = useState<MarketingTaskTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const newItemRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLInputElement | null)[]>([])

  // Auto-focus no título ao abrir
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Subscrição em tempo real de templates filtrados pela tag/coluna do bucket
  useEffect(() => {
    setTemplatesLoading(true)
    const unsub = subscribeTemplates((all) => {
      // Seed automático e migrações de categoria legada são conteúdo
      // específico de Marketing — Administrativo nasce vazio.
      if (area === 'marketing') {
        // Se coleção vazia e seed ainda não foi tentado, aguarda seed + próximo snapshot
        if (all.length === 0 && !isMarketingTemplateSeedAttempted()) {
          void seedMarketingTemplatesIfNeeded([])
          return
        }
        // Migra templates legados com categorias erradas (roda uma vez por sessão)
        void migrateMarketingTemplatesCategorias(all)
        void migrateCasteloEloTemplates(all)
      }
      const filtered = all.filter((t) =>
        t.categorias.some((cat) => normalizeBucketName(cat) === normalizeBucketName(bucket.name)),
      )
      setTemplates(filtered)
      setTemplatesLoading(false)
    })
    return unsub
  }, [bucket.name, area])

  function applyTemplate(tpl: MarketingTaskTemplate) {
    setChecklistItems([...tpl.checklist])
    setSelectedTemplateId(tpl.id)
    // Expande o template selecionado se não estiver expandido
    setExpandedTemplateId((prev) => (prev === tpl.id ? prev : tpl.id))
  }

  function updateItem(index: number, value: string) {
    setChecklistItems((prev) => prev.map((item, i) => (i === index ? value : item)))
  }

  function removeItem(index: number) {
    setChecklistItems((prev) => prev.filter((_, i) => i !== index))
    // Se o template selecionado foi modificado, desseleciona
    setSelectedTemplateId(null)
  }

  function handleItemEnter(index: number) {
    // Move foco para o próximo item ou para o campo de novo item
    if (index < checklistItems.length - 1) {
      itemRefs.current[index + 1]?.focus()
    } else {
      newItemRef.current?.focus()
    }
  }

  function addNewItem() {
    const text = newItemText.trim()
    if (!text) return
    setChecklistItems((prev) => [...prev, text])
    setNewItemText('')
    setSelectedTemplateId(null)
    // Foca no novo item após render
    setTimeout(() => {
      itemRefs.current[checklistItems.length]?.focus()
    }, 0)
  }

  async function handleConfirm() {
    if (!title.trim()) {
      setTitleError(true)
      titleRef.current?.focus()
      return
    }

    setSaving(true)
    try {
      const now = Date.now()
      const checklist: ChecklistItem[] = checklistItems
        .filter((text) => text.trim())
        .map((text, index) => ({
          id: `chk_${now}_${index}`,
          title: text.trim(),
          isChecked: false,
          status: 'aguardando' as const,
          orderHint: String(index),
        }))

      const dueDate = dueDateStr ? new Date(`${dueDateStr}T00:00:00`) : undefined
      const recurrence: RecurrenceConfig | undefined = recurrenceEnabled
        ? {
            pattern: recurrencePattern,
            interval: recurrencePattern === 'custom-days' ? 1 : recurrenceInterval,
            ...(recurrencePattern === 'custom-days' ? { daysOfWeek: recurrenceDays } : {}),
          }
        : undefined
      await onConfirm(title.trim(), { dueDate, checklist, recurrence, assignees: selectedAssignees, assigneesNames: selectedAssigneesNames })
    } finally {
      setSaving(false)
    }
  }

  const hasTemplates = !templatesLoading && templates.length > 0
  // Só equipe interna é candidata a responsável. Os chips do que já
  // foi escolhido vêm de `selectedAssigneesNames` (estado local), então filtrar
  // aqui não faz ninguém já selecionado sumir.
  const selectableUsers = onlyInternalUsers(users)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.42)',
        backdropFilter: 'blur(3px)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--eh-surface)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 540,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(15,23,42,0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Cabeçalho */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--eh-border)',
          }}
        >
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--eh-text)' }}>
              Nova tarefa
            </span>
            <span
              style={{
                marginLeft: 8,
                fontSize: 12,
                color: 'var(--eh-text-3)',
                fontWeight: 500,
              }}
            >
              {bucket.name}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: 'none',
              background: 'var(--eh-bg)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="var(--eh-text-2)"
              strokeWidth="2.3"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Corpo do formulário */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Título */}
          <div>
            <label style={S.label} htmlFor="task-title">
              Título
            </label>
            <input
              id="task-title"
              ref={titleRef}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (titleError && e.target.value.trim()) setTitleError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void handleConfirm() }
                if (e.key === 'Escape') onClose()
              }}
              placeholder="Título da tarefa..."
              style={S.input(titleError)}
              aria-required="true"
              aria-invalid={titleError}
            />
            {titleError && (
              <span
                style={{ fontSize: 11.5, color: 'var(--eh-danger)', marginTop: 4, display: 'block' }}
              >
                O título é obrigatório.
              </span>
            )}
          </div>

          {/* Data de término */}
          <div>
            <label style={S.label} htmlFor="task-due-date">
              Data de término
              <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 4 }}>
                (opcional)
              </span>
            </label>
            <input
              id="task-due-date"
              type="date"
              value={dueDateStr}
              onChange={(e) => setDueDateStr(e.target.value)}
              style={{ ...S.input(), maxWidth: 200 }}
            />
          </div>

          {/* Atribuído */}
          {selectableUsers.length > 0 && (
            <div>
              <label style={S.label}>
                Atribuído
                <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 4 }}>(opcional)</span>
              </label>
              {selectedAssigneesNames.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  {selectedAssigneesNames.map((name, i) => (
                    <span
                      key={selectedAssignees[i] ?? `n-${i}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, borderRadius: 20, padding: '2px 10px', background: 'var(--eh-surface-2)', color: 'var(--eh-text)' }}
                    >
                      {name}
                      <button
                        type="button"
                        aria-label={`Remover ${name}`}
                        onClick={() => {
                          setSelectedAssignees(prev => prev.filter((_, j) => j !== i))
                          setSelectedAssigneesNames(prev => prev.filter((_, j) => j !== i))
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eh-text-2)', fontSize: 14, lineHeight: 1, padding: '0 1px' }}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ maxHeight: 140, overflowY: 'auto', border: '1.5px solid var(--eh-border-input)', borderRadius: 8, background: 'var(--eh-surface)' }}>
                {selectableUsers.map(u => {
                  const checked = selectedAssignees.includes(u.uid)
                  return (
                    <label
                      key={u.uid}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid var(--eh-border)', fontSize: 13 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) {
                            const idx = selectedAssignees.indexOf(u.uid)
                            setSelectedAssignees(prev => prev.filter((_, j) => j !== idx))
                            setSelectedAssigneesNames(prev => prev.filter((_, j) => j !== idx))
                          } else {
                            setSelectedAssignees(prev => [...prev, u.uid])
                            setSelectedAssigneesNames(prev => [...prev, u.name])
                          }
                        }}
                        style={{ flexShrink: 0 }}
                      />
                      <span style={{ flex: 1, color: 'var(--eh-text)', fontWeight: checked ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--eh-text-3)', flexShrink: 0 }}>{u.email}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recorrência */}
          <RecurrenceControl
            enabled={recurrenceEnabled}
            onEnabledChange={setRecurrenceEnabled}
            pattern={recurrencePattern}
            onPatternChange={setRecurrencePattern}
            interval={recurrenceInterval}
            onIntervalChange={setRecurrenceInterval}
            days={recurrenceDays}
            onDaysChange={setRecurrenceDays}
          />

          {/* Seção de templates */}
          <div>
            <label style={{ ...S.label, marginBottom: hasTemplates ? 8 : 4 }}>
              Templates
            </label>

            {templatesLoading && (
              <span style={{ fontSize: 12.5, color: 'var(--eh-muted-2)' }}>
                Carregando templates...
              </span>
            )}

            {!templatesLoading && templates.length === 0 && (
              <span style={{ fontSize: 12.5, color: 'var(--eh-muted-2)', fontStyle: 'italic' }}>
                Nenhum template disponível para esta coluna.
              </span>
            )}

            {hasTemplates &&
              templates.map((tpl) => (
                <TemplateSelectCard
                  key={tpl.id}
                  tpl={tpl}
                  expanded={expandedTemplateId === tpl.id}
                  selected={selectedTemplateId === tpl.id}
                  onToggleExpand={() =>
                    setExpandedTemplateId((prev) => (prev === tpl.id ? null : tpl.id))
                  }
                  onUse={() => applyTemplate(tpl)}
                />
              ))}
          </div>

          {/* Editor de checklist */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <label style={{ ...S.label, marginBottom: 0 }}>
                Checklist
                {checklistItems.length > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontWeight: 400,
                      textTransform: 'none',
                      color: 'var(--eh-text-3)',
                    }}
                  >
                    ({checklistItems.length})
                  </span>
                )}
              </label>
              {checklistItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setChecklistItems([]); setSelectedTemplateId(null) }}
                  style={{
                    fontSize: 11.5,
                    color: 'var(--eh-text-3)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: 'inherit',
                  }}
                >
                  Limpar tudo
                </button>
              )}
            </div>

            {checklistItems.length === 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--eh-muted-2)', margin: '0 0 8px', fontStyle: 'italic' }}>
                Sem itens. Selecione um template ou adicione itens manualmente.
              </p>
            )}

            <div>
              {checklistItems.map((item, index) => (
                <ChecklistItemRow
                  key={index}
                  text={item}
                  index={index}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                  onKeyDownEnter={handleItemEnter}
                />
              ))}
            </div>

            {/* Campo para adicionar novo item */}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                ref={newItemRef}
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addNewItem() }
                }}
                placeholder="Adicionar item..."
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  fontSize: 13,
                  border: '1px dashed var(--eh-border-hover)',
                  borderRadius: 6,
                  fontFamily: 'inherit',
                  color: 'var(--eh-text)',
                  background: 'var(--eh-bg)',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={addNewItem}
                disabled={!newItemText.trim()}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: newItemText.trim() ? 'var(--eh-text-2)' : 'var(--eh-muted-2)',
                  background: 'none',
                  border: '1px solid var(--eh-border)',
                  borderRadius: 6,
                  padding: '5px 10px',
                  cursor: newItemText.trim() ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  flexShrink: 0,
                }}
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 20px',
            borderTop: '1px solid var(--eh-border)',
          }}
        >
          <button type="button" onClick={onClose} style={S.btn(false)}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={saving || !title.trim() || (recurrenceEnabled && recurrencePattern === 'custom-days' && recurrenceDays.length === 0)}
            style={S.btn(true, saving || !title.trim() || (recurrenceEnabled && recurrencePattern === 'custom-days' && recurrenceDays.length === 0))}
          >
            {saving ? 'Criando…' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  )
}
