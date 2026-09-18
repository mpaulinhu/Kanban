import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { InlineDateCellPopup } from './InlineDateCellPopup'
import type { ChecklistItem, MarketingTaskTemplate, PMOfficeLabel, PMTask, RecurrenceConfig } from '../types/pmOffice'
import { RecurrenceControl } from './RecurrenceControl'
import type { PMTaskPatch } from '../api/pmOfficeApi'
import { applyLazyOverdueTransition, updatePMTask } from '../api/pmOfficeApi'
import { tsFromDate, type Timestamp } from '../api/store'
import { applyTemplateToTaskChecklist, markTaskDone } from '../api/marketingPlannerApi'
import { onlyInternalUsers } from '@/lib/internalDomains'
import type { UserRecord } from '../api/usersApi'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PM_STATUS_CFG } from '../utils'
import { UserAvatar } from '@/components/UserAvatar/UserAvatar'
import { InlineEditableText } from './InlineEditableText'
import { PedagogiaDocumentBody } from './PedagogiaDocumentBody'
import { ChecklistSection } from './ChecklistSection'
import { TaskComments } from './TaskComments'
import { useMediaQuery } from '@/hooks/useMediaQuery'

/** Resolve a foto do usuário por nome exato (case-insensitive), só quando único — ambíguo não resolve. */
function findPhotoByName(name: string, users: UserRecord[]): string | undefined {
  const target = name.trim().toLowerCase()
  const matches = users.filter((u) => u.name.trim().toLowerCase() === target)
  return matches.length === 1 ? matches[0].photoURL : undefined
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  const secs = (ts as { seconds: number }).seconds
  return typeof secs === 'number' ? new Date(secs * 1000) : null
}

export function dateToTs(d: Date | null): Timestamp | null {
  if (!d) return null
  return tsFromDate(d)
}

/**
 * Cores do chip de status do CABEÇALHO do modal — deliberadamente separadas
 * de `PM_STATUS_CFG` (utils/index.ts), que é usado em vários outros lugares
 * do app (barra de progresso, ponto de status do card) com `in_progress` em
 * azul. Trocar `PM_STATUS_CFG` para laranja mudaria essas outras telas junto;
 * este mapa vale só para o chip, então o laranja pedido para "Em andamento"
 * fica isolado aqui sem efeito colateral em nenhum outro componente.
 *
 * Também cobre `atrasado`, que `PM_STATUS_CFG` não tem (o chip do card caía
 * no fallback `todo` e sobrescrevia só a cor do texto para vermelho,
 * deixando o fundo cinza — inconsistente com as outras três opções, que têm
 * fundo E texto no mesmo tom).
 */
const STATUS_CHIP_CFG: Record<PMTask['status'], { bg: string; fg: string; dot: string }> = {
  todo:        { bg: 'var(--eh-surface-2)',                                    fg: 'var(--eh-text-2)', dot: 'var(--eh-muted-2)' },
  in_progress: { bg: 'color-mix(in srgb, #f97316 16%, transparent)',           fg: '#c2410c',           dot: '#f97316' },
  done:        { bg: 'color-mix(in srgb, #22a35a 14%, transparent)',           fg: '#15803d',           dot: '#22a35a' },
  atrasado:    { bg: 'color-mix(in srgb, #ef4444 14%, transparent)',           fg: '#b91c1c',           dot: '#ef4444' },
}

const STATUS_OPTIONS: { value: PMTask['status']; label: string }[] = [
  { value: 'todo', label: 'A fazer' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'done', label: 'Concluída' },
  // Trocável manualmente a qualquer momento, igual aos outros 3 —
  // a escolha manual não é revertida sozinha depois (só a transição
  // AUTOMÁTICA/lazy tem reversão simétrica, ver `applyLazyOverdueTransition`).
  { value: 'atrasado', label: 'Atrasado' },
]

/** Listas granulares de status por subtarefa de acessibilidade (vocabulário da planilha) */
export const ACCESSIBILITY_RAW_OPTIONS: Record<string, string[]> = {
  'Áudio Descrição': [
    'Fazer AD',
    'Produzindo roteiro',
    'Aguardando Produção IA',
    'Produzindo voz IA',
    'Editando',
    'Finalizado',
  ],
  'Libras': [
    'Aguardando Produção de IA',
    'Produzindo voz IA',
    'Editando áudio/vídeo',
    'Liberado Libras',
    'Estudando Libras',
    'Liberado Gravação',
    'Gravando Libras',
    'Libras gravado',
    'Finalizado',
  ],
  'Site': ['Aguardando', 'Finalizado'],
}

function rawToStandard(raw: string, title: string): PMTask['status'] {
  if (raw === 'Finalizado') return 'done'
  if (title === 'Áudio Descrição' && raw === 'Fazer AD') return 'todo'
  if (title === 'Libras' && raw === 'Aguardando Produção de IA') return 'todo'
  if (title === 'Site' && raw === 'Aguardando') return 'todo'
  return 'in_progress'
}

function radioNovelaRawToStandard(raw: string): PMTask['status'] {
  if (raw === 'Publicado') return 'done'
  if (raw === 'Aguardando') return 'todo'
  return 'in_progress'
}

const STATUS_OPTIONS_BY_TITLE: Record<string, { value: PMTask['status']; label: string }[]> = {
  'Áudio Descrição': [
    { value: 'todo', label: 'Fazer AD' },
    { value: 'in_progress', label: 'Em andamento' },
    { value: 'done', label: 'Finalizado' },
  ],
  'Libras': [
    { value: 'todo', label: 'Aguardando produção de IA' },
    { value: 'in_progress', label: 'Em andamento' },
    { value: 'done', label: 'Finalizado' },
  ],
  'Site': [
    { value: 'todo', label: 'Aguardando' },
    { value: 'done', label: 'Finalizado' },
  ],
}

type ChecklistStatus = NonNullable<ChecklistItem['status']>

const STATUS_LABEL: Record<string, string> = {
  done: 'Concluída', in_progress: 'Em andamento', todo: 'A fazer', atrasado: 'Atrasado',
}

// Botão de fechar do header — padrão enterprise (mesmo visual do CategoryFormDialog)
function ModalCloseBtn({ onClick }: { onClick: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Fechar modal"
      style={{
        width: 30, height: 30, borderRadius: 8,
        border: 'none',
        background: hov ? 'var(--eh-border)' : 'var(--eh-surface-2)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background .12s', flexShrink: 0,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="var(--eh-text-2)" strokeWidth="1.8" strokeLinecap="round">
        <line x1="10" y1="2" x2="2" y2="10" /><line x1="2" y1="2" x2="10" y2="10" />
      </svg>
    </button>
  )
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm">{value || '—'}</p>
    </div>
  )
}

/**
 * Pílula de ação do modo "documento" —
 * usada em `PedagogiaDocumentBody.tsx` (modo "documento" da Pedagogia,
 * importado de lá) e exportada daqui para não duplicar o componente. Só
 * para seções que JÁ existem no corpo (rola até lá) — nunca renderizada
 * para algo sem seção correspondente.
 */
export function ActionPill({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 transition-colors"
      // Correção de contraste: --eh-text-2 media 4,36:1 sobre
      // --eh-pm-neutral-surface — abaixo do piso AA (4,5:1). Usa
      // --eh-pm-modal-text, que mede 12,80:1.
      style={{
        background: 'var(--eh-pm-neutral-surface)',
        color: 'var(--eh-pm-modal-text)',
        border: 'none',
        borderRadius: 4,
        padding: '6px 12px',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-border)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--eh-pm-neutral-surface)' }}
    >
      {icon}
      {label}
    </button>
  )
}

/* ─── contagens de tamanho (páginas / caracteres) ──────────────────
   A validação destes dois campos vive aqui, em funções puras, porque o
   restante do modal valida imperativamente via `canSave`. */

/** Aceita apenas inteiro ≥ 0. Rejeita decimal, negativo e texto. */
function isContagemValida(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed === '') return false
  // `Number` em vez de `parseInt`: parseInt('12abc') devolve 12 silenciosamente.
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 0
}

/**
 * String do input → valor a gravar. Campo vazio ou inválido vira `null` (limpa
 * o dado), nunca `NaN` ou `0` — "sem contagem" não é o mesmo que "zero
 * páginas", e a distinção importa para o aviso de "ainda não preenchido".
 */
