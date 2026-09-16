import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { CSSProperties } from 'react'
import type { ChecklistItem, PMBucket, PMTask } from '../types/pmOffice'
import { useRole } from '@/hooks/useRole'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usersApi } from '../api/usersApi'
import type { UserRecord } from '../api/usersApi'
import { UserAvatar } from '@/components/UserAvatar/UserAvatar'
import { AssigneeAvatars } from '../components/AssigneeAvatars'
import { TaskDetailModal } from '../components/TaskDetailModal'
import { MarketingGradeFilters } from '../components/MarketingGradeFilters'
import { StartDateToast } from '@/components/Toast'
import {
  deleteChecklistItem,
  getOrCreateAreaProject,
  subscribeMarketingBuckets,
  subscribeMarketingTasks,
  updateChecklistItemStatus,
  updateChecklistItemTitle,
  deletePMTask,
} from '../api/marketingPlannerApi'
import { usePmAudit, logTaskSave } from '../hooks/usePmAudit'

/** Resolve a foto do usuário por nome exato (case-insensitive), só quando único. Mesmo critério de `PlannerBucketTree.findPhotoByName`. */
function findPhotoByName(name: string, users: UserRecord[]): string | undefined {
  const target = name.trim().toLowerCase()
  const matches = users.filter((u) => u.name.trim().toLowerCase() === target)
  return matches.length === 1 ? matches[0].photoURL : undefined
}

/**
 * Popover "quem está atribuído" (ELO-2661) — abre ao clicar no grupo de avatares
 * de uma linha da Grade, mostrando cada responsável em tamanho maior + nome.
 * Só existe nesta tela (pedido explícito do usuário): o Quadro (Kanban) já usa
 * o clique no card inteiro para abrir o modal de detalhe, e sobrepor um segundo
 * gatilho de clique ali seria conflitante.
 */
