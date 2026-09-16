import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChecklistItem, MarketingTaskTemplate } from '../types/pmOffice'
import { subscribeTemplates } from '../api/marketingPlannerApi'
import { ConfirmDialog } from '@/components/ConfirmDialog'

// Mesma normalização de `NewMarketingTaskModal.tsx` (`normalizeBucketName`) —
// trata variantes Unicode de hífen/espaço que apareceriam como "categoria
// diferente" numa comparação ingênua de string.
function normalizeBucketName(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[­‐‑‒–—―−﹘﹣－]/g, '-')
    .replace(/[               　]/g, ' ')
    .trim()
}

type ChecklistStatus = NonNullable<ChecklistItem['status']>

const STATUS_META: Record<ChecklistStatus, { label: string; fg: string; bg: string }> = {
  aguardando:  { label: 'Aguardando',  fg: 'var(--eh-danger)',     bg: 'var(--eh-danger-bg)'  },
  em_producao: { label: 'Em produção', fg: 'var(--eh-warn-fg)',    bg: 'var(--eh-warn-bg)'    },
  revisao:     { label: 'Revisão',     fg: 'var(--eh-primary)',    bg: 'var(--eh-bar-track)'  },
  refazer:     { label: 'Refazer',     fg: 'var(--eh-muted-2)',    bg: 'var(--eh-surface-2)'  },
  finalizado:  { label: 'Finalizado',  fg: 'var(--eh-success-fg)', bg: 'var(--eh-success-bg)' },
}

const STATUS_ORDER: ChecklistStatus[] = ['aguardando', 'em_producao', 'revisao', 'refazer', 'finalizado']

function resolveStatus(item: ChecklistItem): ChecklistStatus {
  if (item.status) return item.status
  return item.isChecked ? 'finalizado' : 'aguardando'
}

/**
 * Subtarefas de uma tarefa (checklist) — extraído do bloco que já existia no
 * modo formulário clássico de `TaskDetailModal.tsx` (`task.source === 'graph'`),
 * que a Pedagogia nunca usa. Reaproveitado aqui, sem duplicar, para o modo
 * documento (`PedagogiaDocumentBody.tsx`) também poder criar/editar/
 * mudar status/excluir subtarefa — antes só dava pra VER o resumo
 * no card do quadro, não mexer de dentro do modal.
 */
