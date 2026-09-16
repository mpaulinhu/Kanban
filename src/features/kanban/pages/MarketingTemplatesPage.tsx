import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRole } from '@/hooks/useRole'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { MarketingTaskTemplate } from '../types/pmOffice'
import {
  createMarketingTemplate,
  deleteMarketingTemplate,
  getOrCreateAreaProject,
  isMarketingTemplateSeedAttempted,
  migrateMarketingTemplatesCategorias,
  seedMarketingTemplatesIfNeeded,
  subscribeTemplates,
  subscribeMarketingBuckets,
  updateMarketingTemplate,
} from '../api/marketingPlannerApi'
import { usePmAudit } from '../hooks/usePmAudit'

// Seed gerenciado centralmente em marketingPlannerApi.ts

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
    color: primary ? '#fff' : 'var(--eh-text-2)',
    background: primary
      ? disabled ? 'var(--eh-muted-2)' : 'var(--eh-primary)'
      : 'var(--eh-bg)',
    border: primary ? 'none' : '1px solid var(--eh-border)',
    borderRadius: 8,
    padding: '8px 18px',
    cursor: disabled ? 'default' as const : 'pointer' as const,
    opacity: disabled ? 0.55 : 1,
    flexShrink: 0,
  }),
  dangerBtn: (): CSSProperties => ({
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 600 as const,
    color: 'var(--eh-danger)',
    background: 'transparent',
    border: '1px solid var(--eh-danger)',
    borderRadius: 7,
    padding: '5px 12px',
    cursor: 'pointer' as const,
  }),
}

// ── Chip de categoria ─────────────────────────────────────────────────────────

function CategoryChip({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick?: () => void
}) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-block',
        fontSize: 11.5,
        fontWeight: 600,
        padding: '2px 9px',
        borderRadius: 999,
        border: `1px solid ${selected ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
        background: selected ? 'var(--eh-primary)' : 'var(--eh-bg)',
        color: selected ? 'var(--eh-surface)' : 'var(--eh-text-2)',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none' as const,
      }}
    >
      {label}
    </span>
  )
}

// ── Seletor de categorias ─────────────────────────────────────────────────────

function CategorySelector({
  selected,
  onChange,
  knownCategories,
}: {
  selected: string[]
  onChange: (cats: string[]) => void
  knownCategories: string[]
}) {
  const [customText, setCustomText] = useState('')

  function toggleKnown(cat: string) {
    if (selected.includes(cat)) {
      onChange(selected.filter((c) => c !== cat))
    } else {
      onChange([...selected, cat])
    }
  }

  function addCustom() {
    const val = customText.trim()
    if (!val || selected.includes(val)) return
    onChange([...selected, val])
    setCustomText('')
  }

  // Categorias customizadas (não constam nos buckets do projeto)
  const customSelected = selected.filter((c) => !knownCategories.includes(c))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {knownCategories.map((cat) => (
          <CategoryChip
            key={cat}
            label={cat}
            selected={selected.includes(cat)}
            onClick={() => toggleKnown(cat)}
          />
        ))}
        {customSelected.map((cat) => (
          <span
            key={cat}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11.5,
              fontWeight: 600,
              padding: '2px 9px',
              borderRadius: 999,
              border: '1px solid var(--eh-primary)',
              background: 'var(--eh-primary)',
              color: 'var(--eh-surface)',
            }}
          >
            {cat}
            <button
              type="button"
              onClick={() => onChange(selected.filter((c) => c !== cat))}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--eh-surface)',
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
              }}
              aria-label={`Remover categoria ${cat}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          placeholder="Adicionar categoria personalizada..."
          style={{ ...S.input(), maxWidth: 280 }}
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customText.trim()}
          style={S.btn(false, !customText.trim())}
        >
          Adicionar
        </button>
      </div>
    </div>
  )
}

// ── Modal de confirmação ──────────────────────────────────────────────────────