function parseContagem(raw: string): number | null {
  return isContagemValida(raw) ? Number(raw.trim()) : null
}

// Posicionamento, scroll tracking, data inicial correta, dia em evidência,
// input dd/mm/aaaa e navegação por ano delegados ao InlineDateCellPopup compartilhado.
// Props disabledBefore/disabledAfter repassadas ao InlineDateCellPopup.
export function ModalDatePicker({ label, value, onChange, scrollContainer, disabledBefore, disabledAfter }: {
  label: string
  value: Date | null
  onChange: (d: Date | null) => void
  scrollContainer?: HTMLElement | null
  /** Desabilita dias anteriores a esta data. */
  disabledBefore?: Date
  /** Desabilita dias posteriores a esta data. */
  disabledAfter?: Date
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="flex gap-1">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm text-left hover:bg-accent/40 transition-colors"
        >
          {value ? value.toLocaleDateString('pt-BR') : '—'}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Limpar data"
            className="h-9 w-9 shrink-0 rounded-md border border-input bg-background text-muted-foreground hover:bg-accent/40 transition-colors text-base flex items-center justify-center"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <InlineDateCellPopup
          anchorRef={btnRef}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          zIndex={200}
          scrollContainer={scrollContainer}
          disabledBefore={disabledBefore}
          disabledAfter={disabledAfter}
        />
      )}
    </div>
  )
}