export function ChecklistSection({
  items,
  isEditable,
  onToggleItem,
  onUpdateItemStatus,
  onAddItem,
  onRenameItem,
  onDeleteItem,
  focusInputSignal,
  bucketName,
  onApplyTemplate,
}: {
  items: ChecklistItem[]
  isEditable: boolean
  onToggleItem?: (itemId: string, checked: boolean) => Promise<void>
  onUpdateItemStatus?: (itemId: string, status: ChecklistStatus) => Promise<void>
  onAddItem?: (title: string) => Promise<void>
  onRenameItem?: (itemId: string, newTitle: string) => Promise<void>
  onDeleteItem?: (itemId: string) => Promise<void>
  /**
   * Foca o campo "Novo item" quando este valor MUDA — contador incrementado
   * a cada clique no botão "Checklist" do pai, não um boolean (dois cliques
   * seguidos precisam focar duas vezes, mesmo sem o usuário ter digitado
   * nada na primeira). `undefined`/sem mudança = não foca sozinho.
   */
  focusInputSignal?: number
  /**
   * "Aplicar template" — os dois abaixo precisam estar presentes juntos para
   * a ação aparecer. `bucketName` resolve QUAIS templates mostrar: só os que
   * listam a coluna atual da tarefa em `categorias[]`. `onApplyTemplate` é
   * quem grava, ADICIONANDO ao checklist existente em vez de substituí-lo.
   */
  bucketName?: string
  onApplyTemplate?: (template: MarketingTaskTemplate) => Promise<void>
}) {
  const [newTitle, setNewTitle] = useState('')
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteItemError, setDeleteItemError] = useState<string | null>(null)
  const newItemInputRef = useRef<HTMLInputElement>(null)

  const [availableTemplates, setAvailableTemplates] = useState<MarketingTaskTemplate[]>([])
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null)
  const [applyTemplateError, setApplyTemplateError] = useState<string | null>(null)
  const templateBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!bucketName || !onApplyTemplate) { setAvailableTemplates([]); return }
    const unsub = subscribeTemplates((all) => {
      setAvailableTemplates(
        all.filter((t) => t.categorias.some((cat) => normalizeBucketName(cat) === normalizeBucketName(bucketName))),
      )
    })
    return unsub
  }, [bucketName, onApplyTemplate])

  useEffect(() => {
    if (!openDropdownId) return
    function onOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-checklist-dropdown]')) return
      setOpenDropdownId(null)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [openDropdownId])

  useEffect(() => {
    if (!templatePickerOpen) return
    function onOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-template-picker]')) return
      setTemplatePickerOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [templatePickerOpen])

  // Pílula "Checklist" do modo documento pede pra focar o campo direto, não
  // só rolar até a seção — mesmo raciocínio do `openPickerSignal` em
  // TaskAttachments.tsx (ver comentário lá, com o bug real que motivou essa
  // guarda). Comparar contra o VALOR inicial (não "é a primeira execução do
  // efeito") — StrictMode roda este efeito 2x na montagem com o mesmo
  // `focusInputSignal`, e uma guarda de "primeira vez" falha na segunda
  // chamada e foca o campo sozinho ao abrir a tarefa.
  const initialFocusSignal = useRef(focusInputSignal)
  useEffect(() => {
    if (focusInputSignal === initialFocusSignal.current) return
    if (!isEditable) return
    newItemInputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusInputSignal])

  const done = items.filter((i) => resolveStatus(i) === 'finalizado').length

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
        Checklist
        {items.length > 0 && (
          <span className="font-normal normal-case ml-1" style={{ color: 'var(--eh-muted-2)' }}>
            ({done}/{items.length})
          </span>
        )}
      </p>
      <div className="space-y-1 mb-2">
        {items.map((item) => {
          const currentStatus = resolveStatus(item)
          const meta = STATUS_META[currentStatus]
          const isDropdownOpen = openDropdownId === item.id
          return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, position: 'relative' }} data-checklist-dropdown="">
              <button
                type="button"
                disabled={!isEditable}
                onClick={(e) => {
                  if (!isEditable) return
                  if (!isDropdownOpen) {
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                    setDropdownPos({ top: rect.bottom + 2, left: rect.left })
                  }
                  setOpenDropdownId(isDropdownOpen ? null : item.id)
                }}
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 600,
                  color: meta.fg,
                  background: meta.bg,
                  padding: '2px 7px',
                  borderRadius: 20,
                  border: 'none',
                  cursor: isEditable ? 'pointer' : 'default',
                  lineHeight: 1.5,
                  whiteSpace: 'nowrap',
                  marginTop: 2,
                }}
              >
                {meta.label}
              </button>
              {editingItemId === item.id ? (
                <input
                  type="text"
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={async () => {
                    const trimmed = editingTitle.trim()
                    if (trimmed && trimmed !== item.title) await onRenameItem?.(item.id, trimmed)
                    setEditingItemId(null)
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const trimmed = editingTitle.trim()
                      if (trimmed && trimmed !== item.title) await onRenameItem?.(item.id, trimmed)
                      setEditingItemId(null)
                    } else if (e.key === 'Escape') {
                      setEditingItemId(null)
                    }
                  }}
                  className="flex-1 text-sm rounded border border-input bg-background px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <>
                  <span className={currentStatus === 'finalizado' ? 'text-sm line-through text-muted-foreground' : 'text-sm'} style={{ color: 'var(--eh-pm-modal-text)' }}>
                    {item.title}
                  </span>
                  {isEditable && onRenameItem && (
                    <button
                      type="button"
                      title="Renomear subtarefa"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingItemId(item.id)
                        setEditingTitle(item.title)
                      }}
                      style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--eh-muted-2)', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
                      aria-label="Renomear subtarefa"
                    >
                      {/* Mesmo ícone de lápis já usado em LabelPickerPopover.tsx (editar
                          etiqueta) — trocado do emoji ✏️ pra ficar consistente com o
                          resto do app, em vez de dois estilos de "editar" convivendo. */}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                  )}
                  {isEditable && onDeleteItem && (
                    <button
                      type="button"
                      title="Excluir subtarefa"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingItemId(item.id)
                      }}
                      style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'var(--eh-muted-2)', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
                      aria-label="Excluir subtarefa"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  )}
                </>
              )}
              {isDropdownOpen && createPortal(
                <div
                  style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 200, background: 'var(--eh-surface)', border: '1px solid var(--eh-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: 4, minWidth: 120 }}
                  data-checklist-dropdown=""
                >
                  {STATUS_ORDER.map((s) => {
                    const m = STATUS_META[s]
                    const isActive = currentStatus === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={async () => {
                          setOpenDropdownId(null)
                          if (onUpdateItemStatus) {
                            await onUpdateItemStatus(item.id, s)
                          } else {
                            await onToggleItem?.(item.id, s === 'finalizado')
                          }
                        }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 11, fontWeight: isActive ? 700 : 500, color: m.fg, background: isActive ? m.bg : 'transparent', padding: '4px 8px', borderRadius: 5, border: 'none', cursor: 'pointer' }}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>,
                document.body,
              )}
            </div>
          )
        })}
      </div>
      {isEditable && onApplyTemplate && availableTemplates.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 8 }} data-template-picker="">
          <button
            ref={templateBtnRef}
            type="button"
            onClick={() => setTemplatePickerOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={templatePickerOpen}
            className="inline-flex items-center gap-1.5"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--eh-primary)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Aplicar template
          </button>
          {templatePickerOpen && (
            <div
              role="dialog"
              aria-label="Escolher template de checklist"
              className="absolute z-20 mt-1"
              style={{ background: 'var(--eh-surface)', border: '1px solid var(--eh-border)', borderRadius: 8, boxShadow: 'var(--eh-shadow-menu)', minWidth: 220, maxWidth: 320, padding: 4 }}
            >
              {availableTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  disabled={applyingTemplateId !== null}
                  onClick={async () => {
                    setApplyingTemplateId(tpl.id)
                    setApplyTemplateError(null)
                    try {
                      await onApplyTemplate(tpl)
                      setTemplatePickerOpen(false)
                    } catch (err) {
                      console.error('[checklist] Falha ao aplicar template', err)
                      setApplyTemplateError('Não foi possível aplicar o template. Tente novamente.')
                    } finally {
                      setApplyingTemplateId(null)
                    }
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'transparent', cursor: applyingTemplateId ? 'default' : 'pointer', opacity: applyingTemplateId && applyingTemplateId !== tpl.id ? 0.5 : 1 }}
                  onMouseEnter={(e) => { if (!applyingTemplateId) e.currentTarget.style.background = 'var(--eh-surface-2)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--eh-text-strong)' }}>
                    {applyingTemplateId === tpl.id ? 'Aplicando…' : tpl.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--eh-text-2)', marginTop: 1 }}>
                    {tpl.checklist.length} item{tpl.checklist.length !== 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {applyTemplateError && (
            <p role="alert" className="text-xs mt-1" style={{ color: 'var(--eh-danger)' }}>{applyTemplateError}</p>
          )}
        </div>
      )}
      {isEditable && onAddItem && (
        <input
          ref={newItemInputRef}
          type="text"
          placeholder="Novo item... (Enter para adicionar)"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              const t = newTitle.trim()
              if (t) { await onAddItem(t); setNewTitle('') }
            }
          }}
          className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
      {deletingItemId !== null && (
        <ConfirmDialog
          title="Excluir subtarefa?"
          message={`"${items.find((i) => i.id === deletingItemId)?.title ?? ''}" será removida permanentemente da tarefa.`}
          confirmLabel="Excluir subtarefa"
          confirmBusyLabel="Excluindo…"
          variant="danger"
          loading={deleteLoading}
          error={deleteItemError}
          onCancel={() => { setDeletingItemId(null); setDeleteItemError(null) }}
          onConfirm={async () => {
            if (!onDeleteItem) return
            setDeleteLoading(true)
            setDeleteItemError(null)
            try {
              await onDeleteItem(deletingItemId)
              setDeletingItemId(null)
            } catch (err) {
              console.error('[checklist] Falha ao excluir subtarefa', { itemId: deletingItemId, err })
              setDeleteItemError('Não foi possível excluir a subtarefa. Tente novamente.')
            } finally {
              setDeleteLoading(false)
            }
          }}
        />
      )}
    </div>
  )
}