function AssigneePopover({ names, photoURLs, anchorRect, onClose }: {
  names: string[]
  photoURLs: (string | undefined)[]
  anchorRect: { top: number; bottom: number; left: number; right: number }
  onClose: () => void
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!popRef.current) return
    const popRect = popRef.current.getBoundingClientRect()
    const GAP = 6
    let top = anchorRect.bottom + GAP
    let left = anchorRect.left
    if (top + popRect.height + 8 > window.innerHeight) {
      top = Math.max(8, anchorRect.top - popRect.height - GAP)
    }
    if (left + popRect.width + 8 > window.innerWidth) {
      left = Math.max(8, window.innerWidth - popRect.width - 8)
    }
    setPos({ top, left })
  }, [anchorRect])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-assignee-popover]')) return
      onClose()
    }
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    // Fecha ao rolar/redimensionar em vez de tentar seguir a linha: o
    // popover é posicionado uma única vez (getBoundingClientRect no clique),
    // então rolar a tabela o deixava "flutuando" solto na tela, descolado da
    // linha que o abriu. Mesmo padrão de fechamento usado no menu ⋯ do
    // MarketingKanbanCard.
    function onScrollOrResize() { onClose() }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={popRef}
      data-assignee-popover=""
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        background: 'var(--eh-surface)',
        border: '1px solid var(--eh-border)',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        padding: 14,
        minWidth: 240,
        maxWidth: 300,
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--eh-text-3)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Atribuído{names.length > 1 ? 's' : ''}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {names.map((name, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UserAvatar name={name} photoURL={photoURLs[i]} size={56} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--eh-text)' }}>{name}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}

const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const STATUS_LABEL: Record<string, string> = {
  todo: 'A fazer',
  in_progress: 'Em andamento',
  done: 'Concluída',
}

// ELO-2654: hex crus (#dbeafe/#1d4ed8/#dcfce7) trocados por tokens — acompanham
// tema claro/escuro e marca, o que os literais ignoravam.
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  todo: { bg: 'var(--eh-surface-2)', text: 'var(--eh-text-3)' },
  in_progress: { bg: 'var(--eh-bar-track)', text: 'var(--eh-primary)' },
  done: { bg: 'var(--eh-success-bg)', text: 'var(--eh-success-fg)' },
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  normal: 'Normal',
  low: 'Baixa',
}

/**
 * ELO-2654: prioridade era texto cinza uniforme — o dado mais acionável da linha
 * renderizado mais fraco que um badge "Dentro do Prazo" que quase nunca muda.
 * Só urgente/alta ganham cor: destacar os quatro níveis não destacaria nada.
 */
const PRIORITY_STYLE: Record<string, CSSProperties> = {
  urgent: { color: 'var(--eh-danger)', fontWeight: 700 },
  high: { color: 'var(--eh-warn-fg)', fontWeight: 600 },
  normal: { color: 'var(--eh-text-3)' },
  low: { color: 'var(--eh-muted-4)' },
}

/**
 * Badge no padrão das telas novas (Biblioteca Digital, Audit Log): retângulo de
 * altura fixa, não pill. ELO-2654 — antes cada badge desta tela usava
 * `borderRadius: 20` + `padding: 2px 8px` + `fontWeight: 600`, vocabulário
 * diferente do resto do CoreHub.
 */
const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 22,
  padding: '0 9px',
  borderRadius: 6,
  fontSize: 11.5,
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

type ChecklistStatus = NonNullable<ChecklistItem['status']>

const CHECKLIST_STATUS_META: Record<ChecklistStatus, { label: string; fg: string; bg: string }> = {
  aguardando:  { label: 'Aguardando',  fg: 'var(--eh-danger)',     bg: 'var(--eh-danger-bg)'  },
  em_producao: { label: 'Em produção', fg: 'var(--eh-warn-fg)',    bg: 'var(--eh-warn-bg)'    },
  revisao:     { label: 'Revisão',     fg: 'var(--eh-primary)',    bg: 'var(--eh-bar-track)'  },
  refazer:     { label: 'Refazer',     fg: 'var(--eh-muted-2)',    bg: 'var(--eh-surface-2)'  },
  finalizado:  { label: 'Finalizado',  fg: 'var(--eh-success-fg)', bg: 'var(--eh-success-bg)' },
}

const STATUS_ORDER_CHECKLIST: ChecklistStatus[] = ['aguardando', 'em_producao', 'revisao', 'refazer', 'finalizado']

// Peso de ordenação por coluna
const STATUS_SORT_ORDER: Record<string, number> = { todo: 0, in_progress: 1, done: 2 }
const PRIORITY_SORT_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

type SortCol = 'status' | 'title' | 'category' | 'startDate' | 'dueDate' | 'priority' | 'situacao'

// ELO-2564: situação = prazo previsto (dueDate) vs. término real (completedAt) ou hoje.
// 'sem-prazo' exibe o mesmo badge verde de 'dentro-do-prazo' (sem prazo definido = sem atraso),
// mas é tratado à parte no critério de ordenação (sempre por último).
type Situacao = 'fora-do-prazo' | 'dentro-do-prazo' | 'sem-prazo'

// Peso de ordenação da coluna Situação: Fora do Prazo → Dentro do Prazo → sem prazo (sempre ao final)
const SITUACAO_SORT_ORDER: Record<Situacao, number> = { 'fora-do-prazo': 0, 'dentro-do-prazo': 1, 'sem-prazo': 99 }

const SITUACAO_META: Record<Situacao, { label: string; fg: string; bg: string }> = {
  'fora-do-prazo': { label: 'Fora do Prazo', fg: 'var(--eh-danger-fg)', bg: 'var(--eh-danger-bg)' },
  'dentro-do-prazo': { label: 'Dentro do Prazo', fg: 'var(--eh-success-fg)', bg: 'var(--eh-success-bg)' },
  'sem-prazo': { label: 'Dentro do Prazo', fg: 'var(--eh-success-fg)', bg: 'var(--eh-success-bg)' },
}

/**
 * Calcula a situação de prazo de uma tarefa (ELO-2564).
 * - Sem dueDate (concluída ou em aberto) → 'sem-prazo' (badge verde "Dentro do Prazo", mas ordena por último)
 * - Concluída + completedAt ≤ dueDate → dentro do prazo
 * - Concluída + completedAt > dueDate → fora do prazo
 * - Concluída sem completedAt registrado (caso legado) → dentro do prazo
 * - Em aberto + dueDate < hoje → fora do prazo
 * - Em aberto + dueDate ≥ hoje → dentro do prazo
 */
function computeSituacao(task: PMTask, today: Date): Situacao {
  const dueDate = toDate(task.dueDate)
  if (!dueDate) return 'sem-prazo'

  if (task.status === 'done') {
    const completedAt = toDate(task.completedAt)
    if (!completedAt) return 'dentro-do-prazo' // caso legado: concluída sem completedAt registrado
    return completedAt.getTime() <= dueDate.getTime() ? 'dentro-do-prazo' : 'fora-do-prazo'
  }

  return dueDate.getTime() < today.getTime() ? 'fora-do-prazo' : 'dentro-do-prazo'
}

function resolveStatus(item: ChecklistItem): ChecklistStatus {
  if (item.status) return item.status
  return item.isChecked ? 'finalizado' : 'aguardando'
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  const secs = (ts as { seconds?: number }).seconds
  return typeof secs === 'number' ? new Date(secs * 1000) : null
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtDateOrEmpty(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

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
        color: active ? 'var(--eh-surface)' : 'var(--eh-text-3)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

/**
 * Base de rota e título default por área (ELO-2936, com Pedagogia na
 * ELO-3182). `area` default `'marketing'` preserva o comportamento desta
 * tela para quem já a usa — Administrativo/Pedagogia passam
 * `area="administrativo"`/`area="pedagogia"` via router.
 */
const NAV_BASE: Record<'marketing' | 'administrativo' | 'pedagogia', string> = {
  marketing: '/pm-office-marketing',
  administrativo: '/pm-office-administrativo',
  pedagogia: '',
}
const DEFAULT_TITLE: Record<'marketing' | 'administrativo' | 'pedagogia', string> = {
  marketing: 'Marketing Diário',
  administrativo: 'Administrativo',
  pedagogia: 'Pedagogia',
}
const RESOURCE_BY_AREA: Record<'marketing' | 'administrativo' | 'pedagogia', 'pm-marketing' | 'pm-administrativo' | 'pm-pedagogia'> = {
  marketing: 'pm-marketing',
  administrativo: 'pm-administrativo',
  pedagogia: 'pm-pedagogia',
}

export function MarketingGradePage({ area = 'pedagogia' }: { area?: 'marketing' | 'administrativo' | 'pedagogia' } = {}) {
  const navigate = useNavigate()
  const navBase = NAV_BASE[area]
  // ELO-2654: nenhuma tela de Marketing usava useMediaQuery — a Grade não tinha
  // tratamento mobile nenhum.
  const isMobile = useMediaQuery('(max-width: 768px)')
  const { roleLevel, canWriteScreen } = useRole()
  const canSeeTemplates = true
  // ELO-1954: Viewer só pode ler a grade — sem mudar status de checklist nem editar tarefa.
  // ELO-2214: exceção por tela precisa afetar a escrita, não só a visibilidade.
  const canWrite = canWriteScreen()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectTitle, setProjectTitle] = useState(DEFAULT_TITLE[area])
  // ELO-2044: audit log das acoes humanas desta tela.
  const audit = usePmAudit(area, projectId, projectTitle)
  const [buckets, setBuckets] = useState<PMBucket[]>([])
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set())
  const [selectedTask, setSelectedTask] = useState<PMTask | null>(null)
  const [toastTask, setToastTask] = useState<{ task: PMTask; date: Date } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // Controla qual badge de subtarefa tem o dropdown aberto; chave: `${taskId}::${itemId}`
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  // Estado otimista local por tarefa: taskId → ChecklistItem[]
  const [localChecklistOverrides, setLocalChecklistOverrides] = useState<Record<string, ChecklistItem[]>>({})
  // Usuários do workspace (ELO-2661) — alimenta foto de perfil dos avatares de
  // responsável, aqui na tabela e no TaskDetailModal. Mesmo padrão de carga
  // client-side do MarketingQuadroPage (sem paginação — coleção pequena).
  const [users, setUsers] = useState<UserRecord[]>([])
  // Popover "quem está atribuído" (ELO-2661) — aberto ao clicar no grupo de
  // avatares de uma linha. `null` = fechado.
  const [assigneePopover, setAssigneePopover] = useState<{
    names: string[]
    photoURLs: (string | undefined)[]
    anchorRect: { top: number; bottom: number; left: number; right: number }
  } | null>(null)

  // Ordenação por coluna (padrão: dueDate asc — tarefas sem data no final)
  const [sortCol, setSortCol] = useState<SortCol | null>('dueDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Filtros por coluna
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterPriority, setFilterPriority] = useState<string[]>([])
  const [filterCategory, setFilterCategory] = useState<string[]>([])
  const [filterAssignee, setFilterAssignee] = useState<string[]>([])
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  // ELO-2564: filtro rápido "Fora do Prazo" (concluídas atrasadas + em aberto vencidas)
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false)

  useEffect(() => {
    // ELO-2936: para 'marketing' resolve exatamente como antes (via
    // `getMarketingProject` dentro de `getOrCreateAreaProject`); para
    // 'administrativo' cria o projeto singleton na 1ª visita (idempotente).
    getOrCreateAreaProject(area)
      .then((proj) => {
        setProjectId(proj.id)
        if (proj.title) setProjectTitle(proj.title)
      })
      .catch(() => { setError('Erro ao carregar projeto.'); setLoading(false) })
  }, [area])

  useEffect(() => {
    if (!projectId) return
    const unsub1 = subscribeMarketingBuckets(projectId, (b) => { setBuckets(b); setLoading(false) })
    const unsub2 = subscribeMarketingTasks(projectId, (incoming) => {
      setTasks(incoming)
      // Limpa overrides otimistas conforme os dados do Firestore chegam atualizados
      setLocalChecklistOverrides({})
    })
    return () => { unsub1(); unsub2() }
  }, [projectId])

  // Carrega usuários do workspace uma vez (ELO-2661) — mesmo shape de
  // MarketingQuadroPage.tsx, para resolver foto de perfil dos responsáveis.
  useEffect(() => {
    // No CoreHub esta tela lê a coleção `users` direto do Firestore, contornando
    // a `usersApi`. Aqui não há Firestore — e a `usersApi` em memória já devolve
    // o mesmo shape, então é ela quem serve (mesmo caminho que o Quadro usa).
    usersApi
      .listUsers()
      .then(setUsers)
      .catch(() => undefined)
  }, [])

  // Fecha dropdown de checklist ao clicar fora
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

  const bucketMap = useMemo(
    () => Object.fromEntries(buckets.map((b) => [b.id, b.name])),
    [buckets],
  )

  // Ciclo de ordenação: asc → desc → sem ordenação (bucket order)
  function handleSort(col: SortCol) {
    if (sortCol !== col) {
      setSortCol(col)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortCol(null)
      setSortDir('asc')
    }
  }

  const assigneeOptions = useMemo(() => {
    const all = tasks.flatMap((t) => t.assigneesNames ?? [])
    return [...new Set(all)].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [tasks])

  function handleClearAllFilters() {
    setFilterStatus([])
    setFilterPriority([])
    setFilterCategory([])
    setFilterAssignee([])
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterOverdueOnly(false)
  }

  // "Hoje" recalculado a cada render, sem hora — base de comparação p/ situação de prazo (ELO-2564)
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  // Ordenação + filtragem unificados: sort → filtros → busca textual
  const { filteredTasks, autoExpandSet } = useMemo(() => {
    const bucketOrder = Object.fromEntries(buckets.map((b, i) => [b.id, i]))

    const sorted = [...tasks].sort((a, b) => {
      if (!sortCol) {
        return (bucketOrder[a.bucketId] ?? 99) - (bucketOrder[b.bucketId] ?? 99)
      }
      switch (sortCol) {
        case 'dueDate': {
          const aD = toDate(a.dueDate)
          const bD = toDate(b.dueDate)
          if (!aD && !bD) return 0
          if (!aD) return 1  // sem data sempre ao final
          if (!bD) return -1
          return sortDir === 'asc' ? aD.getTime() - bD.getTime() : bD.getTime() - aD.getTime()
        }
        case 'startDate': {
          const aD = toDate(a.startDate)
          const bD = toDate(b.startDate)
          if (!aD && !bD) return 0
          if (!aD) return 1
          if (!bD) return -1
          return sortDir === 'asc' ? aD.getTime() - bD.getTime() : bD.getTime() - aD.getTime()
        }
        case 'status': {
          const diff = (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
          return sortDir === 'asc' ? diff : -diff
        }
        case 'priority': {
          const diff = (PRIORITY_SORT_ORDER[a.priority] ?? 99) - (PRIORITY_SORT_ORDER[b.priority] ?? 99)
          return sortDir === 'asc' ? diff : -diff
        }
        case 'title': {
          const diff = a.title.localeCompare(b.title, 'pt-BR')
          return sortDir === 'asc' ? diff : -diff
        }
        case 'category': {
          const aName = bucketMap[a.bucketId] ?? ''
          const bName = bucketMap[b.bucketId] ?? ''
          const diff = aName.localeCompare(bName, 'pt-BR')
          return sortDir === 'asc' ? diff : -diff
        }
        case 'situacao': {
          const aOrder = SITUACAO_SORT_ORDER[computeSituacao(a, today)]
          const bOrder = SITUACAO_SORT_ORDER[computeSituacao(b, today)]
          const diff = aOrder - bOrder
          return sortDir === 'asc' ? diff : -diff
        }
        default:
          return 0
      }
    })

    // Filtros cumulativos (AND)
    let result = sorted
    if (filterStatus.length > 0) result = result.filter((t) => filterStatus.includes(t.status))
    if (filterPriority.length > 0) result = result.filter((t) => filterPriority.includes(t.priority))
    if (filterCategory.length > 0) result = result.filter((t) => filterCategory.includes(t.bucketId))
    if (filterAssignee.length > 0) result = result.filter((t) => (t.assigneesNames ?? []).some((n) => filterAssignee.includes(n)))
    if (filterOverdueOnly) result = result.filter((t) => computeSituacao(t, today) === 'fora-do-prazo')
    if (filterDateFrom || filterDateTo) {
      result = result.filter((t) => {
        if (!t.dueDate) return false
        const sec = (t.dueDate as { seconds: number }).seconds
        const d = new Date(sec * 1000)
        const taskStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (filterDateFrom && taskStr < filterDateFrom) return false
        if (filterDateTo && taskStr > filterDateTo) return false
        return true
      })
    }

    // Busca textual
    const q = searchQuery.trim().toLowerCase()
    const expandSet = new Set<string>()
    if (q) {
      result = result.filter((t) => {
        const titleMatch = t.title.toLowerCase().includes(q)
        const checklistMatch = (t.checklist ?? []).some((item) => item.title.toLowerCase().includes(q))
        const bucketMatch = bucketMap[t.bucketId]?.toLowerCase().includes(q)
        if (checklistMatch) expandSet.add(t.id)
        return titleMatch || checklistMatch || bucketMatch
      })
    }

    return { filteredTasks: result, autoExpandSet: expandSet }
  }, [tasks, buckets, bucketMap, sortCol, sortDir, filterStatus, filterPriority, filterCategory, filterAssignee, filterOverdueOnly, filterDateFrom, filterDateTo, searchQuery, today])

  function getEffectiveChecklist(task: PMTask): ChecklistItem[] {
    return localChecklistOverrides[task.id] ?? task.checklist ?? []
  }

  function toggleExpand(taskId: string) {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function handleChecklistItemStatusChange(
    task: PMTask,
    itemId: string,
    status: ChecklistStatus,
  ) {
    if (!projectId) return
    // Atualização otimista imediata
    const current = getEffectiveChecklist(task)
    setLocalChecklistOverrides((prev) => ({
      ...prev,
      [task.id]: current.map((i) =>
        i.id === itemId ? { ...i, status, isChecked: status === 'finalizado' } : i,
      ),
    }))
    const previousItem = current.find((i) => i.id === itemId)
    const result = await updateChecklistItemStatus(
      projectId,
      task.bucketId,
      task,
      itemId,
      status,
    ).catch(() => ({ autoFilledStartDate: false, filledDate: undefined }))
    audit.logChecklistItem(
      'pm_checklist.item_status',
      task,
      { id: itemId, title: previousItem?.title },
      [{ field: 'status', before: previousItem?.status ?? null, after: status }],
    )
    if (result.autoFilledStartDate && result.filledDate) {
      setToastTask({ task, date: result.filledDate })
    }
  }

  // ELO-2654: alinhado ao padrão das telas novas (SortableTh da Biblioteca
  // Digital) — 10.5px / .05em / --eh-muted. O `--eh-muted-2` anterior dava
  // 2.6:1 sobre a superfície, reprovando WCAG AA.
  const thStyle: CSSProperties = {
    padding: '11px 12px',
    textAlign: 'left',
    fontSize: 10.5,
    fontWeight: 700,
    color: 'var(--eh-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--eh-border)',
    background: 'var(--eh-surface-2)',
  }

  /**
   * Cabeçalho ordenável acessível (ELO-2654). Antes era `<th onClick>`: não
   * focável por teclado, não anunciado como acionável, sem `aria-sort`. O botão
   * interno mantém a área de clique da célula inteira via margem negativa.
   */
  function SortTh({ col, label, align = 'left' }: { col: SortCol; label: string; align?: 'left' | 'right' | 'center' }) {
    const isActive = sortCol === col
    return (
      <th
        scope="col"
        style={{ ...thStyle, textAlign: align }}
        aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          onClick={() => handleSort(col)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            margin: '-11px -12px', padding: '11px 12px',
            background: 'none', border: 'none', cursor: 'pointer',
            font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit',
            color: isActive ? 'var(--eh-primary)' : 'inherit',
          }}
        >
          {label}
          {sortIcon(col)}
        </button>
      </th>
    )
  }

  // Indicador de ordenação inline para cabeçalhos de coluna
  function sortIcon(col: SortCol) {
    const isActive = sortCol === col
    return (
      <span
        aria-hidden="true"
        style={{
          marginLeft: 3,
          fontSize: 10,
          opacity: isActive ? 1 : 0.25,
          color: isActive ? 'var(--eh-primary)' : 'inherit',
          fontWeight: 'normal',
        }}
      >
        {isActive ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    )
  }

  const hasActiveFilters =
    filterStatus.length > 0 || filterPriority.length > 0 || filterCategory.length > 0 || filterAssignee.length > 0 || filterDateFrom || filterDateTo || filterOverdueOnly || searchQuery.trim()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--eh-text-2)' }}>
        Carregando...
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--eh-danger)' }}>
        {error}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--eh-bg)', fontFamily: "'Hanken Grotesk', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      {/* HEADER — ELO-2654: `flexWrap` + busca fluida; antes era `space-between`
          rígido com input de 280px fixos, que estourava em telas estreitas. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          padding: isMobile ? '16px 16px 12px' : '20px 24px 14px',
          background: 'var(--eh-surface)',
          borderBottom: '1px solid var(--eh-border)',
          flexShrink: 0,
          gap: 12,
        }}
      >
        {/* ELO-2654: título era 17px sem subtítulo — mal se distinguia do corpo.
            Agora segue a escala das telas novas (Biblioteca Digital, Audit Log). */}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 27, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.1, color: 'var(--eh-text)' }}>
            {projectTitle}
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--eh-text-2)' }}>
            Tarefas, subtarefas e prazos em formato de tabela.
          </p>
        </div>
        {/* ELO-2688: minWidth 0 + maxWidth 100% — este container (busca + as 4
            abas) é item flex e, por padrão, min-width:auto o impede de encolher
            abaixo do conteúdo. As abas em nowrap somam ~369px, então ele
            estourava o pai (305px) e arrastava a BUSCA junto para fora da tela.
            Com min-width 0 ele cede, a busca volta para dentro e o overflowX
            das abas (abaixo) finalmente contém a faixa que sobra. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
          <div style={{ position: 'relative', width: isMobile ? '100%' : 280, maxWidth: '100%', minWidth: 0 }}>
            <span
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 13,
                color: 'var(--eh-muted-2)',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Buscar tarefas, subtarefas e categorias..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                paddingLeft: 30,
                paddingRight: searchQuery ? 28 : 10,
                paddingTop: 6,
                paddingBottom: 6,
                fontSize: 13,
                border: '1px solid var(--eh-border)',
                borderRadius: 8,
                background: 'var(--eh-bg)',
                color: 'var(--eh-text-strong)',
                outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: 'var(--eh-muted-2)',
                  lineHeight: 1,
                  padding: 0,
                }}
                aria-label="Limpar busca"
              >
                ✕
              </button>
            )}
          </div>
          {/* Sem overflowX aqui, as 4 abas (com busca + título já ocupando a
              linha) empurravam a largura da página inteira e criavam scroll
              horizontal global — mesmo tratamento já aplicado ao Calendário,
              ao Kanban e ao Templates de Marketing (ELO-2670/2672). */}
          <div style={{ display: 'flex', gap: 4, overflowX: isMobile ? 'auto' : undefined, maxWidth: '100%', paddingBottom: isMobile ? 2 : undefined }}>
            <NavButton label="Quadro" active={false} onClick={() => navigate(`${navBase}/quadro`)} />
            <NavButton label="Grade" active={true} onClick={() => undefined} />
            <NavButton label="Calendário" active={false} onClick={() => navigate(`${navBase}/calendario`)} />
            {canSeeTemplates && (
              <NavButton label="Templates" active={false} onClick={() => navigate(`${navBase}/templates`)} />
            )}
          </div>
        </div>
      </div>

      {/* FILTROS */}
      <MarketingGradeFilters
        tasks={tasks}
        bucketMap={bucketMap}
        filterStatus={filterStatus}
        filterPriority={filterPriority}
        filterCategory={filterCategory}
        filterAssignee={filterAssignee}
        filterDateFrom={filterDateFrom}
        filterDateTo={filterDateTo}
        filterOverdueOnly={filterOverdueOnly}
        assigneeOptions={assigneeOptions}
        onFilterStatusChange={setFilterStatus}
        onFilterPriorityChange={setFilterPriority}
        onFilterCategoryChange={setFilterCategory}
        onAssigneeChange={setFilterAssignee}
        onFilterDateFromChange={setFilterDateFrom}
        onFilterDateToChange={setFilterDateTo}
        onFilterOverdueOnlyChange={setFilterOverdueOnly}
        onClearAllFilters={handleClearAllFilters}
      />

      {/* TABLE */}
      {/* minWidth: 0 — sem isso, este item do flex-col raiz não consegue
          encolher abaixo do conteúdo do filho (a tabela com minWidth: 980),
          e ACHATA a rolagem interna: a barra de overflowX-auto da linha
          abaixo nunca aparece, e o texto some cortado na borda da tela em
          vez de ficar acessível por scroll. Mesma causa raiz do stepper do
          ADELO (ELO-2683) — item flex sem min-width:0 empurra o layout. */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: isMobile ? '12px' : '16px 20px' }}>
        <div
          style={{
            background: 'var(--eh-surface)',
            borderRadius: 12,
            border: '1px solid var(--eh-border)',
            // ELO-2654: era `overflow: hidden` sem overflowX — com 9 colunas
            // `nowrap`, em ~390px as colunas da direita (Situação, Prioridade)
            // ficavam CORTADAS, sem nenhuma forma de alcançá-las. Agora rola.
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
        >
          {/* ELO-2689: no mobile o conteúdo vira card empilhado (ver taskCard
              abaixo), então nem o minWidth de 980px nem o cabeçalho de 9
              colunas fazem sentido — sem tirá-los a tabela continuaria
              forçando rolagem lateral mesmo já tendo cards dentro. */}
          <table style={{ width: '100%', minWidth: isMobile ? 0 : 980, borderCollapse: 'collapse' }}>
            <thead style={isMobile ? { display: 'none' } : undefined}>
              <tr>
                {/* ELO-2654: alinhamento por natureza do dado — texto à esquerda,
                    datas à direita (com tabular-nums na célula). Antes 7 das 9
                    colunas eram centralizadas, o que impede a varredura vertical:
                    sem borda comum, o olho não encontra a coluna. */}
                <SortTh col="status" label="Status" />
                <SortTh col="title" label="Tarefa" />
                <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Subtarefas</th>
                <SortTh col="category" label="Categoria" />
                <th scope="col" style={thStyle}>Atribuído</th>
                <SortTh col="startDate" label="Início" align="right" />
                <SortTh col="dueDate" label="Término" align="right" />
                <SortTh col="situacao" label="Situação" />
                <SortTh col="priority" label="Prioridade" />
              </tr>
            </thead>
            <tbody>
              {filteredTasks.flatMap((task) => {
                const dueDate = toDate(task.dueDate)
                const startDate = toDate(task.startDate)
                const isDone = task.status === 'done'
                const hasChecklist = (task.checklistTotal ?? 0) > 0
                const isExpanded = expandedTaskIds.has(task.id) || autoExpandSet.has(task.id)
                const statusStyle = STATUS_COLOR[task.status] ?? STATUS_COLOR['todo']
                const effectiveChecklist = getEffectiveChecklist(task)
                const checkComplete =
                  (task.checklistDone ?? 0) === (task.checklistTotal ?? 0) &&
                  (task.checklistTotal ?? 0) > 0
                const situacao = computeSituacao(task, today)
                // ELO-2654: `isOverdue` tinha critério PRÓPRIO (`dueDate < today &&
                // status !== 'done'`), divergente de `computeSituacao`. Numa tarefa
                // concluída COM atraso, a data ficava preta enquanto a coluna
                // Situação ao lado dizia "Fora do Prazo" — dois sinais contraditórios
                // na mesma linha. Agora a data deriva da MESMA fonte do badge.
                const isOverdue = situacao === 'fora-do-prazo'

                const taskRow = (
                  <tr
                    key={task.id}
                    style={{
                      borderBottom: '1px solid var(--eh-border-child-row)',
                      // ELO-2654: o fundo esverdeado saiu — "concluída" já era dito
                      // pelo badge de STATUS e pelo título riscado; o terceiro sinal
                      // só sujava a varredura vertical da tabela.
                      background: 'var(--eh-surface)',
                      transition: 'background .1s',
                    }}
                  >
                    {/* status badge */}
                    <td style={{ padding: '12px', width: 122 }}>
                      <span style={{ ...CHIP, color: statusStyle.text, background: statusStyle.bg }}>
                        {STATUS_LABEL[task.status] ?? task.status}
                      </span>
                    </td>
                    {/* título clicável */}
                    <td style={{ padding: '12px', maxWidth: 340 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {hasChecklist && (
                          <button
                            onClick={() => toggleExpand(task.id)}
                            // ELO-2654: o SVG vinha por dangerouslySetInnerHTML, então
                            // o nome acessível era vazio — botão anônimo para leitor de tela.
                            aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} subtarefas de ${task.title}`}
                            aria-expanded={isExpanded}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 2,
                              display: 'inline-flex',
                              color: 'var(--eh-text-2)',
                              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                              transition: 'transform .15s',
                              flexShrink: 0,
                            }}
                            dangerouslySetInnerHTML={{ __html: CHEVRON }}
                          />
                        )}
                        {/* ELO-2654: era <span onClick> — não focável, não acionável por
                            teclado. Vira <button> com hover/focus por CSS (a versão
                            anterior mutava style.color direto, sem equivalente de foco). */}
                        <button
                          type="button"
                          onClick={() => setSelectedTask(task)}
                          className="eh-task-title"
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            textAlign: 'left',
                            font: 'inherit',
                            fontSize: 13.5,
                            color: isDone ? 'var(--eh-text-2)' : 'var(--eh-text-strong)',
                            textDecoration: isDone ? 'line-through' : 'none',
                            lineHeight: 1.4,
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {task.title}
                        </button>
                        {task.recurrence && (
                          <span
                            title="Tarefa recorrente"
                            style={{ ...CHIP, height: 18, fontSize: 10.5, padding: '0 6px', color: 'var(--eh-primary)', background: 'var(--eh-bar-track)', flexShrink: 0 }}
                          >
                            ↻{task.recurrence.pattern === 'business-days' ? ' Dias úteis' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* subtarefas */}
                    <td style={{ padding: '12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {(task.checklistTotal ?? 0) > 0 ? (
                        <span
                          style={{
                            ...CHIP,
                            height: 20,
                            fontSize: 11,
                            gap: 3,
                            fontVariantNumeric: 'tabular-nums',
                            color: checkComplete ? 'var(--eh-success-fg)' : 'var(--eh-text-3)',
                            background: checkComplete ? 'var(--eh-success-bg)' : 'var(--eh-surface-2)',
                          }}
                        >
                          {checkComplete ? '✓ ' : ''}{task.checklistDone ?? 0}/{task.checklistTotal}
                        </span>
                      ) : null}
                    </td>
                    {/* bucket */}
                    <td style={{ padding: '12px', fontSize: 12.5, color: 'var(--eh-text-2)', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {bucketMap[task.bucketId] ?? '—'}
                    </td>
                    {/* assignees — clicável (ELO-2661): abre popover com foto + nome de cada responsável em tamanho maior. */}
                    <td style={{ padding: '12px' }}>
                      {(task.assigneesNames ?? []).length > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            const names = task.assigneesNames ?? []
                            const rect = e.currentTarget.getBoundingClientRect()
                            setAssigneePopover({
                              names,
                              photoURLs: names.map((name) => findPhotoByName(name, users)),
                              anchorRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
                            })
                          }}
                          title="Ver atribuídos"
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
                        >
                          <AssigneeAvatars
                            names={task.assigneesNames ?? []}
                            photoURLs={(task.assigneesNames ?? []).map((name) => findPhotoByName(name, users))}
                            max={3}
                            size={24}
                          />
                        </button>
                      ) : (
                        <span style={{ color: 'var(--eh-border-hover)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    {/* início — ELO-2654: tabular-nums + à direita, para os dígitos
                        ficarem na mesma coluna vertical em vez de dançar de largura */}
                    <td style={{ padding: '12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--eh-text-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDateOrEmpty(startDate)}
                      </span>
                    </td>
                    {/* término */}
                    <td style={{ padding: '12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <span
                        style={{
                          fontSize: 12.5,
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: isOverdue ? 700 : 400,
                          color: isOverdue ? 'var(--eh-danger-fg)' : 'var(--eh-text-2)',
                        }}
                      >
                        {fmtDate(dueDate)}
                      </span>
                    </td>
                    {/* situação (ELO-2564) */}
                    <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                      <span style={{ ...CHIP, color: SITUACAO_META[situacao].fg, background: SITUACAO_META[situacao].bg }}>
                        {SITUACAO_META[situacao].label}
                      </span>
                    </td>
                    {/* priority — ELO-2654: era cinza uniforme; urgente/alta ganham cor */}
                    <td style={{ padding: '12px', fontSize: 12.5, whiteSpace: 'nowrap', ...(PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE['normal']) }}>
                      {PRIORITY_LABEL[task.priority] ?? task.priority}
                    </td>
                  </tr>
                )

                /**
                 * ELO-2689: no mobile a tabela de 9 colunas só era legível
                 * arrastando de lado — o título da tarefa, que é o dado mais
                 * importante, ficava cortado já na primeira posição. Aqui cada
                 * tarefa vira um card empilhado: título em cima (com o mesmo
                 * botão de expandir subtarefas), badges de status/situação/
                 * prioridade numa faixa, e os demais campos em pares
                 * rótulo/valor. Mesmos dados, mesma interação, sem rolagem
                 * lateral. Padrão já usado em Escolas/Catálogo do CoreHub.
                 */
                const taskCard = (
                  <tr key={task.id}>
                    <td colSpan={9} style={{ padding: 0, borderBottom: '1px solid var(--eh-border-child-row)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: 'var(--eh-surface)' }}>
                        {/* linha 1: chevron + título */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          {hasChecklist && (
                            <button
                              onClick={() => toggleExpand(task.id)}
                              aria-label={`${isExpanded ? 'Recolher' : 'Expandir'} subtarefas de ${task.title}`}
                              aria-expanded={isExpanded}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                                display: 'inline-flex', color: 'var(--eh-text-2)', flexShrink: 0, marginTop: 1,
                                transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                                transition: 'transform .15s',
                              }}
                              dangerouslySetInnerHTML={{ __html: CHEVRON }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedTask(task)}
                            className="eh-task-title"
                            style={{
                              background: 'none', border: 'none', padding: 0, textAlign: 'left',
                              cursor: 'pointer', font: 'inherit',
                              fontSize: 14, fontWeight: 600, lineHeight: 1.3, minWidth: 0, flex: 1,
                              color: isDone ? 'var(--eh-text-2)' : 'var(--eh-text-strong)',
                              textDecoration: isDone ? 'line-through' : 'none',
                            }}
                          >
                            {task.title}
                          </button>
                          {task.recurrence && (
                            <span
                              title="Tarefa recorrente"
                              style={{ ...CHIP, height: 18, fontSize: 10.5, padding: '0 6px', color: 'var(--eh-primary)', background: 'var(--eh-bar-track)', flexShrink: 0 }}
                            >
                              ↻{task.recurrence.pattern === 'business-days' ? ' Dias úteis' : ''}
                            </span>
                          )}
                        </div>

                        {/* linha 2: badges */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: hasChecklist ? 22 : 0 }}>
                          <span style={{ ...CHIP, color: statusStyle.text, background: statusStyle.bg }}>
                            {STATUS_LABEL[task.status] ?? task.status}
                          </span>
                          <span style={{ ...CHIP, color: SITUACAO_META[situacao].fg, background: SITUACAO_META[situacao].bg }}>
                            {SITUACAO_META[situacao].label}
                          </span>
                          <span style={{ fontSize: 12, ...(PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE['normal']) }}>
                            {PRIORITY_LABEL[task.priority] ?? task.priority}
                          </span>
                          {(task.checklistTotal ?? 0) > 0 && (
                            <span
                              style={{
                                ...CHIP, height: 20, fontSize: 11, gap: 3, fontVariantNumeric: 'tabular-nums',
                                color: checkComplete ? 'var(--eh-success-fg)' : 'var(--eh-text-3)',
                                background: checkComplete ? 'var(--eh-success-bg)' : 'var(--eh-surface-2)',
                              }}
                            >
                              {checkComplete ? '✓ ' : ''}{task.checklistDone ?? 0}/{task.checklistTotal}
                            </span>
                          )}
                        </div>

                        {/* linha 3: categoria + atribuídos + datas, em pares rótulo/valor */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', paddingLeft: hasChecklist ? 22 : 0, fontSize: 12 }}>
                          <span style={{ color: 'var(--eh-text-2)' }}>
                            <span style={{ color: 'var(--eh-muted-2)' }}>Categoria: </span>
                            {bucketMap[task.bucketId] ?? '—'}
                          </span>
                          {dueDate && (
                            <span style={{ color: isOverdue ? 'var(--eh-danger-fg)' : 'var(--eh-text-2)', fontWeight: isOverdue ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ color: 'var(--eh-muted-2)', fontWeight: 400 }}>Término: </span>
                              {fmtDate(dueDate)}
                            </span>
                          )}
                          {startDate && (
                            <span style={{ color: 'var(--eh-text-2)', fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ color: 'var(--eh-muted-2)' }}>Início: </span>
                              {fmtDateOrEmpty(startDate)}
                            </span>
                          )}
                          {(task.assigneesNames ?? []).length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                const names = task.assigneesNames ?? []
                                const rect = e.currentTarget.getBoundingClientRect()
                                setAssigneePopover({
                                  names,
                                  photoURLs: names.map((name) => findPhotoByName(name, users)),
                                  anchorRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
                                })
                              }}
                              title="Ver atribuídos"
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                            >
                              <AssigneeAvatars
                                names={task.assigneesNames ?? []}
                                photoURLs={(task.assigneesNames ?? []).map((name) => findPhotoByName(name, users))}
                                max={3}
                                size={22}
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )

                const checklistRows = hasChecklist && isExpanded
                  ? effectiveChecklist.map((item) => {
                      const currentStatus = resolveStatus(item)
                      const meta = CHECKLIST_STATUS_META[currentStatus]
                      const dropKey = `${task.id}::${item.id}`
                      const isDropdownOpen = openDropdownId === dropKey

                      return (
                        <tr
                          key={`${task.id}-${item.id}`}
                          // ELO-2654: #fafafa cru ignorava tema/marca → token.
                          style={{ borderBottom: '1px solid var(--eh-border-child-row)', background: 'var(--eh-surface-2)' }}
                        >
                          {/* célula de badge + dropdown */}
                          <td style={{ padding: '7px 12px', textAlign: 'center', position: 'relative' }}>
                            <div
                              style={{ position: 'relative', display: 'inline-block' }}
                              data-checklist-dropdown=""
                            >
                              <button
                                type="button"
                                onClick={() => canWrite && setOpenDropdownId(isDropdownOpen ? null : dropKey)}
                                disabled={!canWrite}
                                title={!canWrite ? 'Somente leitura — perfil Viewer' : undefined}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: meta.fg,
                                  background: meta.bg,
                                  padding: '2px 6px',
                                  borderRadius: 20,
                                  border: 'none',
                                  cursor: canWrite ? 'pointer' : 'default',
                                  lineHeight: 1.5,
                                  whiteSpace: 'nowrap',
                                  opacity: canWrite ? 1 : 0.75,
                                }}
                              >
                                {meta.label}
                              </button>
                              {isDropdownOpen && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    zIndex: 50,
                                    background: 'var(--eh-surface)',
                                    border: '1px solid var(--eh-border)',
                                    borderRadius: 8,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                    padding: 4,
                                    minWidth: 120,
                                    marginTop: 2,
                                  }}
                                  data-checklist-dropdown=""
                                >
                                  {STATUS_ORDER_CHECKLIST.map((s) => {
                                    const m = CHECKLIST_STATUS_META[s]
                                    const isActive = currentStatus === s
                                    return (
                                      <button
                                        key={s}
                                        type="button"
                                        onClick={() => {
                                          setOpenDropdownId(null)
                                          void handleChecklistItemStatusChange(task, item.id, s)
                                        }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          textAlign: 'left',
                                          fontSize: 11,
                                          fontWeight: isActive ? 700 : 500,
                                          color: m.fg,
                                          background: isActive ? m.bg : 'transparent',
                                          padding: '4px 8px',
                                          borderRadius: 5,
                                          border: 'none',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {m.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                          <td
                            colSpan={8}
                            style={{
                              padding: '7px 12px 7px 8px',
                              fontSize: 12.5,
                              color: currentStatus === 'finalizado' ? 'var(--eh-muted-2)' : 'var(--eh-text-3)',
                              textDecoration: currentStatus === 'finalizado' ? 'line-through' : 'none',
                            }}
                          >
                            {item.title}
                          </td>
                        </tr>
                      )
                    })
                  : []

                return [isMobile ? taskCard : taskRow, ...checklistRows]
              })}
              {filteredTasks.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--eh-muted-2)', fontSize: 13 }}>
                    {hasActiveFilters ? (
                      <span>
                        Nenhuma tarefa corresponde aos filtros aplicados.{' '}
                        <button
                          type="button"
                          onClick={() => { handleClearAllFilters(); setSearchQuery('') }}
                          style={{
                            fontSize: 13,
                            color: 'var(--eh-primary)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            padding: 0,
                          }}
                        >
                          Limpar todos os filtros
                        </button>
                      </span>
                    ) : (
                      'Nenhuma tarefa encontrada.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TOAST — startDate auto-fill */}
      {toastTask && (
        <StartDateToast
          date={toastTask.date}
          onOpenTask={() => { setSelectedTask(toastTask.task); setToastTask(null) }}
          onClose={() => setToastTask(null)}
        />
      )}

      {assigneePopover && (
        <AssigneePopover
          names={assigneePopover.names}
          photoURLs={assigneePopover.photoURLs}
          anchorRect={assigneePopover.anchorRect}
          onClose={() => setAssigneePopover(null)}
        />
      )}

      <TaskDetailModal
        task={selectedTask}
        open={selectedTask !== null}
        users={users}
        showRecurrence
        readOnly={!canWrite}
        onClose={() => setSelectedTask(null)}
        onStartDateAutoFilled={(t, date) => setToastTask({ task: t, date })}
        onUpdateChecklistItemStatus={
          selectedTask
            ? (itemId, status) =>
                handleChecklistItemStatusChange(selectedTask, itemId, status)
            : undefined
        }
        onRenameChecklistItem={
          selectedTask && projectId
            ? async (itemId, newTitle) => {
                const previousTitle = (selectedTask.checklist ?? []).find((c) => c.id === itemId)?.title
                await updateChecklistItemTitle(
                  projectId,
                  selectedTask.bucketId,
                  selectedTask.id,
                  itemId,
                  newTitle,
                  selectedTask.checklist ?? [],
                )
                audit.logChecklistItem(
                  'pm_checklist.item_update',
                  selectedTask,
                  { id: itemId, title: newTitle },
                  [{ field: 'titulo', before: previousTitle ?? null, after: newTitle }],
                )
              }
            : undefined
        }
        onDeleteChecklistItem={
          selectedTask && projectId
            ? async (itemId) => {
                const removed = (selectedTask.checklist ?? []).find((c) => c.id === itemId)
                await deleteChecklistItem(
                  projectId,
                  selectedTask.bucketId,
                  selectedTask.id,
                  itemId,
                  selectedTask.checklist ?? [],
                )
                audit.logChecklistItem('pm_checklist.item_delete', selectedTask, {
                  id: itemId,
                  title: removed?.title,
                })
              }
            : undefined
        }
        onDelete={
          selectedTask && projectId
            ? async (task) => {
                await deletePMTask(projectId, task.bucketId, task.id)
                audit.logTask('pm_task.delete', { id: task.id, title: task.title }, {
                  bucketId: task.bucketId,
                })
                setSelectedTask(null)
              }
            : undefined
        }
      />
    </div>
  )
}