function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmDanger,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  confirmDanger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.42)',
        backdropFilter: 'blur(3px)',
        zIndex: 400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--eh-surface)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 400,
          padding: '28px 28px 24px',
          boxShadow: '0 24px 64px rgba(15,23,42,0.2)',
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--eh-text)', margin: '0 0 8px' }}>
          {title}
        </p>
        <p
          style={{ fontSize: 13.5, color: 'var(--eh-text-3)', margin: '0 0 24px', lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{ __html: message }}
        />
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              flex: 1,
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 600,
              color: 'var(--eh-surface)',
              background: 'var(--eh-text-strong)',
              border: 'none',
              borderRadius: 9,
              padding: '11px 0',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex: 1,
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 600,
              color: confirmDanger ? 'var(--eh-danger)' : 'var(--eh-surface)',
              background: confirmDanger ? 'transparent' : 'var(--eh-primary)',
              border: confirmDanger ? '1.5px solid var(--eh-danger)' : 'none',
              borderRadius: 9,
              padding: '11px 0',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? 'Aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Card de template ──────────────────────────────────────────────────────────

interface TemplateCardProps {
  tpl: MarketingTaskTemplate
  expanded: boolean
  onToggle: () => void
  onSave: (updated: MarketingTaskTemplate) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Viewer só pode expandir/ler o template — sem editar nem remover. */
  readOnly?: boolean
  bucketNames: string[]
}

function TemplateCard({ tpl, expanded, onToggle, onSave, onDelete, readOnly = false, bucketNames }: TemplateCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<MarketingTaskTemplate>(tpl)
  const [checklistText, setChecklistText] = useState(tpl.checklist.join('\n'))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!expanded) setEditing(false)
  }, [expanded])

  useEffect(() => {
    setDraft(tpl)
    setChecklistText(tpl.checklist.join('\n'))
  }, [tpl])

  function startEdit() {
    setDraft(tpl)
    setChecklistText(tpl.checklist.join('\n'))
    setEditing(true)
  }

  function cancelEdit() {
    setDraft(tpl)
    setChecklistText(tpl.checklist.join('\n'))
    setEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    const checklist = checklistText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    await onSave({ ...draft, checklist })
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    setDeleting(true)
    await onDelete(tpl.id)
    setDeleting(false)
    setConfirmingDelete(false)
  }


  return (
    <div
      style={{
        border: '1px solid var(--eh-border)',
        borderRadius: 12,
        background: 'var(--eh-surface)',
        overflow: 'hidden',
      }}
    >
      {/* Cabeçalho do card */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '13px 16px',
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
            width: 7,
            height: 7,
            flexShrink: 0,
            borderRight: '1.7px solid var(--eh-text-2)',
            borderBottom: '1.7px solid var(--eh-text-2)',
            transform: `rotate(${expanded ? '45deg' : '-45deg'})`,
            transition: 'transform .15s',
            marginTop: expanded ? -3 : 1,
          }}
        />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--eh-text)' }}>
          {tpl.name}
        </span>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {tpl.categorias.map((cat) => (
            <CategoryChip key={cat} label={cat} selected={false} />
          ))}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: tpl.isDefault ? 'var(--eh-surface-2)' : 'var(--eh-primary)',
              color: tpl.isDefault ? 'var(--eh-text-3)' : 'var(--eh-surface)',
            }}
          >
            {tpl.isDefault ? 'Padrão' : 'Customizado'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--eh-text-3)', marginLeft: 4 }}>
            {tpl.checklist.length} item{tpl.checklist.length !== 1 ? 's' : ''}
          </span>
        </div>
      </button>

      {/* Conteúdo expandido */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--eh-border)', padding: 16 }}>
          {!editing ? (
            <>
              {/* Checklist */}
              <div
                style={{
                  border: '1px solid var(--eh-border)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  marginBottom: 14,
                }}
              >
                {tpl.checklist.length === 0 ? (
                  <div
                    style={{
                      padding: '8px 12px',
                      fontSize: 12.5,
                      color: 'var(--eh-muted-2)',
                    }}
                  >
                    Nenhum item de checklist.
                  </div>
                ) : (
                  tpl.checklist.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '6px 12px 6px 22px',
                        fontSize: 12.5,
                        color: 'var(--eh-text-2)',
                        borderTop: idx > 0 ? '1px solid var(--eh-border-child-row)' : 'none',
                        display: 'flex',
                        gap: 6,
                      }}
                    >
                      <span style={{ color: 'var(--eh-muted-2)', fontSize: 11 }}>{idx + 1}.</span>
                      {item}
                    </div>
                  ))
                )}
              </div>

              {!readOnly && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" onClick={startEdit} style={S.btn(true)}>
                    Editar
                  </button>
                  {!tpl.isDefault && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      style={S.dangerBtn()}
                      aria-label={`Remover template ${tpl.name}`}
                    >
                      Remover
                    </button>
                  )}
                </div>
              )}

              {confirmingDelete && (
                <ConfirmModal
                  title="Remover template?"
                  message={`O template <strong>"${tpl.name}"</strong> será removido permanentemente.`}
                  confirmLabel="Remover"
                  confirmDanger
                  loading={deleting}
                  onConfirm={handleDelete}
                  onCancel={() => setConfirmingDelete(false)}
                />
              )}
            </>
          ) : (
            /* Modo edição */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Nome */}
              <div>
                <label style={S.label}>Nome</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  style={S.input()}
                />
              </div>

              {/* Categorias */}
              <div>
                <label style={S.label}>Categorias</label>
                <CategorySelector
                  selected={draft.categorias}
                  onChange={(cats) => setDraft((d) => ({ ...d, categorias: cats }))}
                  knownCategories={bucketNames}
                />
              </div>

              {/* Checklist */}
              <div>
                <label style={S.label}>Itens de checklist (um por linha)</label>
                <textarea
                  rows={Math.max(4, checklistText.split('\n').length + 1)}
                  value={checklistText}
                  onChange={(e) => setChecklistText(e.target.value)}
                  placeholder={'Item A\nItem B\nItem C'}
                  style={{
                    ...S.input(),
                    resize: 'vertical' as const,
                    padding: '8px 12px',
                    lineHeight: 1.6,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  style={S.btn(true, saving)}
                >
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>
                <button type="button" onClick={cancelEdit} style={S.btn(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Modal de criação de novo template ─────────────────────────────────────────

interface NewTemplateModalProps {
  onClose: () => void
  onCreate: (tpl: Omit<MarketingTaskTemplate, 'id'>) => Promise<void>
  bucketNames: string[]
}

function NewTemplateModal({ onClose, onCreate, bucketNames }: NewTemplateModalProps) {
  const [name, setName] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [checklistText, setChecklistText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (!trimmedName) { setError('Nome é obrigatório.'); return }
    if (categorias.length === 0) { setError('Selecione ao menos uma categoria.'); return }

    const checklist = checklistText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    setSaving(true)
    try {
      await onCreate({ name: trimmedName, categorias, checklist, isDefault: false })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar template.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.42)',
        backdropFilter: 'blur(3px)',
        zIndex: 300,
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
          maxWidth: 580,
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
            padding: '18px 22px',
            borderBottom: '1px solid var(--eh-border)',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--eh-text)' }}>
            Novo template
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            style={{
              width: 30,
              height: 30,
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
              width="14"
              height="14"
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

        {/* Formulário */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div>
            <label style={S.label} htmlFor="new-tpl-name">
              Nome
            </label>
            <input
              id="new-tpl-name"
              ref={nameRef}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Lançamento especial"
              style={S.input()}
            />
          </div>

          <div>
            <label style={S.label}>Categorias</label>
            <CategorySelector selected={categorias} onChange={setCategorias} knownCategories={bucketNames} />
          </div>

          <div>
            <label style={S.label} htmlFor="new-tpl-checklist">
              Itens de checklist{' '}
              <span style={{ fontWeight: 400, textTransform: 'none' }}>(um por linha)</span>
            </label>
            <textarea
              id="new-tpl-checklist"
              rows={5}
              value={checklistText}
              onChange={(e) => setChecklistText(e.target.value)}
              placeholder={'Item A\nItem B\nItem C'}
              style={{
                ...S.input(),
                resize: 'vertical' as const,
                padding: '8px 12px',
                lineHeight: 1.6,
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 8,
                background: 'var(--eh-danger-bg)',
                color: 'var(--eh-danger)',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}
        </form>

        {/* Rodapé */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '14px 22px',
            borderTop: '1px solid var(--eh-border)',
          }}
        >
          <button type="button" onClick={onClose} style={S.btn(false)}>
            Cancelar
          </button>
          <button
            type="submit"
            form=""
            onClick={(e) => void handleSubmit(e as unknown as React.FormEvent)}
            disabled={saving || !name.trim() || categorias.length === 0}
            style={S.btn(true, saving || !name.trim() || categorias.length === 0)}
          >
            {saving ? 'Criando…' : 'Criar template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente de navegação ───────────────────────────────────────────────────

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 18px',
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 500,
        border: `1px solid ${active ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
        background: active ? 'var(--eh-primary)' : 'var(--eh-surface)',
        color: active ? '#fff' : 'var(--eh-text-3)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

/**
 * Base de rota e título default por área (
 *). `area` default `'marketing'` preserva o comportamento desta
 * tela para quem já a usa — Administrativo/Pedagogia passam
 * `area="administrativo"`/`area="pedagogia"` via router.
 */
const NAV_BASE: Record<'marketing' | 'administrativo' | 'pedagogia', string> = {
  marketing: '/pm-office-marketing',
  administrativo: '/pm-office-administrativo',
  pedagogia: '',
}
const DEFAULT_TITLE: Record<'marketing' | 'administrativo' | 'pedagogia', string> = {
  marketing: 'Daily Marketing',
  administrativo: 'Administrativo',
  pedagogia: 'Pedagogia',
}
const RESOURCE_BY_AREA: Record<'marketing' | 'administrativo' | 'pedagogia', 'pm-marketing' | 'pm-administrativo' | 'pm-pedagogia'> = {
  marketing: 'pm-marketing',
  administrativo: 'pm-administrativo',
  pedagogia: 'pm-pedagogia',
}

export function MarketingTemplatesPage({ area = 'pedagogia' }: { area?: 'marketing' | 'administrativo' | 'pedagogia' } = {}) {
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const navBase = NAV_BASE[area]
  // Audit log das acoes humanas desta tela. Template nao
  // pertence a um projeto — `projectId` vazio o mantem fora do filtro
  // por projeto, mas visivel no filtro por area.
  const audit = usePmAudit(area, null, '')
  const { roleLevel, canWriteScreen } = useRole()
  // Viewer só pode ler templates — sem criar, editar ou remover.
  // Exceção por tela precisa afetar a escrita, não só a visibilidade.
  const canWrite = canWriteScreen()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectTitle, setProjectTitle] = useState(DEFAULT_TITLE[area])
  const [bucketNames, setBucketNames] = useState<string[]>([])
  const [templates, setTemplates] = useState<MarketingTaskTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  useEffect(() => {
    // Para 'marketing' resolve exatamente como antes (via
    // `getMarketingProject` dentro de `getOrCreateAreaProject`); para
    // 'administrativo' cria o projeto singleton na 1ª visita (idempotente).
    void getOrCreateAreaProject(area).then((proj) => {
      setProjectId(proj.id)
      if (proj.title) setProjectTitle(proj.title)
    })
  }, [area])

  // Carrega buckets do projeto para popular as opções de categoria dinamicamente
  useEffect(() => {
    if (!projectId) return
    const unsub = subscribeMarketingBuckets(projectId, (buckets) => {
      setBucketNames(buckets.map((b) => b.name))
    })
    return unsub
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeTemplates((loaded) => {
      // Seed automático e migração de categoria legada são conteúdo
      // específico de Marketing — Administrativo nasce sem templates.
      if (area === 'marketing') {
        // Se coleção vazia e seed ainda não foi tentado, aguarda seed + próximo snapshot
        if (loaded.length === 0 && !isMarketingTemplateSeedAttempted()) {
          void seedMarketingTemplatesIfNeeded([])
          return
        }
        // Migra templates legados com categorias erradas (roda uma vez por sessão)
        void migrateMarketingTemplatesCategorias(loaded)
      }
      setTemplates(loaded)
      setLoading(false)
      setError(null)
    })
    return unsub
  }, [area])

  async function handleSave(updated: MarketingTaskTemplate) {
    const { id, ...data } = updated
    await updateMarketingTemplate(id, data)
    audit.logTemplate('pm_template.update', { id, name: updated.name })
  }

  async function handleDelete(id: string) {
    const removed = templates.find((t) => t.id === id)
    await deleteMarketingTemplate(id)
    audit.logTemplate('pm_template.delete', { id, name: removed?.name })
    if (expandedId === id) setExpandedId(null)
  }

  async function handleCreate(data: Omit<MarketingTaskTemplate, 'id'>) {
    await createMarketingTemplate(data)
    audit.logTemplate('pm_template.create', { id: data.name, name: data.name })
  }

  const defaultTemplates = templates.filter((t) => t.isDefault)
  const customTemplates = templates.filter((t) => !t.isDefault)

  const canSeeTemplates = true

  const pageStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: 'var(--eh-bg)',
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: isMobile ? 'stretch' : 'center',
    flexDirection: isMobile ? 'column' : 'row',
    justifyContent: 'space-between',
    padding: isMobile ? '12px 12px 10px' : '16px 24px 12px',
    background: 'var(--eh-surface)',
    borderBottom: '1px solid var(--eh-border)',
    flexShrink: 0,
    gap: isMobile ? 10 : 16,
  }

  return (
    <div style={pageStyle}>
      {/* HEADER — idêntico ao Quadro, sem campo de busca */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--eh-text-strong)' }}>
            {projectTitle}
          </h1>
        </div>
        {/* Sem overflowX aqui, as 4 abas empurravam a largura da página inteira
            e criavam scroll horizontal global (mesmo tratamento do Calendário). */}
        <div style={{ display: 'flex', gap: 4, overflowX: isMobile ? 'auto' : undefined, paddingBottom: isMobile ? 2 : undefined }}>
          <NavButton label="Quadro" active={false} onClick={() => navigate(`${navBase}/quadro`)} />
          <NavButton label="Calendário" active={false} onClick={() => navigate(`${navBase}/calendario`)} />
          {canSeeTemplates && (
            <NavButton label="Templates" active={true} onClick={() => undefined} />
          )}
        </div>
      </div>

      {/* Área scrollável — full-width para barra na borda da tela */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '28px clamp(14px,4vw,32px)', maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' as const }}>
        {/* Cabeçalho da seção */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--eh-text)',
                letterSpacing: '-0.02em',
                margin: 0,
              }}
            >
              Templates de checklist
            </h1>
            <p
              style={{
                fontSize: 13.5,
                color: 'var(--eh-text-2)',
                margin: '5px 0 0',
              }}
            >
              Gerencie os templates de checklist usados ao criar tarefas e ao aplicar num card existente.
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13.5,
                fontWeight: 600,
                color: '#fff',
                background: 'var(--eh-primary)',
                border: 'none',
                borderRadius: 9,
                padding: '10px 18px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <svg
                viewBox="0 0 12 12"
                width="11"
                height="11"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
              Novo template
            </button>
          )}
        </div>

      {/* Estado de carregamento */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 200,
            color: 'var(--eh-muted-2)',
            fontSize: 13.5,
          }}
        >
          Carregando templates…
        </div>
      )}

      {/* Estado de erro */}
      {!loading && error && (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 10,
            background: 'var(--eh-danger-bg)',
            color: 'var(--eh-danger)',
            fontSize: 13.5,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}

      {/* Lista de templates */}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.length === 0 && (
            <div
              style={{
                padding: '48px 0',
                textAlign: 'center',
                color: 'var(--eh-muted-2)',
                fontSize: 13.5,
              }}
            >
              Nenhum template encontrado.
            </div>
          )}

          {defaultTemplates.length > 0 && (
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--eh-muted-2)',
                padding: '4px 0 6px',
              }}
            >
              Padrão
            </div>
          )}

          {defaultTemplates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              expanded={expandedId === tpl.id}
              onToggle={() => setExpandedId((id) => (id === tpl.id ? null : tpl.id))}
              onSave={handleSave}
              onDelete={handleDelete}
              readOnly={!canWrite}
              bucketNames={bucketNames}
            />
          ))}

          {customTemplates.length > 0 && (
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--eh-muted-2)',
                padding: '12px 0 6px',
              }}
            >
              Customizado
            </div>
          )}

          {customTemplates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              expanded={expandedId === tpl.id}
              onToggle={() => setExpandedId((id) => (id === tpl.id ? null : tpl.id))}
              onSave={handleSave}
              onDelete={handleDelete}
              readOnly={!canWrite}
              bucketNames={bucketNames}
            />
          ))}
        </div>
      )}

      {/* Modal de criação */}
      {showNewModal && (
        <NewTemplateModal
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreate}
          bucketNames={bucketNames}
        />
      )}
      </div>
      </div>
    </div>
  )
}