export function AssigneeSelect({ users, assignees, assigneesNames, onChange }: {
  users: UserRecord[]
  assignees: string[]
  assigneesNames: string[]
  onChange: (uids: string[], names: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  // Candidatos a responsável = só equipe interna. Filtro aqui e não
  // no `users` do modal: o mesmo array alimenta `findPhotoByName` (avatar de
  // quem JÁ está atribuído), que precisa continuar enxergando todo mundo.
  const selectableUsers = onlyInternalUsers(users)
  const filtered = query.trim()
    ? selectableUsers.filter(u =>
        u.name.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase()),
      )
    : selectableUsers

  const showList = focused && filtered.length > 0

  function toggle(uid: string, name: string) {
    // já selecionado por UID
    const uidIdx = assignees.indexOf(uid)
    if (uidIdx !== -1) {
      onChange(assignees.filter((_, i) => i !== uidIdx), assigneesNames.filter((_, i) => i !== uidIdx))
      return
    }
    // já presente como nome-só (sem UID correspondente naquela posição)
    const nameOnlyIdx = assigneesNames.findIndex((n, i) => n === name && !assignees[i])
    if (nameOnlyIdx !== -1) {
      onChange(assignees.filter((_, i) => i !== nameOnlyIdx), assigneesNames.filter((_, i) => i !== nameOnlyIdx))
      return
    }
    onChange([...assignees, uid], [...assigneesNames, name])
  }

  function removeAtIndex(i: number) {
    onChange(
      assignees.filter((_, j) => j !== i),
      assigneesNames.filter((_, j) => j !== i),
    )
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1">Atribuídos</label>
      {assigneesNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {assigneesNames.map((name, i) => (
            <span
              key={assignees[i] ?? `name-${i}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full pl-1 pr-2 py-1"
              style={{ background: 'var(--eh-surface-2)', color: 'var(--eh-text)' }}
            >
              <UserAvatar name={name} photoURL={findPhotoByName(name, users)} size={20} />
              {name}
              <button
                type="button"
                onClick={() => removeAtIndex(i)}
                aria-label={`Remover ${name}`}
                className="leading-none"
                style={{ color: 'var(--eh-text-2)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--eh-text)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--eh-text-2)' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder="Buscar usuário..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') { setFocused(false); setQuery('') } }}
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {showList && (
        <div className="mt-1 rounded-md border border-input max-h-40 overflow-y-auto p-1 space-y-0.5">
          {filtered.map(u => (
            <label key={u.uid} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/40 rounded px-1.5 py-1">
              <input
                type="checkbox"
                checked={assignees.includes(u.uid) || assigneesNames.some((n, i) => n === u.name && !assignees[i])}
                onChange={() => toggle(u.uid, u.name)}
              />
              <UserAvatar name={u.name} photoURL={u.photoURL} size={22} />
              <span className="truncate">{u.name}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-auto">{u.email}</span>
            </label>
          ))}
        </div>
      )}
      {focused && query.trim() !== '' && filtered.length === 0 && (
        <div className="mt-1 rounded-md border border-input p-1">
          <button
            type="button"
            onClick={() => {
              const name = query.trim()
              if (name && !assigneesNames.includes(name)) {
                onChange(assignees, [...assigneesNames, name])
              }
              setQuery('')
            }}
            className="w-full text-left text-sm px-1 py-0.5 hover:bg-accent/40 rounded text-muted-foreground"
          >
            Adicionar &quot;{query.trim()}&quot; como atribuído
          </button>
        </div>
      )}
    </div>
  )
}

export function TaskDetailModal({
  task,
  open,
  users = [],
  rawStatusOptions,
  showRecurrence = false,
  readOnly = false,
  requireDueDate = false,
  duracao,
  onDuracaoSave,
  colecao,
  onColecaoSave,
  paginas,
  caracteres,
  onTamanhoLivroSave,
  onClose,
  onSave,
  onDelete,
  onStartDateAutoFilled,
  onToggleChecklistItem,
  onUpdateChecklistItemStatus,
  onAddChecklistItem,
  onRenameChecklistItem,
  onDeleteChecklistItem,
  area,
  bucketName,
  labelsById,
  projectName,
}: {
  task: PMTask | null
  open: boolean
  users?: UserRecord[]
  rawStatusOptions?: string[]
  showRecurrence?: boolean
  /** Viewer não pode salvar/excluir tarefa nem checklist — trava tudo pra leitura. */
  readOnly?: boolean
  /** Bloqueia salvar quando status=done e dueDate está vazio. */
  requireDueDate?: boolean
  /** Duração associada à coluna, em hh:mm:ss. */
  duracao?: string | null
  /** Callback para salvar a duração no bucket. Quando definido, o campo Duração é exibido. */
  onDuracaoSave?: (val: string | null) => Promise<void>
  /** Coleção da coluna (bucket.categoryName). */
  colecao?: string | null
  /** Callback para salvar a coleção no bucket. Quando definido, o campo Coleção é exibido. */
  onColecaoSave?: (val: string | null) => Promise<void>
  /** Contagem de páginas associada à coluna. */
  paginas?: number | null
  /** Contagem de caracteres, exibida junto de {@link paginas}. */
  caracteres?: number | null
  /**
   * Callback para salvar as contagens na coluna. Quando definido, os campos
   * Páginas/Caracteres aparecem — mesmo mecanismo de `onDuracaoSave`. É o que
   * impede esses campos de vazarem para as áreas que não os usam, já que este
   * modal é compartilhado.
   */
  onTamanhoLivroSave?: (val: { paginas: number | null; caracteres: number | null }) => Promise<void>
  onClose: () => void
  onSave?: (updated: PMTask) => void
  onDelete?: (task: PMTask) => Promise<void>
  onStartDateAutoFilled?: (task: PMTask, date: Date) => void
  onToggleChecklistItem?: (itemId: string, checked: boolean) => Promise<void>
  onUpdateChecklistItemStatus?: (itemId: string, status: ChecklistStatus) => Promise<void>
  onAddChecklistItem?: (title: string) => Promise<void>
  onRenameChecklistItem?: (itemId: string, newTitle: string) => Promise<void>
  onDeleteChecklistItem?: (itemId: string) => Promise<void>
  /**
   * Área dona da tarefa — usada só para trocar o layout/hierarquia visual do
   * cabeçalho para o modo "documento" quando `'pedagogia'`. `undefined`/outras
   * áreas preservam o cabeçalho clássico.
   */
  area?: 'marketing' | 'administrativo' | 'pedagogia'
  /** Nome da coluna (bucket) da tarefa — exibido como "chip" no cabeçalho do modo "documento" (só Pedagogia). */
  bucketName?: string
  /** Dicionário de etiquetas do projeto — exibido na seção Etiquetas do cabeçalho do modo "documento" (só Pedagogia). */
  labelsById?: Map<string, PMOfficeLabel>
  /**
   * Nome do PROJETO dono da tarefa — repassado ao `logPmAction`
   * de `TaskComments`, mesmo campo desnormalizado que `usePmAudit`/
   * `PmAuditMetadata.projectName` já exigem em toda ação de PM Office (ver
   * `hooks/usePmAudit.ts`). Opcional porque só o fluxo de Comentários da
   * Pedagogia precisa: `undefined` cai no fallback `task.projectId` dentro
   * de `TaskComments` (id cru em vez de nome legível, mesmo padrão de
   * degradação de `bucketName` ausente em outras chamadas deste modal).
   */
  projectName?: string
}) {
  const isEditable = !readOnly
  const readOnlyTitle = 'Somente leitura — perfil Viewer'
  // Cabeçalho em estilo "documento", exclusivo da área Pedagogia — as demais
  // áreas (undefined ou outro valor) mantêm o cabeçalho clássico.
  const isPedagogia = area === 'pedagogia'
  // Overlay alinhado ao topo (em vez de centralizado) e padding-top
  // reduzido no mobile — em telas baixas, `pt-[6vh]` somado a `max-h-[90vh]`
  // empurraria o rodapé do modal pra fora da viewport. Mesmo breakpoint
  // (640px) usado no resto do PM Office.
  const isMobile = useMediaQuery('(max-width: 640px)')
  const resolvedLabelsById = labelsById ?? new Map<string, PMOfficeLabel>()
  // Ref para o container scrollável interno do modal — passado ao InlineDateCellPopup
  // para que o listener de scroll não vá parar no <main> da página.
  const scrollRef = useRef<HTMLDivElement>(null)
  // Com a coluna de Comentários, o corpo do modo "documento" da
  // Pedagogia (isPedagogia && isEditable) vira DUAS colunas lado a lado —
  // `scrollRef` continua sendo o wrapper que separa cabeçalho/corpo/rodapé,
  // mas deixa de ser o container que de fato rola quando há duas colunas.
  // `leftColumnRef` é o scroll real da coluna esquerda (conteúdo) nesse caso
  // — é ELE que precisa ir para `scrollContainer` do InlineDateCellPopup
  // (via PedagogiaDocumentBody), senão o popup de data escutaria o scroll do
  // wrapper externo, que não rola mais nesse layout. Nas demais áreas e no
  // ramo readOnly da Pedagogia, `scrollRef` segue sendo o único container que
  // rola — comportamento idêntico ao anterior, sem esta ref entrando em jogo.
  const leftColumnRef = useRef<HTMLDivElement>(null)

  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<PMTask['status']>('todo')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [dueDate, setDueDate] = useState<Date | null>(null)
  const [assignees, setAssignees] = useState<string[]>([])
  const [assigneesNames, setAssigneesNames] = useState<string[]>([])
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false)
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrenceConfig['pattern']>('daily')
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([])
  const [rawStatus, setRawStatus] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [referencias, setReferencias] = useState('')
  const [linkRoteiro, setLinkRoteiro] = useState('')
  const [avisoApi, setAvisoApi] = useState(false)
  const [localDuracao, setLocalDuracao] = useState(duracao ?? '')
  const [localColecao, setLocalColecao] = useState(colecao ?? '')
  // — mantidos como string porque é o que o <input> devolve; a conversão
  // para número (ou `null`, quando limpo) acontece só no save, via `parseContagem`.
  const [localPaginas, setLocalPaginas] = useState(paginas != null ? String(paginas) : '')
  const [localCaracteres, setLocalCaracteres] = useState(caracteres != null ? String(caracteres) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false)
  // Popover custom do chip de status do cabeçalho — mesmo mecanismo do menu
  // "⋯" do card (MarketingKanbanCard): portal + posicionamento via
  // getBoundingClientRect + fechamento ao clicar fora. Existe porque um
  // <select> nativo não dá pra estilizar (bolinha colorida por opção, ✓ na
  // vigente, cantos/sombra no padrão do resto do app).
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const statusChipRef = useRef<HTMLButtonElement>(null)
  const statusMenuPopRef = useRef<HTMLDivElement>(null)
  const [statusMenuPos, setStatusMenuPos] = useState({ top: 0, left: 0 })
  // Falhas de exclusão passam a ser visíveis em vez de engolidas.
  const [deleteTaskError, setDeleteTaskError] = useState<string | null>(null)
  const [deleteTaskLoading, setDeleteTaskLoading] = useState(false)

  // Fecha o popover de status ao clicar fora
  useEffect(() => {
    if (!statusMenuOpen) return
    function onOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-status-menu]')) return
      setStatusMenuOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [statusMenuOpen])

  // Posiciona o popover de status via portal — mesmo cálculo do menu ⋯ do card
  useLayoutEffect(() => {
    if (!statusMenuOpen || !statusMenuPopRef.current || !statusChipRef.current) return
    const popRect = statusMenuPopRef.current.getBoundingClientRect()
    const btnRect = statusChipRef.current.getBoundingClientRect()
    const GAP = 4
    let top = btnRect.bottom + GAP
    let left = btnRect.left
    if (top + popRect.height + 8 > window.innerHeight) {
      top = Math.max(8, btnRect.top - popRect.height - GAP)
    }
    if (left + popRect.width + 8 > window.innerWidth) {
      left = Math.max(8, window.innerWidth - popRect.width - 8)
    }
    setStatusMenuPos({ top, left })
  }, [statusMenuOpen])

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setStatus(task.status)
    setDescription(task.description ?? '')
    setStartDate(toDate(task.startDate))
    setDueDate(toDate(task.dueDate))
    setAssignees(task.assignees ?? [])
    setAssigneesNames(task.assigneesNames ?? [])
    setObservacoes(task.observacoes ?? task.description ?? '')
    setReferencias(task.referencias ?? '')
    setLinkRoteiro(task.linkRoteiro ?? '')
    setAvisoApi(task.avisoApi ?? false)
    setRawStatus(task.rawStatus ?? task.status)
    setLocalDuracao(duracao ?? '')
    setLocalColecao(colecao ?? '')
    setLocalPaginas(paginas != null ? String(paginas) : '')
    setLocalCaracteres(caracteres != null ? String(caracteres) : '')
    if (task.recurrence) {
      setRecurrenceEnabled(true)
      setRecurrencePattern(task.recurrence.pattern)
      setRecurrenceInterval(task.recurrence.interval)
      setRecurrenceDays(task.recurrence.daysOfWeek ?? [])
    } else {
      setRecurrenceEnabled(false)
      setRecurrencePattern('daily')
      setRecurrenceInterval(1)
      setRecurrenceDays([])
    }
    setError('')
    // Depende de task?.id, não da referência de `task`. O listener
    // que alimenta este modal (subscribeMarketingTasks) escuta TODAS as tasks
    // do projeto — qualquer mudança em outra task gera um array/objeto `task`
    // novo aqui, mesmo com conteúdo idêntico. Depender da referência resetava
    // o formulário inteiro (descartando edição em andamento) toda vez que
    // QUALQUER outra task do projeto mudava, não só a que está aberta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, duracao, colecao, paginas, caracteres])

  // Gatilho automático (lazy) de "Atrasado": roda só quando ESTA tarefa
  // específica é aberta, nunca como varredura em lote. `isEditable` já
  // restringe às `source` que este app gerencia — tarefas 'linear'/'clickup'
  // são espelho read-only de sistema externo e nunca têm o status sobrescrito
  // aqui. `readOnly` (Viewer) também não dispara escrita: a UI não grava nada
  // silenciosamente para quem só pode ler.
  //
  // Excluídas as tarefas com vocabulário de status granular/derivado — o
  // `<select>` genérico (STATUS_OPTIONS, que ganhou "Atrasado") não é o que
  // essas telas usam:
  // - tarefas com `rawStatusOptions`: têm régua de status própria, e
  //   sobrescrever `status` sem tocar `rawStatus` deixaria os dois
  //   inconsistentes (as conversões não conhecem `'atrasado'`).
  // - `task.rawStatus` sem as duas opções acima: status CALCULADO a partir
  //   das subtarefas (tarefa pai) — não é um valor que se sobrescreve aqui.
  useEffect(() => {
    if (!task || !isEditable) return
    const hasGranularVocabulary =
      !!ACCESSIBILITY_RAW_OPTIONS[task.title] || !!rawStatusOptions || !!task.rawStatus
    if (hasGranularVocabulary) return
    let cancelled = false
    applyLazyOverdueTransition(task)
      .then((resolved) => {
        if (cancelled || resolved.status === task.status) return
        setStatus(resolved.status)
      })
      .catch(() => { /* best-effort — não bloqueia a abertura do modal */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, isEditable])

  if (!open || !task) return null

  /**
   * (modo "documento" da Pedagogia): grava UM campo por vez, sem
   * fechar o modal — diferente de `handleSave` (formulário clássico, grava
   * tudo de uma vez e chama `onClose()`). Cada `InlineEditableText` chama
   * esta função no blur/Enter; `onSave` ainda é notificado (mantém o audit
   * log da página do quadro funcionando, que faz `diffFields` contra o valor
   * anterior — sem isso as edições em modo documento ficariam INVISÍVEIS no
   * log de auditoria).
   */
  async function saveField(patch: PMTaskPatch) {
    if (!task) return
    await updatePMTask(task.projectId, task.bucketId, task.id, patch)
    const updatedTask: PMTask = { ...task, ...patch }
    // `observacoes` tem espelho em estado local (lido de volta por
    // `InlineEditableText` via a prop `value` em PedagogiaDocumentBody) —
    // sem sincronizar aqui, o campo volta a mostrar o texto ANTIGO assim que
    // sai do modo de edição: o `useEffect` de `InlineEditableText` resincroniza
    // `draft = value` a cada `editing` mudar para `false`, e `value` continuava
    // apontando pro `observacoes` desatualizado (só era setado pelo `useEffect`
    // ligado a `task?.id`, que não muda numa edição de campo já aberta).
    if ('observacoes' in patch) setObservacoes(patch.observacoes ?? '')
    onSave?.(updatedTask)
  }

  /**
   * Grava o status IMEDIATAMENTE a partir do chip do cabeçalho, sem esperar
   * `handleSave` — mesma semântica do seletor de status do card
   * (`KanbanBoardPage.handleChangeTaskStatus`), replicada aqui porque o
   * modal tem seu próprio caminho de escrita (`saveField`/`updatePMTask`
   * direto, sem passar pelo board):
   *  - `progress` 100 ao concluir, 0 ao voltar para "A fazer" (em andamento
   *    preserva o progresso existente);
   *  - checklist inteiro marcado como finalizado na transição para done;
   *  - `clearPreviousStatusBeforeAtrasado`, porque é escolha MANUAL — sem
   *    isso uma reversão automática futura (prazo adiado) desfaria o que o
   *    usuário escolheu aqui;
   *  - `markTaskDone` para tarefa recorrente com prazo.
   *
   * Atualiza `status` local (o `<select>` antigo saiu do corpo, mas outros
   * pontos do formulário — o gate de `requireDueDate`, o autofill de
   * `startDate` em `handleSave` — ainda leem esse estado) e notifica
   * `onSave` para o board refletir a mudança na lista por trás do modal.
   */
  async function saveStatus(next: PMTask['status']) {
    if (!task || next === task.status) return
    const previousStatus = task.status
    const isDone = next === 'done'

    const patch: PMTaskPatch = { status: next }
    if (isDone) patch.progress = 100
    else if (next === 'todo') patch.progress = 0
    if (isDone && (task.checklist?.length ?? 0) > 0) {
      patch.checklist = (task.checklist ?? []).map((item) => ({
        ...item,
        isChecked: true,
        status: 'finalizado' as const,
      }))
      patch.checklistDone = task.checklist?.length ?? 0
    }

    setStatus(next)
    await updatePMTask(task.projectId, task.bucketId, task.id, patch, {
      clearPreviousStatusBeforeAtrasado: !!task.previousStatusBeforeAtrasado,
    })
    const updatedTask: PMTask = { ...task, ...patch }
    onSave?.(updatedTask)
    if (isDone && previousStatus !== 'done' && task.recurrence && task.dueDate) {
      markTaskDone(task.projectId, task.bucketId, updatedTask).catch(console.error)
    }
  }

  /**
   * (modo "documento" da Pedagogia): grava recorrência IMEDIATAMENTE
   * a cada mudança no `RecurrenceControl`, em vez de esperar um Salvar final
   * que não existe mais nesse modo. Mesmo par `setDoc`/`updateDoc` de
   * `handleSave` (recorrência é `FieldValue`, por isso fica fora de
   * `PMTaskPatch`/`saveField` — não dá pra unificar sem misturar tipos).
   *
   * Sem esta função, a mudança de recorrência ficaria só no estado local
   * (`recurrenceEnabled`/etc.) e se perderia ao fechar o modal — a Pedagogia
   * não tem mais barra Cancelar/Salvar para disparar a escrita que
   * `handleSave` fazia. Achado durante a implementação: o comentário
   * original ("recorrência salva ao fechar o modal") ficou falso assim que
   * o rodapé foi removido; corrigido gravando no próprio `onChange`.
   */
  async function saveRecurrence(enabled: boolean, pattern: RecurrenceConfig['pattern'], interval: number, days: number[]) {
    if (!task) return
    if (enabled) {
      const newRecurrence: RecurrenceConfig = {
        pattern,
        interval: pattern === 'custom-days' ? 1 : interval,
        ...(pattern === 'custom-days' ? { daysOfWeek: days } : {}),
      }
      await updatePMTask(task.projectId, task.bucketId, task.id, { recurrence: newRecurrence })
      onSave?.({ ...task, recurrence: newRecurrence })
    } else if (task.recurrence !== undefined) {
      await updatePMTask(task.projectId, task.bucketId, task.id, { recurrence: undefined })
      onSave?.({ ...task, recurrence: undefined })
    }
  }

  async function handleSave() {
    if (!task || !title.trim()) return
    setSaving(true)
    setError('')
    try {
      const shouldAutoFillStart =
        task.status === 'todo' &&
        (status === 'in_progress' || status === 'done') &&
        !startDate &&
        !task.startDate
      const shouldAutoFillDue =
        task.status !== 'done' &&
        status === 'done' &&
        !dueDate &&
        !task.dueDate
      let effectiveStartDate = startDate
      if (shouldAutoFillStart) {
        const todayMidnight = new Date()
        todayMidnight.setHours(0, 0, 0, 0)
        const isOverdue = dueDate !== null && dueDate < todayMidnight
        effectiveStartDate = isOverdue ? dueDate : new Date()
        setStartDate(effectiveStartDate)
      }
      let effectiveDueDate = dueDate
      if (shouldAutoFillDue) {
        effectiveDueDate = new Date()
        setDueDate(effectiveDueDate)
      }
      const newRecurrence: RecurrenceConfig | undefined = recurrenceEnabled
        ? {
            pattern: recurrencePattern,
            interval: recurrencePattern === 'custom-days' ? 1 : recurrenceInterval,
            ...(recurrencePattern === 'custom-days' ? { daysOfWeek: recurrenceDays } : {}),
          }
        : undefined
      const rawOpts = ACCESSIBILITY_RAW_OPTIONS[task.title] ?? rawStatusOptions ?? null
      const computedProgress = rawOpts
        ? (() => {
            if (!rawStatus) return status === 'done' ? 100 : 0
            const idx = rawOpts.indexOf(rawStatus)
            if (idx < 0) return status === 'done' ? 100 : 0
            const len = rawOpts.length
            return len <= 1 ? (status === 'done' ? 100 : 0) : Math.round((idx / (len - 1)) * 100)
          })()
        : null
      const patch: PMTaskPatch = {
        title: title.trim(),
        status,
        startDate: dateToTs(effectiveStartDate),
        dueDate: dateToTs(effectiveDueDate),
        assignees,
        assigneesNames,
        observacoes: observacoes.trim() || null,
        ...(task.title === 'Criação do Guia Pedagógico' ? {
          referencias: referencias.trim() || null,
          linkRoteiro: linkRoteiro.trim() || null,
        } : {}),
        // Só grava `avisoApi` em tarefas que JÁ têm o campo — ele é
        // exclusivo do fluxo de Acessibilidade. Antes era gravado em
        // todo save (estado inicia em `false`), então qualquer tarefa salva pelo
        // modal ganhava `avisoApi: false` — e como a condição que exibe o campo
        // de responsável usa `task.avisoApi === undefined`, o campo sumia
        // permanentemente da tarefa depois do primeiro save.
        ...(task.avisoApi !== undefined ? { avisoApi } : {}),
        // `progress` passou a ser gravado SEMPRE, não só nas tarefas
        // com régua de etapas própria (`rawOpts`). Antes, salvar por este modal
        // — o caminho usado quando falta prazo/início/responsável para concluir
        // — gravava `status: 'done'` e deixava o `progress` no 0 anterior,
        // então a subtarefa aparecia concluída na lista e valia zero na barra.
        // O caminho direto (`applyToggleDone`) sempre gravou os dois; aqui
        // faltava paridade. Com régua, a etapa manda; sem régua, o status.
        ...(rawOpts
          ? { rawStatus, progress: computedProgress ?? 0 }
          : { progress: status === 'done' ? 100 : status === 'todo' ? 0 : (task.progress ?? 0) }),
      }
      await updatePMTask(task.projectId, task.bucketId, task.id, patch, {
        // HandleSave é sempre escrita MANUAL (a transição automática
        // grava direto via applyLazyOverdueTransition, sem passar por aqui) —
        // então qualquer save por este modal invalida um `previousStatusBeforeAtrasado`
        // residual de uma marcação automática anterior. Sem isso, uma tarefa que já
        // foi auto-marcada 'atrasado' uma vez, trocada manualmente, e remarcada
        // manualmente para 'atrasado' de novo, carregaria o campo antigo — e uma
        // futura reversão automática (dueDate adiada) reverteria essa escolha
        // manual, violando a regra 4 da issue (troca manual nunca reverte sozinha).
        clearPreviousStatusBeforeAtrasado: !!task.previousStatusBeforeAtrasado,
      })
      // Recorrência é escrita separada para evitar poluir PMTaskPatch
      if (recurrenceEnabled && newRecurrence !== undefined) {
        await updatePMTask(task.projectId, task.bucketId, task.id, { recurrence: newRecurrence })
      } else if (!recurrenceEnabled && task.recurrence !== undefined) {
        await updatePMTask(task.projectId, task.bucketId, task.id, { recurrence: undefined })
      }
      // Ao transitar para done, sincroniza todos os itens do checklist para finalizado
      if (status === 'done' && task.status !== 'done' && task.checklist && task.checklist.length > 0) {
        await updatePMTask(task.projectId, task.bucketId, task.id, {
          checklist: task.checklist.map((item) => ({ ...item, isChecked: true, status: 'finalizado' as const })),
          checklistDone: task.checklist.length,
        })
      }
      // Salva duração no bucket quando o callback for fornecido
      if (onDuracaoSave) {
        await onDuracaoSave(localDuracao.trim() || null)
      }
      // Salva coleção no bucket quando o callback for fornecido
      if (onColecaoSave) {
        await onColecaoSave(localColecao.trim() || null)
      }
      // Salva as contagens na coluna. `null` em campo limpo — nunca `NaN`
      // nem `0`, que seriam lidos como "zero páginas".
      if (onTamanhoLivroSave) {
        await onTamanhoLivroSave({
          paginas: parseContagem(localPaginas),
          caracteres: parseContagem(localCaracteres),
        })
      }
      const updatedTask: PMTask = { ...task, ...patch, recurrence: newRecurrence }
      onSave?.(updatedTask)
      if (shouldAutoFillStart && effectiveStartDate) {
        onStartDateAutoFilled?.(updatedTask, effectiveStartDate)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  // ── validação das contagens (páginas + caracteres) ────────────────
  // A obrigatoriedade é INCREMENTAL, não retroativa: só morde quando o usuário
  // mexe nos campos. Exigir sempre travaria a edição de toda tarefa antiga —
  // ninguém conseguiria corrigir uma data sem antes caçar esses números.
  const paginasVazio = localPaginas.trim() === ''
  const caracteresVazio = localCaracteres.trim() === ''
  const paginasInvalido = !paginasVazio && !isContagemValida(localPaginas)
  const caracteresInvalido = !caracteresVazio && !isContagemValida(localCaracteres)
  // Preencher um e deixar o outro vazio = par incompleto. Só bloqueia se ao
  // menos um tem conteúdo (os dois vazios = tarefa antiga, segue o baile).
  const tamanhoLivroIncompleto =
    onTamanhoLivroSave !== undefined && paginasVazio !== caracteresVazio
  const tamanhoLivroInvalido = paginasInvalido || caracteresInvalido
  // Aviso informativo (NÃO bloqueia): contagens ainda não preenchidas.
  const tamanhoLivroAusente =
    onTamanhoLivroSave !== undefined && paginasVazio && caracteresVazio

  // Bloqueia salvar quando requireDueDate=true e status=done sem datas ou sem atribuído
  const dueDateRequired = requireDueDate && status === 'done' && !dueDate
  const startDateRequired = requireDueDate && status === 'done' && !startDate
  const assigneesRequired = requireDueDate && status === 'done' && assigneesNames.length === 0
  // Alerta informativo (não bloqueia) ao mover para in_progress sem atribuído
  const assigneesInProgressAlert = requireDueDate && status === 'in_progress' && assigneesNames.length === 0
  const canSave =
    (!recurrenceEnabled || recurrencePattern !== 'custom-days' || recurrenceDays.length > 0) &&
    !dueDateRequired &&
    !startDateRequired &&
    !assigneesRequired &&
    !assigneesInProgressAlert &&
    !tamanhoLivroIncompleto &&
    !tamanhoLivroInvalido

  return (
    <div
      // Pedagogia: modal alinhado ao topo, não centralizado. `pt-[6vh]` no
      // desktop; reduzido no mobile (`pt-3`) para não empurrar o rodapé do
      // modal (`max-h-[90vh]`) pra fora da viewport em telas baixas. As outras
      // áreas seguem centralizadas.
      className={
        isPedagogia
          ? isMobile
            ? 'fixed inset-0 z-50 flex items-start justify-center p-4 pt-3'
            : 'fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]'
          : 'fixed inset-0 z-50 flex items-center justify-center p-4'
      }
      style={{ fontFamily: "'Hanken Grotesk', system-ui, sans-serif", animation: 'fadeIn .2s ease' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
      onClick={onClose}
    >
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.42)', backdropFilter: 'blur(3px)' }} />
      <div
        className={isPedagogia ? 'relative w-full max-w-[1075px] max-h-[90vh] flex flex-col overflow-hidden' : 'relative w-full max-w-[900px] max-h-[90vh] flex flex-col overflow-hidden'}
        style={{
          background: 'var(--eh-surface)',
          // Pedagogia: modal largo (1075px) mesmo em coluna única — os 720px
          // anteriores ficaram estreitos demais depois que a coluna direita
          // saiu. Cantos de ~8px, menores que o raio padrão dos demais modais
          // (900px/16px).
          borderRadius: isPedagogia ? 8 : 16,
          boxShadow: '0 24px 60px rgba(15,23,42,0.2)',
          animation: 'modalIn .26s cubic-bezier(.2,.7,.3,1)',
          fontFamily: isPedagogia
            ? 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif'
            : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {isPedagogia ? (
          /* Cabeçalho em modo "documento" (só Pedagogia): "chip" da coluna
             acima do título, título maior/semibold, em duas linhas. Ramo
             else abaixo preserva o cabeçalho de 1 linha original byte a
             byte — nenhum wrapper novo entra no caminho de Marketing/
             Administrativo/Editorial/Tecnologia/Audiovisual. */
          // (refino, "colocação dos itens mais proporcional... mais
          // respiro"): gap 3→4 (12px→16px) entre a linha do chip e o bloco
          // do título, e padding 4→5 (16px→20px) no cabeçalho inteiro — dá
          // mais ar ao redor do título maior desta rodada, sem alterar a
          // ORDEM chip→título→pílulas→Membros/Etiquetas→Descrição.
          <div className="flex flex-col gap-4 p-5 shrink-0" style={{ borderBottom: '1px solid var(--eh-border)' }}>
            {/* Linha 1: chip da coluna (esquerda) + ações do modal (direita) —
                mesma posição da captura real, onde os ícones ficam alinhados
                ao chip, não ao título (que pode quebrar em várias linhas). */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {bucketName ? (
                  // Chip PURAMENTE informativo — sem seta. Antes tinha um
                  // chevron decorativo que sugeria ser clicável (abrir/trocar
                  // coluna) sem fazer nada; removido para não prometer uma
                  // interação que não existe. Trocar de coluna continua
                  // disponível pelo menu "⋯" do card ("Mover para").
                  <span
                    className="shrink-0 font-semibold px-2 py-1"
                    // Correção de contraste: --eh-text-2 (#67746f) sobre
                    // --eh-pm-neutral-surface (#f1f2f4) media 4,36:1 — abaixo do
                    // piso AA (4,5:1). --eh-pm-modal-text mede 12,80:1 no claro.
                    style={{ background: 'var(--eh-pm-neutral-surface)', color: 'var(--eh-pm-modal-text)', borderRadius: 4, fontSize: 12 }}
                  >
                    {bucketName.toUpperCase()}
                  </span>
                ) : null}
                {/* Chip de status — ESTE sim é clicável: popover custom (não
                    <select> nativo, que não dá pra estilizar) no mesmo padrão
                    visual do menu "⋯" do card — portal, cantos arredondados,
                    sombra, bolinha colorida por opção, ✓ na vigente. Grava na
                    hora via `saveStatus`, sem esperar o Salvar do formulário —
                    substituiu o <select> de status que ficava no corpo do
                    modal, não duplica o campo. */}
                {isEditable && !readOnly && !rawStatusOptions && !task.rawStatus && !ACCESSIBILITY_RAW_OPTIONS[task.title] ? (
                  <>
                    <button
                      ref={statusChipRef}
                      type="button"
                      data-status-menu=""
                      onClick={() => setStatusMenuOpen((v) => !v)}
                      className="shrink-0 inline-flex items-center gap-1 font-semibold px-2 py-1 border-0 cursor-pointer"
                      style={{
                        background: STATUS_CHIP_CFG[status].bg,
                        color: STATUS_CHIP_CFG[status].fg,
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_CHIP_CFG[status].dot, flexShrink: 0 }} />
                      {STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {statusMenuOpen && createPortal(
                      <div
                        ref={statusMenuPopRef}
                        data-status-menu=""
                        style={{
                          position: 'fixed',
                          top: statusMenuPos.top,
                          left: statusMenuPos.left,
                          zIndex: 9999,
                          background: 'var(--eh-surface)',
                          border: '1px solid var(--eh-border)',
                          borderRadius: 8,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
                          padding: 4,
                          minWidth: 168,
                        }}
                      >
                        {STATUS_OPTIONS.map((opt) => {
                          const selecionado = status === opt.value
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              data-status-menu=""
                              onClick={() => { if (!selecionado) void saveStatus(opt.value); setStatusMenuOpen(false) }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                width: '100%',
                                textAlign: 'left',
                                fontSize: 12.5,
                                fontWeight: selecionado ? 600 : 500,
                                color: selecionado ? 'var(--eh-text-strong)' : 'var(--eh-text-2)',
                                background: 'transparent',
                                padding: '6px 8px',
                                borderRadius: 5,
                                border: 'none',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                            >
                              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: STATUS_CHIP_CFG[opt.value].dot }} />
                              {opt.label}
                              {selecionado && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--eh-text-3)' }}>✓</span>}
                            </button>
                          )
                        })}
                      </div>,
                      document.body,
                    )}
                  </>
                ) : (
                  <span
                    className="shrink-0 inline-flex items-center gap-1 font-semibold px-2 py-1"
                    style={{
                      background: STATUS_CHIP_CFG[status].bg,
                      color: STATUS_CHIP_CFG[status].fg,
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_CHIP_CFG[status].dot, flexShrink: 0 }} />
                    {STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isEditable && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded" style={{ background: 'var(--eh-surface-2)', color: 'var(--eh-text-2)', border: '1px solid var(--eh-border)' }}>
                    {readOnly ? readOnlyTitle : 'ClickUp — somente leitura'}
                  </span>
                )}
                {onDelete && !readOnly && (
                  <button
                    type="button"
                    title="Excluir tarefa"
                    onClick={() => setConfirmDeleteTask(true)}
                    className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label="Excluir tarefa"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                )}
                <ModalCloseBtn onClick={onClose} />
              </div>
            </div>
            {/* Linha 2: círculo vazio (checkbox, só visual — marcar concluída
                já existe via o campo Status mais abaixo, não duplicamos a
                ação aqui) + título grande, quebrando em várias linhas.
                `items-center` (não `items-start`): na captura real o
                círculo fica na altura da 2ª linha do título — centralizado
                verticalmente no BLOCO do título, não colado no topo. */}
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--eh-border-hover)', flexShrink: 0 }}
              />
              {/* Título grande e destacado: fontSize 24 com lineHeight 1.3
                  (=31,2px) e peso 700. Os 20px/650 anteriores ficavam
                  discretos demais para o elemento principal do modal.
                  Modo "documento": sem rótulo "Título" nem campo
                  de formulário — o próprio texto grande é editável, clicar
                  abre inline, blur/Enter salva (via `saveField`, sem fechar
                  o modal). Viewer (`!isEditable`) vê o texto sem poder
                  clicar (`disabled`).
                  `maxWidth: 760` dentro do modal de 1075px: um título ou
                  parágrafo esticando quase 1000px de ponta a ponta é uma
                  linha de leitura desconfortável. Limitando só o BLOCO de
                  texto (não o modal, que continua largo para as
                  pílulas/Membros/Etiquetas), o título volta a quebrar em
                  mais de 1 linha, com folga à direita em vez de vazio. */}
              <div id="task-detail-title" className="flex-1" style={{ maxWidth: 760 }}>
                <InlineEditableText
                  value={task.title}
                  onSave={(next) => saveField({ title: next })}
                  ariaLabel="título da tarefa"
                  disabled={!isEditable}
                  fontSize={24}
                  fontWeight={700}
                  lineHeight={1.3}
                  color="var(--eh-text-strong)"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-4 shrink-0" style={{ borderBottom: '1px solid var(--eh-border)' }}>
            <h2 id="task-detail-title" className="text-base font-semibold truncate flex-1" style={{ color: 'var(--eh-text-strong)' }}>{task.title}</h2>
            {!isEditable && (
              <span className="shrink-0 text-xs px-2 py-0.5 rounded" style={{ background: 'var(--eh-surface-2)', color: 'var(--eh-text-2)', border: '1px solid var(--eh-border)' }}>
                {readOnly ? readOnlyTitle : 'ClickUp — somente leitura'}
              </span>
            )}
            {onDelete && !readOnly && (
              <button
                type="button"
                title="Excluir tarefa"
                onClick={() => setConfirmDeleteTask(true)}
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                aria-label="Excluir tarefa"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            )}
            <ModalCloseBtn onClick={onClose} />
          </div>
        )}

        <div
          ref={scrollRef}
          className={
            // Modo "documento" editável da Pedagogia vira DUAS
            // colunas lado a lado (conteúdo ~2/3 + Comentários ~1/3, medido
            // na referência) — este wrapper deixa de ser scrollável ele
            // mesmo (`overflow-y-auto`/padding somem daqui) porque cada
            // coluna passa a rolar por conta própria. Toda outra combinação
            // de área/estado (inclusive o ramo readOnly da Pedagogia,
            // isPedagogia && !isEditable) preserva EXATAMENTE a classe
            // anterior — layout de coluna única com scroll neste wrapper.
            isPedagogia && isEditable
              ? isMobile
                ? 'flex-1 overflow-hidden flex flex-col'
                : 'flex-1 overflow-hidden flex'
              : 'flex-1 overflow-y-auto p-4 space-y-4'
          }
        >
          {isEditable ? (
            isPedagogia ? (
              <>
                {/* Coluna esquerda — conteúdo (pílulas, Membros/Etiquetas,
                    Descrição, Anexos). `leftColumnRef` é o scroll real desta
                    coluna nesse layout (ver comentário da ref acima) — é ele
                    que vai para `scrollContainer` do date picker, não mais
                    `scrollRef`. No mobile empilha ACIMA de Comentários (a
                    pedido da issue: "duas colunas empilham" em ~390px), com
                    altura máxima própria para não deixar Comentários fora da
                    viewport. */}
                <div
                  ref={leftColumnRef}
                  // (refino, "mais respiro vertical") — era space-y-4
                  // (16px), agora space-y-6 (24px), mesmo ajuste de
                  // PedagogiaDocumentBody.tsx.
                  className="overflow-y-auto p-4 space-y-6"
                  style={isMobile ? { maxHeight: '55%', flexShrink: 0 } : { flex: '2 1 0%', minWidth: 0 }}
                >
                  <PedagogiaDocumentBody
                    task={task}
                    users={users}
                    labels={labelsById ? Array.from(labelsById.values()) : []}
                    labelsById={resolvedLabelsById}
                    startDate={startDate}
                    dueDate={dueDate}
                    recurrenceEnabled={recurrenceEnabled}
                    recurrencePattern={recurrencePattern}
                    recurrenceInterval={recurrenceInterval}
                    recurrenceDays={recurrenceDays}
                    onDatesChange={(nextStart, nextDue) => { setStartDate(nextStart); setDueDate(nextDue) }}
                    onRecurrenceChange={(enabled, pattern, interval, days) => {
                      setRecurrenceEnabled(enabled)
                      setRecurrencePattern(pattern)
                      setRecurrenceInterval(interval)
                      setRecurrenceDays(days)
                      void saveRecurrence(enabled, pattern, interval, days)
                    }}
                    assignees={assignees}
                    assigneesNames={assigneesNames}
                    onAssigneesChange={(uids, names) => { setAssignees(uids); setAssigneesNames(names) }}
                    observacoes={observacoes}
                    onSaveField={saveField}
                    scrollContainer={leftColumnRef.current}
                    isEditable={isEditable}
                    onToggleChecklistItem={onToggleChecklistItem}
                    onUpdateChecklistItemStatus={onUpdateChecklistItemStatus}
                    onAddChecklistItem={onAddChecklistItem}
                    onRenameChecklistItem={onRenameChecklistItem}
                    onDeleteChecklistItem={onDeleteChecklistItem}
                    bucketName={bucketName}
                  />
                </div>
                {/* Coluna direita — Comentários. ~1/3 no desktop;
                    no mobile empilha abaixo, preenchendo o restante da
                    altura disponível. `PmArea` vem de `area` (só
                    'pedagogia' chega aqui hoje — ver escopo desta rodada no
                    JSDoc de `TaskComments`). */}
                <div
                  style={
                    isMobile
                      ? { flex: 1, minHeight: 0, borderTop: '1px solid var(--eh-border)' }
                      : { flex: '1 1 0%', minWidth: 0, borderLeft: '1px solid var(--eh-border)' }
                  }
                >
                  <TaskComments
                    projectId={task.projectId}
                    bucketId={task.bucketId}
                    taskId={task.id}
                    area={area ?? 'pedagogia'}
                    projectName={projectName ?? task.projectId}
                    taskTitle={task.title}
                    isEditable={isEditable}
                  />
                </div>
              </>
            ) : (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Título</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {/* Status "simples" (os 4 valores padrão) saiu daqui — agora é o
                  chip clicável no cabeçalho do modal, ao lado do nome da
                  coluna, e grava na hora via `saveStatus`. Os três vocabulários
                  GRANULARES abaixo continuam no corpo: não têm equivalente no
                  chip (que só conhece STATUS_OPTIONS) e cada um já tinha sua
                  própria UI antes desta mudança. */}
              {(ACCESSIBILITY_RAW_OPTIONS[task.title] || rawStatusOptions || task.rawStatus) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Status</label>
                    {ACCESSIBILITY_RAW_OPTIONS[task.title] ? (
                      <select
                        value={rawStatus}
                        onChange={e => {
                          setRawStatus(e.target.value)
                          setStatus(rawToStandard(e.target.value, task.title))
                        }}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {ACCESSIBILITY_RAW_OPTIONS[task.title].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : rawStatusOptions ? (
                      <select
                        value={rawStatus}
                        onChange={e => {
                          setRawStatus(e.target.value)
                          setStatus(radioNovelaRawToStandard(e.target.value))
                        }}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {rawStatusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      /* Status calculado das subtarefas — read-only no modal da tarefa pai */
                      <div style={{ display: 'flex', alignItems: 'center', height: 36, gap: 10 }}>
                        {(() => {
                          const cfg = PM_STATUS_CFG[status as keyof typeof PM_STATUS_CFG] ?? PM_STATUS_CFG.todo
                          return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: cfg.bg, color: cfg.fg }}>
                              {task.rawStatus}
                            </span>
                          )
                        })()}
                        <span style={{ fontSize: 11, color: 'var(--eh-muted-2)' }}>calculado das subtarefas</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Prioridade removida (campo descontinuado). */}
              <div>
                <label className="block text-sm font-medium mb-1">Observações</label>
                <textarea
                  rows={4}
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              {task.title === 'Criação do Guia Pedagógico' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Referências</label>
                    <textarea
                      rows={3}
                      value={referencias}
                      onChange={e => setReferencias(e.target.value)}
                      placeholder="Referências para a criação do mapa..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Link do Roteiro</label>
                    <input
                      type="url"
                      value={linkRoteiro}
                      onChange={e => setLinkRoteiro(e.target.value)}
                      placeholder="https://..."
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </>
              )}
              {task.parentTaskId === null && task.avisoApi !== undefined && !rawStatusOptions && (
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={avisoApi}
                      onChange={e => setAvisoApi(e.target.checked)}
                      style={{ width: 14, height: 14 }}
                    />
                    <span className="text-sm font-medium" style={{ color: avisoApi ? 'var(--eh-warn-fg)' : undefined }}>
                      AVISO API
                    </span>
                  </label>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <ModalDatePicker label="Início" value={startDate} onChange={setStartDate} scrollContainer={scrollRef.current} disabledAfter={dueDate ?? undefined} />
                  {/* Alerta inline quando requireDueDate=true e startDate ausente na conclusão */}
                  {startDateRequired && (
                    <p style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
                      Informe a data de Início para concluir a tarefa
                    </p>
                  )}
                </div>
                <div>
                  <ModalDatePicker label="Término" value={dueDate} onChange={setDueDate} scrollContainer={scrollRef.current} disabledBefore={startDate ?? undefined} />
                  {/* Alerta inline quando requireDueDate=true e dueDate ausente na conclusão */}
                  {dueDateRequired && (
                    <p style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
                      Informe a data de Término para concluir a tarefa
                    </p>
                  )}
                </div>
              </div>
              {/* Recorrência — exclusivo do Marketing */}
              {showRecurrence && (
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
              )}
              <div>
                <AssigneeSelect
                  users={users}
                  assignees={assignees}
                  assigneesNames={assigneesNames}
                  onChange={(uids, names) => { setAssignees(uids); setAssigneesNames(names) }}
                />
                {/* Alerta inline quando requireDueDate=true e sem atribuído */}
                {assigneesRequired && (
                  <p style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
                    Atribua ao menos um responsável para concluir a tarefa
                  </p>
                )}
                {assigneesInProgressAlert && (
                  <p style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
                    Atribua ao menos um responsável para iniciar a tarefa
                  </p>
                )}
              </div>
              {/* Coleção — só exibida quando o callback for fornecido. */}
              {onColecaoSave !== undefined && (
                <div>
                  <label className="block text-sm font-medium mb-1">Coleção</label>
                  <input
                    type="text"
                    value={localColecao}
                    onChange={(e) => setLocalColecao(e.target.value)}
                    placeholder="Nome da coleção"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
              {/* Duração — só exibida quando o callback for fornecido. */}
              {onDuracaoSave !== undefined && (
                <div>
                  <label className="block text-sm font-medium mb-1">Duração do livro</label>
                  <input
                    type="text"
                    value={localDuracao}
                    onChange={(e) => setLocalDuracao(e.target.value)}
                    placeholder="hh:mm:ss"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
              {/* Contagens — só exibidas quando o callback for fornecido. O
                  dado pertence à COLUNA, então o valor é o mesmo em todas as
                  subtarefas dela. */}
              {onTamanhoLivroSave !== undefined && (
                <div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor="pm-paginas-livro">
                        Páginas do livro
                      </label>
                      <input
                        id="pm-paginas-livro"
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={localPaginas}
                        onChange={(e) => setLocalPaginas(e.target.value)}
                        placeholder="Ex.: 32"
                        aria-invalid={paginasInvalido || undefined}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1" htmlFor="pm-caracteres-livro">
                        Caracteres do livro
                      </label>
                      <input
                        id="pm-caracteres-livro"
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={localCaracteres}
                        onChange={(e) => setLocalCaracteres(e.target.value)}
                        placeholder="Ex.: 12500"
                        aria-invalid={caracteresInvalido || undefined}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>
                  {tamanhoLivroInvalido && (
                    <p style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
                      Informe um número inteiro maior ou igual a zero.
                    </p>
                  )}
                  {!tamanhoLivroInvalido && tamanhoLivroIncompleto && (
                    <p style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
                      Preencha páginas e caracteres — os dois juntos, ou nenhum.
                    </p>
                  )}
                  {/* Informativo: não bloqueia salvar (a obrigatoriedade não é
                      retroativa às tarefas que já existiam). */}
                  {tamanhoLivroAusente && (
                    <p style={{ fontSize: 12, color: 'var(--eh-muted-4)', marginTop: 4 }}>
                      Este livro ainda não tem páginas e caracteres informados.
                    </p>
                  )}
                </div>
              )}
              {(task.dependsOn ?? []).length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-1">Depende de</label>
                  <div className="flex flex-wrap gap-1">
                    {(task.dependsOn ?? []).map(id => (
                      <span
                        key={id}
                        className="inline-flex items-center text-xs border border-border rounded px-1.5 py-0.5 font-mono"
                        style={{ background: 'var(--eh-surface-2)', color: 'var(--eh-text-2)' }}
                      >
                        {id.replace(/^(planner|clickup)_/, '').slice(0, 8)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
            )
          ) : isPedagogia ? (
            /**
             * Layout em modo "documento" para o estado read-only.
             *
             * ATENÇÃO: uma tarefa só é editável se a `source` dela estiver na
             * lista de `isEditable` (ver acima). Tarefas de origem importada que
             * ficarem fora dessa lista caem neste ramo read-only mesmo para quem
             * tem permissão de escrita — o que é intencional para espelho de
             * sistema externo, mas vira armadilha se a origem for uma importação
             * única. Ao adicionar uma `source` nova, decida esse ponto de forma
             * explícita.
             *
             * Rótulos "Datas"/"Status" aqui são só cabeçalhos com ícone (não
             * pílulas clicáveis) — o dado já está exposto ao lado, não faz
             * sentido um botão "rolar até" para algo que já está visível
             * nesta MESMA tela. As pílulas clicáveis (Datas/Membros que rolam
             * até a seção) só existem no modo "documento" (`isEditable`, ver
             * `PedagogiaDocumentBody`), onde o corpo é longo o bastante pra
             * justificar o atalho.
             *
             * Sem coluna direita/"Resumo": ela duplicava Status/Datas que já
             * estavam visíveis. A Pedagogia usa coluna única em todos os
             * estados, inclusive aqui. Sem Checklist/Anexo: não existem neste
             * ramo read-only — nenhum pretende ser clicável.
             */
            <div className="space-y-4">
              {/* Correção de contraste: os 3 rótulos de seção abaixo
                  (Descrição/Datas/Status) usavam --eh-text-2 (4,88:1 sobre
                  --eh-surface branco) — trocados por --eh-pm-modal-text
                  (14,34:1), mesmo tom escuro do título/cabeçalho de coluna. */}
              {(task.observacoes || task.description) && (
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="14" y2="18" />
                    </svg>
                    Descrição
                  </p>
                  <div className="text-sm rounded-md px-3 py-2" style={{ background: 'var(--eh-surface)', border: '1px solid var(--eh-border)', color: 'var(--eh-text)' }}>
                    {task.observacoes ?? task.description}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    Datas
                  </p>
                  <p className="text-sm" style={{ color: 'var(--eh-text)' }}>
                    {toDate(task.startDate)?.toLocaleDateString('pt-BR') ?? '—'} até {toDate(task.dueDate)?.toLocaleDateString('pt-BR') ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>Status</p>
                  <p className="text-sm" style={{ color: 'var(--eh-text)' }}>{STATUS_LABEL[task.status] ?? task.status}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <ReadField label="Título" value={task.title} />
              <ReadField label="Status" value={task.rawStatus ?? STATUS_OPTIONS_BY_TITLE[task.title]?.find(o => o.value === task.status)?.label ?? STATUS_LABEL[task.status] ?? task.status} />
              {(task.observacoes || task.description) && (
                <ReadField label="Observações" value={task.observacoes ?? task.description ?? ''} />
              )}
              {task.title === 'Criação do Guia Pedagógico' && (task.referencias || task.linkRoteiro) && (
                <>
                  {task.referencias && <ReadField label="Referências" value={task.referencias} />}
                  {task.linkRoteiro && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Link do Roteiro</p>
                      <a
                        href={task.linkRoteiro}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary underline underline-offset-2 break-all hover:opacity-80"
                      >
                        {task.linkRoteiro}
                      </a>
                    </div>
                  )}
                </>
              )}
              {task.parentTaskId === null && task.avisoApi && !rawStatusOptions && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: 'var(--eh-warn-bg)', color: 'var(--eh-warn-fg)' }}>
                    AVISO API
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <ReadField label="Início" value={toDate(task.startDate)?.toLocaleDateString('pt-BR') ?? '—'} />
                <ReadField label="Término" value={toDate(task.dueDate)?.toLocaleDateString('pt-BR') ?? '—'} />
              </div>
              {(task.assigneesNames ?? []).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Atribuídos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(task.assigneesNames ?? []).map((name, i) => (
                      <span
                        key={(task.assignees ?? [])[i] ?? `name-${i}`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full pl-1 pr-2 py-1"
                        style={{ background: 'var(--eh-surface-2)', color: 'var(--eh-text)' }}
                      >
                        <UserAvatar name={name} photoURL={findPhotoByName(name, users)} size={20} />
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Viewer vê as contagens, mas não edita. Mesma condição do ramo
                  editável (a prop é o que marca "esta tarefa tem contagens"),
                  com `pt-BR` para separar milhar. */}
              {onTamanhoLivroSave !== undefined && (
                <div className="grid grid-cols-2 gap-4">
                  <ReadField label="Páginas do livro" value={paginas != null ? paginas.toLocaleString('pt-BR') : '—'} />
                  <ReadField label="Caracteres do livro" value={caracteres != null ? caracteres.toLocaleString('pt-BR') : '—'} />
                </div>
              )}
              {(task.dependsOn ?? []).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Depende de</p>
                  <div className="flex flex-wrap gap-1">
                    {(task.dependsOn ?? []).map(id => (
                      <span
                        key={id}
                        className="inline-flex items-center text-xs border border-border rounded px-1.5 py-0.5 font-mono"
                        style={{ background: 'var(--eh-surface-2)', color: 'var(--eh-text-2)' }}
                      >
                        {id.replace(/^(planner|clickup)_/, '').slice(0, 8)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        {/* Rodapé Cancelar/Salvar — SÓ fora da Pedagogia. Modo
            "documento" da Pedagogia salva por campo (blur/Enter, via
            `saveField` dentro de `PedagogiaDocumentBody`), sem esperar um
            clique em "Salvar", então não há barra nenhuma ali.
            `isPedagogia && isEditable` nunca chega aqui: o corpo
            inteiro já é outro componente, este rodapé só existe pro
            formulário clássico das outras áreas. */}
        {!isPedagogia && (
        <div className="p-4 shrink-0 flex justify-end gap-3" style={{ borderTop: '1px solid var(--eh-border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border border-input text-sm hover:bg-accent/40 transition-colors"
          >
            Cancelar
          </button>
          {isEditable && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving || !title.trim()}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              {saving && (
                <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              )}
              Salvar
            </button>
          )}
        </div>
        )}
      </div>
      {confirmDeleteTask && (
        <ConfirmDialog
          title="Excluir tarefa?"
          message={`"${task.title}" será removida permanentemente.`}
          confirmLabel="Excluir tarefa"
          confirmBusyLabel="Excluindo…"
          variant="danger"
          loading={deleteTaskLoading}
          error={deleteTaskError}
          onCancel={() => { setConfirmDeleteTask(false); setDeleteTaskError(null) }}
          onConfirm={async () => {
            if (!onDelete) return
            setDeleteTaskLoading(true)
            setDeleteTaskError(null)
            try {
              await onDelete(task)
              setConfirmDeleteTask(false)
              onClose()
            } catch (err) {
              // Não engolir o erro: se o modal fechasse aqui, a tarefa "sumia"
              // da tela e reaparecia no reload, sem explicação nenhuma.
              console.error('[TaskDetailModal] Falha ao excluir tarefa', { taskId: task.id, title: task.title, err })
              const code = (err as { code?: string } | null)?.code
              setDeleteTaskError(
                code === 'permission-denied'
                  ? 'Você não tem permissão para excluir esta tarefa.'
                  : 'Não foi possível excluir a tarefa. Verifique sua conexão e tente novamente.',
              )
            } finally {
              setDeleteTaskLoading(false)
            }
          }}
        />
      )}
    </div>
  )
}
