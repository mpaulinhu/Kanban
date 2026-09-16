import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { InlineDateCellPopup } from './InlineDateCellPopup'
import type { ChecklistItem, PMOfficeLabel, PMTask, RecurrenceConfig } from '../types/pmOffice'
import { RecurrenceControl } from './RecurrenceControl'
import type { PMTaskPatch } from '../api/pmOfficeApi'
import { applyLazyOverdueTransition, updatePMTask } from '../api/pmOfficeApi'
import { tsFromDate, type Timestamp } from '../api/store'
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

/** Resolve a foto do usuário por nome exato (case-insensitive), só quando único. Mesmo critério de `PlannerBucketTree.findPhotoByName`. */
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

const STATUS_OPTIONS: { value: PMTask['status']; label: string }[] = [
  { value: 'todo', label: 'A fazer' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'done', label: 'Concluída' },
  // ELO-3121: trocável manualmente a qualquer momento, igual aos outros 3 —
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

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
]

type ChecklistStatus = NonNullable<ChecklistItem['status']>

const STATUS_LABEL: Record<string, string> = {
  done: 'Concluída', in_progress: 'Em andamento', todo: 'A fazer', atrasado: 'Atrasado',
}
const PRIORITY_LABEL: Record<string, string> = {
  low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
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
 * Pílula de ação estilo Trello (ELO-3182, refinamento visual Pedagogia) —
 * usada em `PedagogiaDocumentBody.tsx` (modo "documento" da Pedagogia,
 * importado de lá) e exportada daqui para não duplicar o componente. Só
 * para seções que JÁ existem no corpo (rola até lá) — nunca renderizada
 * para algo sem seção correspondente (Anexo, Checklist — sem dado
 * importado do Trello — e "+ Adicionar" genérico ficam de fora).
 */
export function ActionPill({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 transition-colors"
      // ELO-3182 (correção de contraste, pedido do Marcos: "textos dos
      // modais... o texto das pílulas"): era --eh-text-2 (4,36:1 sobre
      // --eh-pm-neutral-surface — já abaixo de AA), trocado pra
      // --eh-pm-modal-text (12,80:1).
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

/* ─── ELO-2652: contagens do tamanho do livro (páginas / caracteres) ──────────
   O módulo PM não usa Zod (valida imperativamente via `canSave`), então a
   validação destes dois campos vive aqui, em funções puras. */

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
 * o dado), nunca `NaN` ou `0` — um livro sem contagem não é um livro de zero
 * páginas, e a distinção importa para o aviso de "ainda não preenchido".
 */
function parseContagem(raw: string): number | null {
  return isContagemValida(raw) ? Number(raw.trim()) : null
}

// ELO-2182: posicionamento, scroll tracking, data inicial correta, dia em evidência,
// input dd/mm/aaaa e navegação por ano delegados ao InlineDateCellPopup compartilhado.
// ELO-2184: props disabledBefore/disabledAfter repassadas ao InlineDateCellPopup.
export function ModalDatePicker({ label, value, onChange, scrollContainer, disabledBefore, disabledAfter }: {
  label: string
  value: Date | null
  onChange: (d: Date | null) => void
  scrollContainer?: HTMLElement | null
  /** ELO-2184: desabilita dias anteriores a esta data. */
  disabledBefore?: Date
  /** ELO-2184: desabilita dias posteriores a esta data. */
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

  // ELO-2891: candidatos a responsável = só equipe interna. Filtro aqui e não
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
  /** ELO-1954: Viewer não pode salvar/excluir tarefa nem checklist — trava tudo pra leitura. */
  readOnly?: boolean
  /** ELO-2193: Bloqueia salvar quando status=done e dueDate está vazio. Passar true nas áreas Audiovisual, Editorial e Tecnologia. */
  requireDueDate?: boolean
  /** ELO-2123: Duração do livro (bucket) em hh:mm:ss — só para Libras (Acessibilidade) e tarefa plana (Rádio Novela). */
  duracao?: string | null
  /** ELO-2123: Callback para salvar a duração no bucket. Quando definido, o campo Duração é exibido. */
  onDuracaoSave?: (val: string | null) => Promise<void>
  /** ELO-2122: Coleção do livro (bucket.categoryName) — tarefa pai em Acessibilidade e Rádio Novela. */
  colecao?: string | null
  /** ELO-2122: Callback para salvar a coleção no bucket. Quando definido, o campo Coleção é exibido. */
  onColecaoSave?: (val: string | null) => Promise<void>
  /** ELO-2652: Páginas do livro (bucket) — exibido em Áudio Descrição e Libras. */
  paginas?: number | null
  /** ELO-2652: Caracteres do livro (bucket) — exibido junto de {@link paginas}. */
  caracteres?: number | null
  /**
   * ELO-2652: Callback para salvar o tamanho do livro no bucket. Quando definido,
   * os campos Páginas/Caracteres são exibidos — mesmo mecanismo de `onDuracaoSave`,
   * que é o que impede os campos de vazarem para Marketing/Tecnologia/Planner
   * (este modal é compartilhado pelos quatro módulos).
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
   * Área dona da tarefa (ELO-3182, refinamento visual) — usada só para trocar
   * o layout/hierarquia visual do cabeçalho pelo desenho do Trello quando
   * `'pedagogia'`. `undefined`/outras áreas preservam o modal atual sem
   * nenhuma mudança de pixel (Marketing/Administrativo/Editorial/Tecnologia/
   * Audiovisual não passam esta prop hoje).
   */
  area?: 'marketing' | 'administrativo' | 'pedagogia'
  /** Nome da coluna (bucket) da tarefa — exibido como "chip" no cabeçalho estilo Trello (só Pedagogia). */
  bucketName?: string
  /** Dicionário de etiquetas do projeto — exibido na seção Etiquetas do cabeçalho estilo Trello (só Pedagogia). */
  labelsById?: Map<string, PMOfficeLabel>
  /**
   * Nome do PROJETO dono da tarefa (ELO-3183) — repassado ao `logPmAction`
   * de `TaskComments`, mesmo campo desnormalizado que `usePmAudit`/
   * `PmAuditMetadata.projectName` já exigem em toda ação de PM Office (ver
   * `hooks/usePmAudit.ts`). Opcional porque só o fluxo de Comentários da
   * Pedagogia precisa: `undefined` cai no fallback `task.projectId` dentro
   * de `TaskComments` (id cru em vez de nome legível, mesmo padrão de
   * degradação de `bucketName` ausente em outras chamadas deste modal).
   */
  projectName?: string
}) {
  // ELO-3182: `'trello'` entra na lista porque as 601 tarefas importadas do
  // quadro "Agenda Pedagogas" nascem com `source: 'trello'` — sem isso a área
  // Pedagogia inteira subiria somente-leitura, e a equipe não conseguiria
  // editar o próprio trabalho. A permissão real continua vindo de `readOnly`
  // (papel do usuário via RBAC); esta lista só distingue origem de dado que o
  // CoreHub controla de origem que é espelho de sistema externo vivo (o
  // `clickup`, por exemplo, segue fora: lá a fonte da verdade é remota e
  // editar aqui criaria divergência silenciosa). O Trello é importação ÚNICA,
  // sem sincronização — depois do import, o CoreHub é a fonte da verdade.
  const isEditable =
    !readOnly &&
    (task?.source === 'planner' ||
      task?.source === 'graph' ||
      task?.source === 'manual' ||
      task?.source === 'trello')
  const readOnlyTitle = 'Somente leitura — perfil Viewer'
  // Refinamento visual estilo Trello (ELO-3182), exclusivo da área Pedagogia
  // — as demais áreas (undefined ou outro valor) mantêm o cabeçalho atual.
  const isPedagogia = area === 'pedagogia'
  // ELO-3182: overlay alinhado ao topo (em vez de centralizado) e padding-top
  // reduzido no mobile — em telas baixas, `pt-[6vh]` somado a `max-h-[90vh]`
  // empurraria o rodapé do modal pra fora da viewport. Mesmo breakpoint
  // (640px) usado no resto do PM Office.
  const isMobile = useMediaQuery('(max-width: 640px)')
  const resolvedLabelsById = labelsById ?? new Map<string, PMOfficeLabel>()
  // Ref para o container scrollável interno do modal — passado ao InlineDateCellPopup
  // para que o listener de scroll não vá parar no <main> da página.
  const scrollRef = useRef<HTMLDivElement>(null)
  // ELO-3183: com a coluna de Comentários, o corpo do modo "documento" da
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
  const [priority, setPriority] = useState('normal')
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
  // ELO-2652 — mantidos como string porque é o que o <input> devolve; a conversão
  // para número (ou `null`, quando limpo) acontece só no save, via `parseContagem`.
  const [localPaginas, setLocalPaginas] = useState(paginas != null ? String(paginas) : '')
  const [localCaracteres, setLocalCaracteres] = useState(caracteres != null ? String(caracteres) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false)
  // ELO-2978: falhas de exclusão passam a ser visíveis em vez de engolidas.
  const [deleteTaskError, setDeleteTaskError] = useState<string | null>(null)
  const [deleteTaskLoading, setDeleteTaskLoading] = useState(false)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setStatus(task.status)
    setPriority(task.priority ?? 'normal')
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
    // ELO-2743: depende de task?.id, não da referência de `task`. O listener
    // que alimenta este modal (subscribeMarketingTasks) escuta TODAS as tasks
    // do projeto — qualquer mudança em outra task gera um array/objeto `task`
    // novo aqui, mesmo com conteúdo idêntico. Depender da referência resetava
    // o formulário inteiro (descartando edição em andamento) toda vez que
    // QUALQUER outra task do projeto mudava, não só a que está aberta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, duracao, colecao, paginas, caracteres])

  // ELO-3121 — gatilho automático (lazy) de "Atrasado": roda só quando ESTA
  // tarefa específica é aberta (nunca varredura em lote). `isEditable` já
  // restringe a `source` que o CoreHub de fato gerencia (planner/graph/
  // manual) — tarefas 'linear'/'clickup' são espelho read-only de sistema
  // externo e nunca têm o status sobrescrito aqui. `readOnly` (Viewer) também
  // não dispara escrita: mesmo que a Firestore rule permita, a UI não grava
  // nada silenciosamente para quem só pode ler.
  //
  // Excluídas as tarefas com vocabulário de status granular/derivado — o
  // `<select>` genérico (STATUS_OPTIONS, que ganhou "Atrasado") não é o que
  // essas telas usam:
  // - `ACCESSIBILITY_RAW_OPTIONS[task.title]`/`rawStatusOptions`: régua
  //   própria (Áudio Descrição/Libras/Site, Rádio Novela) — sobrescrever
  //   `status` sem tocar `rawStatus` quebraria `rawToStandard`/
  //   `radioNovelaRawToStandard`, que não conhecem `'atrasado'`.
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
   * ELO-3182 (modo "documento" da Pedagogia): grava UM campo por vez, sem
   * fechar o modal — diferente de `handleSave` (formulário clássico, grava
   * tudo de uma vez e chama `onClose()`). Cada `InlineEditableText` chama
   * esta função no blur/Enter; `onSave` ainda é notificado (mantém o audit
   * log de `MarketingQuadroPage.onSave` funcionando, que faz `diffFields`
   * contra o valor anterior — sem isso as edições em modo documento
   * ficariam INVISÍVEIS no log de auditoria).
   */
  async function saveField(patch: PMTaskPatch) {
    if (!task) return
    await updatePMTask(task.projectId, task.bucketId, task.id, patch)
    const updatedTask: PMTask = { ...task, ...patch }
    onSave?.(updatedTask)
  }

  /**
   * ELO-3182 (modo "documento" da Pedagogia): grava recorrência IMEDIATAMENTE
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
        priority,
        startDate: dateToTs(effectiveStartDate),
        dueDate: dateToTs(effectiveDueDate),
        assignees,
        assigneesNames,
        observacoes: observacoes.trim() || null,
        ...(task.title === 'Criação do Guia Pedagógico' ? {
          referencias: referencias.trim() || null,
          linkRoteiro: linkRoteiro.trim() || null,
        } : {}),
        // ELO-2032: só grava `avisoApi` em tarefas que JÁ têm o campo — ele é
        // exclusivo do fluxo de Acessibilidade (ELO-1850). Antes era gravado em
        // todo save (estado inicia em `false`), então qualquer tarefa salva pelo
        // modal ganhava `avisoApi: false` — e como a condição que exibe o campo
        // de responsável usa `task.avisoApi === undefined`, o campo sumia
        // permanentemente da tarefa depois do primeiro save.
        ...(task.avisoApi !== undefined ? { avisoApi } : {}),
        // ELO-2964: `progress` passou a ser gravado SEMPRE, não só nas tarefas
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
        // ELO-3121: handleSave é sempre escrita MANUAL (a transição automática
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
      // ELO-2123: salva duração no bucket quando o callback for fornecido
      if (onDuracaoSave) {
        await onDuracaoSave(localDuracao.trim() || null)
      }
      // ELO-2122: salva coleção no bucket quando o callback for fornecido
      if (onColecaoSave) {
        await onColecaoSave(localColecao.trim() || null)
      }
      // ELO-2652: salva o tamanho do livro no bucket. `null` em campo limpo —
      // nunca `NaN` nem `0`, que seriam lidos como "livro de zero páginas".
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

  // ── ELO-2652: validação do tamanho do livro (páginas + caracteres) ──────────
  // A obrigatoriedade é INCREMENTAL, não retroativa: só morde quando o usuário
  // mexe nos campos. Exigir sempre travaria a edição de toda tarefa antiga —
  // ninguém conseguiria corrigir uma data sem antes caçar os números do livro.
  const paginasVazio = localPaginas.trim() === ''
  const caracteresVazio = localCaracteres.trim() === ''
  const paginasInvalido = !paginasVazio && !isContagemValida(localPaginas)
  const caracteresInvalido = !caracteresVazio && !isContagemValida(localCaracteres)
  // Preencher um e deixar o outro vazio = par incompleto. Só bloqueia se ao
  // menos um tem conteúdo (os dois vazios = tarefa antiga, segue o baile).
  const tamanhoLivroIncompleto =
    onTamanhoLivroSave !== undefined && paginasVazio !== caracteresVazio
  const tamanhoLivroInvalido = paginasInvalido || caracteresInvalido
  // Aviso informativo (NÃO bloqueia): livro ainda sem os números.
  const tamanhoLivroAusente =
    onTamanhoLivroSave !== undefined && paginasVazio && caracteresVazio

  // ELO-2193: bloqueia salvar quando requireDueDate=true e status=done sem datas ou sem atribuído
  const dueDateRequired = requireDueDate && status === 'done' && !dueDate
  const startDateRequired = requireDueDate && status === 'done' && !startDate
  const assigneesRequired = requireDueDate && status === 'done' && assigneesNames.length === 0
  // alerta informativo (não bloqueia) ao mover para in_progress sem atribuído
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
      // Pedagogia: alinhado ao topo (não centralizado) — é como o Trello
      // real posiciona o modal, e o Marcos pediu "mais para cima" depois de
      // ver a versão centralizada. `pt-[6vh]` no desktop; reduzido no mobile
      // (`pt-3`) para não empurrar o rodapé do modal (`max-h-[90vh]`) pra
      // fora da viewport em telas baixas. Outras áreas seguem centralizadas,
      // sem mudança.
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
          // Refinamento visual Pedagogia: 1075px medido na captura nova do
          // Trello (imagem de 1360px de largura total, modal de ~172px a
          // ~1252px ≈ 1080px) — o Marcos preferiu o modal largo mesmo em
          // coluna única (720px, versão anterior, ficou estreito demais
          // depois que a coluna direita saiu). Cantos ~8px medidos na
          // captura real do Trello, menor que o raio padrão do CoreHub
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
          /* Cabeçalho estilo Trello (ELO-3182, só Pedagogia): "chip" da coluna
             acima do título, título maior/semibold, em duas linhas. Ramo
             else abaixo preserva o cabeçalho de 1 linha original byte a
             byte — nenhum wrapper novo entra no caminho de Marketing/
             Administrativo/Editorial/Tecnologia/Audiovisual. */
          // ELO-3182 (refino, "colocação dos itens mais proporcional... mais
          // respiro"): gap 3→4 (12px→16px) entre a linha do chip e o bloco
          // do título, e padding 4→5 (16px→20px) no cabeçalho inteiro — dá
          // mais ar ao redor do título maior desta rodada, sem alterar a
          // ORDEM chip→título→pílulas→Membros/Etiquetas→Descrição.
          <div className="flex flex-col gap-4 p-5 shrink-0" style={{ borderBottom: '1px solid var(--eh-border)' }}>
            {/* Linha 1: chip da coluna (esquerda) + ações do modal (direita) —
                mesma posição da captura real, onde os ícones ficam alinhados
                ao chip, não ao título (que pode quebrar em várias linhas). */}
            <div className="flex items-center justify-between gap-2">
              {bucketName ? (
                <span
                  className="shrink-0 inline-flex items-center gap-1 font-semibold px-2 py-1"
                  // ELO-3182 (correção de contraste, pedido do Marcos): era
                  // --eh-text-2 (#67746f), que sobre --eh-pm-neutral-surface
                  // (#f1f2f4) media 4,36:1 — JÁ abaixo de AA (4,5:1). Trocado
                  // pra --eh-pm-modal-text (12,80:1 no claro).
                  style={{ background: 'var(--eh-pm-neutral-surface)', color: 'var(--eh-pm-modal-text)', borderRadius: 4, fontSize: 12 }}
                >
                  {bucketName.toUpperCase()}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              ) : <span />}
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
              {/* ELO-3182 (2ª rodada de refino, pedido do Marcos: "o título
                  ele é maior, mais destacado, bonito"). Remedido em
                  `trello-3-modal.png` por VARREDURA DE BLOCO (altura total
                  das 3 linhas de título ÷ 3, não 1 coluna isolada — mais
                  robusto contra cair num espaço entre letras): bloco de
                  y=129 a y=224 = 96px para 3 linhas ⇒ ~32px de altura de
                  linha. Escalado pela largura real do modal na captura
                  (~1080px) para o modal do CoreHub (1075px, praticamente
                  1:1) ⇒ fontSize 24 com lineHeight 1.3 (=31,2px) reproduz
                  essa proporção — dentro da faixa observada e do peso
                  fechado como 700 (extremo forte da faixa 600-700 da
                  medição anterior, coerente com "mais destacado" do pedido).
                  fontSize 20/fontWeight 650 (rodada anterior) ficava mais
                  discreto que a referência real.
                  Modo "documento" (ELO-3182): sem rótulo "Título" nem campo
                  de formulário — o próprio texto grande é editável, clicar
                  abre inline, blur/Enter salva (via `saveField`, sem fechar
                  o modal). Viewer (`!isEditable`) vê o texto sem poder
                  clicar (`disabled`).
                  `maxWidth: 760` (dentro do modal de 1075px): o modal ficou
                  largo a pedido do Marcos, mas um título/parágrafo
                  esticando quase 1000px de ponta a ponta é uma linha de
                  leitura desconfortável — a mesma lógica de qualquer coluna
                  de texto editorial. Limitando só o BLOCO de texto (não o
                  modal, que continua largo para as pílulas/Membros/
                  Etiquetas), o título volta a quebrar em mais de 1 linha
                  como na captura do Trello, só que com folga à direita em
                  vez de vazio. */}
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
            // ELO-3183: modo "documento" editável da Pedagogia vira DUAS
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
                  // ELO-3182 (refino, "mais respiro vertical") — era space-y-4
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
                    priority={priority}
                    recurrenceEnabled={recurrenceEnabled}
                    recurrencePattern={recurrencePattern}
                    recurrenceInterval={recurrenceInterval}
                    recurrenceDays={recurrenceDays}
                    onDatesChange={(nextStart, nextDue) => { setStartDate(nextStart); setDueDate(nextDue) }}
                    onPriorityChange={setPriority}
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
                  />
                </div>
                {/* Coluna direita — Comentários (ELO-3183). ~1/3 no desktop;
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
                  ) : task.rawStatus ? (
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
                  ) : (
                    <select
                      value={status}
                      onChange={e => setStatus(e.target.value as PMTask['status'])}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Prioridade</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
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
                  {/* ELO-2193: alerta inline quando requireDueDate=true e startDate ausente na conclusão */}
                  {startDateRequired && (
                    <p style={{ fontSize: 12, color: 'var(--eh-danger)', marginTop: 4 }}>
                      Informe a data de Início para concluir a tarefa
                    </p>
                  )}
                </div>
                <div>
                  <ModalDatePicker label="Término" value={dueDate} onChange={setDueDate} scrollContainer={scrollRef.current} disabledBefore={startDate ?? undefined} />
                  {/* ELO-2193: alerta inline quando requireDueDate=true e dueDate ausente na conclusão */}
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
                {/* ELO-2193: alerta inline quando requireDueDate=true e sem atribuído */}
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
              {/* ELO-2122: Coleção do livro — só exibido quando callback for fornecido (tarefa pai em Acessibilidade/Rádio Novela) */}
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
              {/* ELO-2123: Duração do livro — só exibido quando callback for fornecido (Libras/Rádio Novela) */}
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
              {/* ELO-2652: Tamanho do livro — só exibido quando o callback for
                  fornecido (Áudio Descrição e Libras). O dado é do LIVRO (bucket),
                  então o valor é o mesmo nas duas subtarefas. */}
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
              {task.source === 'graph' && (
                <ChecklistSection
                  items={task.checklist ?? []}
                  isEditable={isEditable}
                  onToggleItem={onToggleChecklistItem}
                  onUpdateItemStatus={onUpdateChecklistItemStatus}
                  onAddItem={onAddChecklistItem}
                  onRenameItem={onRenameChecklistItem}
                  onDeleteItem={onDeleteChecklistItem}
                />
              )}
            </>
            )
          ) : isPedagogia ? (
            /**
             * Layout estilo Trello para o read-only (ELO-3182, refinamento visual).
             *
             * IMPORTANTE: tarefas importadas do Trello gravam `source: 'trello'`
             * (ver `scripts/firestore/import-trello-agenda-pedagogas.mjs`), que NÃO
             * está na lista de `isEditable` (`planner`/`graph`/`manual`) — então
             * TODA tarefa da Pedagogia cai neste ramo read-only hoje, mesmo para
             * quem tem permissão de escrita (`canWrite`/editor+). Isso é um
             * comportamento PRÉ-EXISTENTE, não introduzido por este refinamento
             * visual — sinalizado no relatório como algo a decidir separadamente
             * (é mudança de comportamento, não de estilo, então fora do escopo
             * desta issue). O layout abaixo assume esse ramo é o que a Pedagogia
             * realmente usa hoje.
             *
             * Rótulos "Datas"/"Status" aqui são só cabeçalhos com ícone (não
             * pílulas clicáveis) — o dado já está exposto ao lado, não faz
             * sentido um botão "rolar até" para algo que já está visível
             * nesta MESMA tela. As pílulas clicáveis (Datas/Membros que rolam
             * até a seção) só existem no modo "documento" (`isEditable`, ver
             * `PedagogiaDocumentBody`), onde o corpo é longo o bastante pra
             * justificar o atalho.
             *
             * Sem coluna direita/"Resumo": removida a pedido do Marcos
             * (duplicava Status/Datas que já estavam visíveis). Modal em
             * coluna única em todo estado da Pedagogia agora, inclusive
             * aqui. Sem Checklist/Anexo: não existem para `source: 'trello'`
             * /este ramo read-only — nenhum pretende ser clicável.
             */
            <div className="space-y-4">
              {/* ELO-3182 (correção de contraste, pedido do Marcos: "quero
                  que fosse mais preto"): os 3 rótulos de seção abaixo
                  (Descrição/Datas/Status) usavam --eh-text-2 (4,88:1 sobre
                  --eh-surface branco) — trocados pra --eh-pm-modal-text
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
              <div className="grid grid-cols-2 gap-4">
                <ReadField label="Status" value={task.rawStatus ?? STATUS_OPTIONS_BY_TITLE[task.title]?.find(o => o.value === task.status)?.label ?? STATUS_LABEL[task.status] ?? task.status} />
                <ReadField label="Prioridade" value={PRIORITY_LABEL[task.priority] ?? task.priority} />
              </div>
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
              {/* ELO-2652: Viewer vê o tamanho do livro, mas não edita. Mesma
                  condição do ramo editável (a prop é o que marca "esta tarefa
                  tem tamanho de livro"), com `pt-BR` para separar milhar. */}
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

        {/* Rodapé Cancelar/Salvar — SÓ fora da Pedagogia (ELO-3182). Modo
            "documento" da Pedagogia salva por campo (blur/Enter, via
            `saveField` dentro de `PedagogiaDocumentBody`), sem esperar um
            clique em "Salvar" — igual ao Trello real, que não tem essa
            barra. `isPedagogia && isEditable` nunca chega aqui: o corpo
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
              // ELO-2978: antes o erro sumia aqui e o modal inteiro fechava —
              // a tarefa "sumia" da tela e voltava no reload.
              console.error('[ELO-2978] Falha ao excluir tarefa', { taskId: task.id, title: task.title, err })
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
