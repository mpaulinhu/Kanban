import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay, MeasuringStrategy, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { CSSProperties, ReactNode } from 'react'
import type { ChecklistItem, PMBucket, PMOfficeLabel, PMTask, RecurrenceConfig } from './types/pmOffice'
import { usersApi } from './api/usersApi'
import type { UserRecord } from './api/usersApi'
import {
  addChecklistItem,
  cloneTask,
  createMarketingBucket,
  createMarketingTask,
  deleteChecklistItem,
  getOrCreateAreaProject,
  getTaskSubtasks,
  markTaskDone,
  moveTaskToBucket,
  renameBucket,
  reorderBuckets,
  reorderTasksInBucket,
  setPMTaskArchived,
  subscribeMarketingBuckets,
  subscribeMarketingTasks,
  subscribePMOfficeLabels,
  toggleChecklistItem,
  updateChecklistItemStatus,
  updateChecklistItemTitle,
  deletePMTask,
} from './api/marketingPlannerApi'
import { deletePMBucket } from './api/pmOfficeApi'
import { usePmAudit } from './hooks/usePmAudit'
import { diffFields } from './utils/diffFields'
import { MarketingKanbanCard } from './components/MarketingKanbanCard'
import { LabelFilterDropdown, NO_LABEL_FILTER_KEY } from './components/LabelFilterDropdown'
import { TaskDetailModal } from './components/TaskDetailModal'
import { NewMarketingTaskModal } from './components/NewMarketingTaskModal'
import { TeamModal } from './components/TeamModal'
import { ActionToast, StartDateToast } from '@/components/Toast'
import { useRole } from '@/hooks/useRole'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useImmersive } from '@/layouts/ImmersiveContext'

const PLUS_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'

const COLUMN_ACCENT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4']

/**
 * Base de rota por área. No CoreHub cada área tem seu próprio prefixo
 * (`/pm-office-marketing` etc.); aqui só existe a Pedagogia, então a base é
 * a raiz — as telas ficam em `/quadro`, `/grade`, `/calendario`,
 * `/templates` (ver `main.tsx`).
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

/**
 * `pedagogia` (ELO-3182, refinamento visual — 2ª rodada: "os botões são
 * caixas brancas sólidas... no Trello são transparentes, texto branco,
 * ganham fundo translúcido só no hover"). Repouso: sem fundo/borda (via
 * classe `.eh-pm-header-btn`, que também cobre o `:hover` — não declarável
 * inline). Ativo ("Quadro"): fundo translúcido mais forte + borda, via
 * `data-active` (mesma classe lê o atributo). Default `false` preserva o
 * visual atual (fundo sólido claro/`--eh-primary`, sempre visível, sem
 * classe nenhuma) para Marketing/Administrativo, sem nenhuma mudança de
 * pixel.
 */
function NavButton({ label, active, onClick, pedagogia = false }: { label: string; active: boolean; onClick: () => void; pedagogia?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={pedagogia ? 'eh-pm-header-btn' : undefined}
      data-active={pedagogia ? active : undefined}
      style={
        pedagogia
          ? {
              padding: '6px 18px',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid transparent',
              color: 'var(--eh-pm-header-fg)',
              cursor: 'pointer',
              transition: 'background .12s, border-color .12s',
            }
          : {
              padding: '6px 18px',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 500,
              border: `1px solid ${active ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
              background: active ? 'var(--eh-primary)' : 'var(--eh-surface)',
              color: active ? 'var(--eh-surface)' : 'var(--eh-text-3)',
              cursor: 'pointer',
              transition: 'background .12s, border-color .12s',
            }
      }
    >
      {label}
    </button>
  )
}

// Wrapper sortable para colunas do Quadro. Os listeners ficam apenas no cabeçalho
// para não interferir com o DnD vertical de tarefas dentro da coluna.
function SortableColumn({
  id,
  outerStyle,
  headerContent,
  children,
}: {
  id: string
  outerStyle: CSSProperties
  headerContent: ReactNode
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { type: 'column' } })
  return (
    <div
      ref={setNodeRef}
      style={{
        ...outerStyle,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* Área de drag restrita ao cabeçalho para não conflitar com o DnD de tarefas */}
      <div
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        {...attributes}
        {...listeners}
      >
        {headerContent}
      </div>
      {children}
    </div>
  )
}

// ── Modal de confirmação de exclusão de coluna ────────────────────────────────

function DeleteConfirmModal({
  title,
  subtitle,
  confirmLabel,
  cancelLabel,
  deleting,
  onConfirm,
  onCancel,
}: {
  title: string
  subtitle: string
  confirmLabel: string
  cancelLabel: string
  deleting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.42)', backdropFilter: 'blur(3px)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--eh-surface)', borderRadius: 16,
          width: '100%', maxWidth: 400,
          padding: '28px 28px 24px',
          boxShadow: '0 24px 64px rgba(15,23,42,0.2)',
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--eh-text)', margin: '0 0 8px' }}>
          {title}
        </p>
        <p style={{ fontSize: 13.5, color: 'var(--eh-text-3)', margin: '0 0 24px', lineHeight: 1.5 }}>
          {subtitle}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              flex: 1, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
              color: 'var(--eh-surface)', background: 'var(--eh-text-strong)',
              border: 'none', borderRadius: 9, padding: '11px 0',
              cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.5 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              flex: 1, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
              color: 'var(--eh-danger)', background: 'transparent',
              border: '1.5px solid var(--eh-danger)', borderRadius: 9, padding: '11px 0',
              cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.5 : 1,
            }}
          >
            {deleting ? 'Excluindo…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Retorna a chave de dia (YYYY-M-D) para comparação de dueDate ignorando horas
function getDueDateDay(task: PMTask): string | null {
  if (!task.dueDate) return null
  const secs = (task.dueDate as { seconds: number }).seconds
  if (typeof secs !== 'number') return null
  const d = new Date(secs * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * No CoreHub este componente serve três áreas (Marketing, Administrativo,
 * Pedagogia) via prop `area`, e só a Pedagogia recebeu o tratamento visual
 * estilo Trello. Aqui a área é fixa em 'pedagogia': é esse o visual que se
 * quis extrair, e prender o valor mantém vivos os ramos `isPedagogia` sem
 * arrastar a parametrização das outras duas.
 */
export function KanbanBoardPage() {
  const area = 'pedagogia' as const
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const navBase = NAV_BASE[area]
  // Botão "ampliar" do quadro — esconde o cabeçalho do app (ver ImmersiveContext).
  const { immersive, setImmersive } = useImmersive()
  const { canWriteScreen } = useRole()
  const canWrite = canWriteScreen()
  // ELO-2177: tarefa clicada em "Minhas Tarefas" (Dashboard) — repassada para
  // o Kanban rolar até ela (nos dois eixos) e destacá-la temporariamente.
  // Marketing não tem rota granular por bucket (ver buildTaskLink em
  // pmOfficeApi.ts), então o mesmo efeito acontece dentro do quadro único
  // via query string, em vez de navegação para uma página filha.
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightTaskId = searchParams.get('taskId')
  // ELO-2177: guarda o id JÁ destacado, não um boolean — evita o loop em que o
  // efeito de reset (2s) reabre a "trava" e o efeito de aplicar dispara de novo
  // para o MESMO highlightTaskId (que nunca muda, pois some da URL só ao final).
  const consumedTaskIdRef = useRef<string | null>(null)
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null)
  // ELO-2177: remove `?taskId=` da URL depois que o destaque foi consumido, sem
  // criar entrada nova no histórico (senão o botão "voltar" fica poluído).
  function clearHighlightParam() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('taskId')
        return next
      },
      { replace: true },
    )
  }
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectTitle, setProjectTitle] = useState(DEFAULT_TITLE[area])
  const [projectTeam, setProjectTeam] = useState<string[]>([])
  // ELO-2044: audit log das ações humanas deste quadro.
  const audit = usePmAudit(area, projectId, projectTitle)
  const [buckets, setBuckets] = useState<PMBucket[]>([])
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<UserRecord[]>([])
  // ELO-3182: dicionário de etiquetas do projeto + filtro selecionado (ids +
  // possivelmente NO_LABEL_FILTER_KEY) + toggle de tarefas arquivadas.
  // Vazio em Marketing/Administrativo hoje (nenhuma etiqueta gravada lá) —
  // aditivo por construção, não muda o comportamento dessas duas áreas.
  const [labels, setLabels] = useState<PMOfficeLabel[]>([])
  const [labelFilter, setLabelFilter] = useState<string[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  // ELO-3182: feedback de arquivar/desarquivar (correção do gate ux-ui-reviewer
  // — o card sumindo/reaparecendo sem nenhum aviso era ambíguo com exclusão
  // ou erro silencioso). `undo` reaplica a transição oposta.
  const [archiveToast, setArchiveToast] = useState<{ message: string; variant: 'success' | 'error'; undo?: () => void } | null>(null)

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [toastTask, setToastTask] = useState<{ task: PMTask; date: Date } | null>(null)
  const [expandedDoneBuckets, setExpandedDoneBuckets] = useState<Set<string>>(new Set())
  const [localTaskOrder, setLocalTaskOrder] = useState<Record<string, string[]>>({})
  const [localBucketOrder, setLocalBucketOrder] = useState<string[]>([])

  // Modal "Nova Tarefa"
  const [newTaskBucket, setNewTaskBucket] = useState<PMBucket | null>(null)

  const [addingBucket, setAddingBucket] = useState(false)
  const [newBucketName, setNewBucketName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [deleteBucketTarget, setDeleteBucketTarget] = useState<PMBucket | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ELO-2155: exclusão de tarefa via menu do card
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<PMTask | null>(null)
  const [deletingTask, setDeletingTask] = useState(false)

  // ELO-2154: menu de 3 pontos para opções de coluna
  const [openMenuBucketId, setOpenMenuBucketId] = useState<string | null>(null)
  const [menuAnchorRect, setMenuAnchorRect] = useState<{ top: number; bottom: number; left: number; right: number; width: number } | null>(null)
  const [editingBucketId, setEditingBucketId] = useState<string | null>(null)
  const [editingBucketName, setEditingBucketName] = useState('')
  const menuDropdownRef = useRef<HTMLDivElement>(null)
  const editingInputRef = useRef<HTMLInputElement>(null)
  const commitInProgressRef = useRef(false)

  const newBucketRef = useRef<HTMLInputElement>(null)

  // Sem níveis de acesso neste app (ver `useRole`) — todo usuário vê tudo.
  const canSeeTemplates = true

  // ELO-3182: 4px na Pedagogia (era 8 para todos). 8px é uma "zona morta"
  // perceptível — o card só começa a responder depois de meio centímetro de
  // movimento, o que lê como travamento. 4px ainda protege o clique acidental
  // (abrir o card) sem esse atraso. Demais áreas seguem em 8.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: area === 'pedagogia' ? 4 : 8 } }),
  )
  // active.data.current é LIVE no @dnd-kit: re-renders durante o drag atualizam o dado.
  // Capturamos o bucket original em handleDragStart (antes de qualquer optimistic update)
  // e o bucket corrente em activeBucketRef (atualizado pelo handleDragOver). ELO-2153.
  const originalBucketRef = useRef<string | null>(null)
  const activeBucketRef = useRef<string | null>(null)
  // ELO-3182 (Pedagogia): id da tarefa em arrasto, para renderizar o
  // `DragOverlay` — ver handleDragStart.
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null)
  const activeDragTask = activeDragTaskId ? tasks.find((t) => t.id === activeDragTaskId) ?? null : null

  useEffect(() => {
    // Defesa em profundidade — a causa raiz do "flash" de dados de
    // outra área (colunas/tarefas de outro projeto por um instante) é a
    // ausência de `key` nas 3 rotas de área no router (ver comentário lá),
    // já corrigida. Isto aqui é um cinto de segurança: se alguém remover a
    // `key` no futuro, o componente não remonta ao trocar de área, e sem
    // este reset o `loading`/`projectId`/etc. ficam herdados da área
    // anterior até a promise abaixo resolver, deixando uma janela em que o
    // guard de `loading` (mais abaixo) não cobre e o board pinta dados do
    // projeto errado. `cancelled` evita aplicar uma resposta obsoleta se
    // `area` mudar de novo antes desta promise resolver.
    let cancelled = false
    setLoading(true)
    setError(null)
    setProjectId(null)
    setBuckets([])
    setTasks([])
    setLabels([])
    setLocalBucketOrder([])
    setLocalTaskOrder({})
    setProjectTitle(DEFAULT_TITLE[area])
    setProjectTeam([])
    // ELO-2936: para 'marketing' resolve exatamente como antes (via
    // `getMarketingProject` dentro de `getOrCreateAreaProject`); para
    // 'administrativo' cria o projeto singleton na 1ª visita (idempotente).
    getOrCreateAreaProject(area)
      .then((proj) => {
        if (cancelled) return
        setProjectId(proj.id)
        if (proj.title) setProjectTitle(proj.title)
        if (proj.team) setProjectTeam(proj.team)
      })
      .catch(() => {
        if (cancelled) return
        setError('Erro ao carregar projeto.')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [area])

  useEffect(() => {
    if (!projectId) return
    const unsub1 = subscribeMarketingBuckets(projectId, (b) => {
      setBuckets(b)
      setLoading(false)
    })
    const unsub2 = subscribeMarketingTasks(projectId, setTasks, { includeArchived: showArchived })
    return () => { unsub1(); unsub2() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showArchived intencionalmente re-assina o listener (não é um filtro client-side sobre o mesmo snapshot)
  }, [projectId, showArchived])

  // ELO-3182: dicionário de etiquetas do projeto — vazio em Marketing/Administrativo hoje.
  useEffect(() => {
    if (!projectId) return
    return subscribePMOfficeLabels(projectId, setLabels)
  }, [projectId])

  // ELO-2804: usa usersApi.listUsers() (sem includeInactive) em vez de query
  // direta ao Firestore — herda o filtro de inativos da ELO-2803 e o
  // `photoURL` (ELO-2661) sem reimplementar os dois aqui. Não filtra
  // `task.assigneesNames`/`task.assignees` já persistidos na tarefa: essas
  // listas são um snapshot no momento da atribuição, resolvidas no card e no
  // modal independente deste array — só as OPÇÕES de novo assignment encolhem.
  useEffect(() => {
    usersApi
      .listUsers()
      .then(setUsers)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (addingBucket) newBucketRef.current?.focus()
  }, [addingBucket])

  // ELO-2154: fecha o menu de opções ao clicar fora do dropdown
  useEffect(() => {
    if (!openMenuBucketId) return
    function onPointerDown(e: PointerEvent) {
      if (menuDropdownRef.current?.contains(e.target as Node)) return
      setOpenMenuBucketId(null)
      setMenuAnchorRect(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openMenuBucketId])

  // ELO-2154: foca o input de renomeação ao entrar em modo de edição
  useEffect(() => {
    if (editingBucketId) editingInputRef.current?.focus()
  }, [editingBucketId])

  // ELO-2154: clamp do dropdown para não sair da viewport
  useLayoutEffect(() => {
    if (!menuDropdownRef.current || !menuAnchorRect) return
    const el = menuDropdownRef.current
    const dropRect = el.getBoundingClientRect()
    const vw = window.innerWidth
    if (dropRect.right > vw - 8) {
      el.style.left = `${vw - dropRect.width - 8}px`
    }
    if (dropRect.bottom > window.innerHeight - 8) {
      el.style.top = `${menuAnchorRect.top - dropRect.height - 4}px`
    }
  }, [openMenuBucketId, menuAnchorRect])

  // Sincroniza a ordem local de colunas quando o Firestore atualiza os buckets
  useEffect(() => {
    setLocalBucketOrder(buckets.map((b) => b.id))
  }, [buckets])

  const teamUsers = useMemo(
    () => (projectTeam.length > 0 ? users.filter((u) => projectTeam.includes(u.name)) : users),
    [users, projectTeam],
  )

  const expandedTask = useMemo(
    () => tasks.find((t) => t.id === expandedTaskId) ?? null,
    [tasks, expandedTaskId],
  )

  const bucketMap = useMemo(
    () => Object.fromEntries(buckets.map((b) => [b.id, b.name])),
    [buckets],
  )

  // ELO-3182 (correção do gate ux-ui-reviewer): ligar "Mostrar arquivadas"
  // num quadro sem nenhuma arquivada não mudava nada na tela — indistinguível
  // de botão quebrado. `archivedCount` alimenta o banner de estado vazio
  // logo abaixo do header.
  const archivedCount = useMemo(
    () => (showArchived ? tasks.filter((t) => t.archived === true).length : 0),
    [tasks, showArchived],
  )

  /**
   * ELO-3182: tarefa passa no filtro de etiqueta selecionado. Sem seleção
   * (array vazio) → todas passam, comportamento idêntico ao anterior à
   * issue (Marketing/Administrativo nunca têm `labelFilter` não-vazio, já
   * que não há UI para popular `labels` lá hoje — dropdown só aparece
   * quando `labels.length > 0`).
   */
  function matchesLabelFilter(t: PMTask): boolean {
    if (labelFilter.length === 0) return true
    const taskLabels = t.labels ?? []
    if (labelFilter.includes(NO_LABEL_FILTER_KEY) && taskLabels.length === 0) return true
    return taskLabels.some((id) => labelFilter.includes(id))
  }

  const tasksByBucket = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const visible = tasks.filter((t) => {
      // Refinamento visual Pedagogia (ELO-3182): decisão explícita do Marcos
      // — SEM seção colapsável "Tarefas concluídas", como no Trello real
      // (nenhuma lista tem esse recurso lá; todo card fica solto na coluna).
      // `done` entra na mesma lista/SortableContext das demais, ciente do
      // custo de performance de montar todos os cards de uma vez (medido e
      // reportado — ver `content-visibility` no MarketingKanbanCard.tsx).
      // Marketing/Administrativo mantêm o filtro original (só todo/in_progress
      // aqui; done vai para doneTasksByBucket → seção colapsável).
      if (area === 'pedagogia') {
        if (t.status !== 'todo' && t.status !== 'in_progress' && t.status !== 'done') return false
      } else if (t.status !== 'todo' && t.status !== 'in_progress') {
        return false
      }
      if (!matchesLabelFilter(t)) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        (t.checklist ?? []).some((item) => item.title.toLowerCase().includes(q)) ||
        bucketMap[t.bucketId]?.toLowerCase().includes(q)
      )
    })
    const map: Record<string, PMTask[]> = {}
    for (const t of visible) {
      if (!map[t.bucketId]) map[t.bucketId] = []
      map[t.bucketId].push(t)
    }
    for (const bucketId of Object.keys(map)) {
      map[bucketId].sort((a, b) => {
        const da = a.dueDate ? (a.dueDate as { seconds: number }).seconds : Infinity
        const db = b.dueDate ? (b.dueDate as { seconds: number }).seconds : Infinity
        if (da !== db) return da - db           // primário: dueDate asc, nulls last
        return (a.order ?? Infinity) - (b.order ?? Infinity)  // secundário: order
      })
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesLabelFilter fecha sobre labelFilter, listado explicitamente abaixo
  }, [tasks, searchQuery, labelFilter, area])

  // Sincroniza localTaskOrder com tasksByBucket quando o Firestore atualiza as tarefas.
  // Preserva a ordem manual dentro do mesmo grupo de dueDate, mas sempre respeita a ordem
  // natural entre grupos (tarefa que ganhou/perdeu dueDate é reposicionada automaticamente).
  useEffect(() => {
    setLocalTaskOrder((prev) => {
      const next: Record<string, string[]> = {}
      for (const [bucketId, bucketTasks] of Object.entries(tasksByBucket)) {
        const prevIds = prev[bucketId] ?? []
        const newIds = bucketTasks.map((t) => t.id)

        // Composição mudou → usa nova ordem natural diretamente
        const sameSet =
          prevIds.length === newIds.length && newIds.every((id) => prevIds.includes(id))
        if (!sameSet) {
          next[bucketId] = newIds
          continue
        }

        // Composição igual — reconstruir respeitando a ordem natural entre grupos de dueDate,
        // mas preservando a ordem manual de prevIds dentro de cada grupo.
        const taskSecMap = Object.fromEntries(
          bucketTasks.map((t) => [
            t.id,
            (t.dueDate as { seconds: number } | null)?.seconds ?? Infinity,
          ]),
        )

        // Agrupar prevIds pelo dueDate.seconds atual (reflete possível mudança de data)
        const groupsInPrev = new Map<number, string[]>()
        for (const id of prevIds) {
          const sec = taskSecMap[id]
          if (!groupsInPrev.has(sec)) groupsInPrev.set(sec, [])
          groupsInPrev.get(sec)!.push(id)
        }

        // Ordem natural dos grupos vem de tasksByBucket (já ordenado por dueDate asc)
        const groupOrder: number[] = []
        for (const task of bucketTasks) {
          const sec = taskSecMap[task.id]
          if (!groupOrder.includes(sec)) groupOrder.push(sec)
        }

        // Reconstruir: grupos em ordem natural, dentro de cada grupo a ordem de prevIds
        const reconstructed: string[] = []
        for (const sec of groupOrder) reconstructed.push(...(groupsInPrev.get(sec) ?? []))

        next[bucketId] = reconstructed
      }
      return next
    })
  }, [tasksByBucket])

  const doneTasksByBucket = useMemo(() => {
    // Pedagogia não usa mais a seção colapsável — `done` já está dentro de
    // `tasksByBucket` acima. Mapa vazio aqui evita renderizar a tarefa DUAS
    // vezes (uma na lista principal, outra na seção "concluídas").
    if (area === 'pedagogia') return {} as Record<string, PMTask[]>
    const q = searchQuery.trim().toLowerCase()
    const map: Record<string, PMTask[]> = {}
    for (const t of tasks) {
      if (t.status !== 'done') continue
      if (!matchesLabelFilter(t)) continue
      if (q && !t.title.toLowerCase().includes(q) && !(t.checklist ?? []).some((item) => item.title.toLowerCase().includes(q)) && !bucketMap[t.bucketId]?.toLowerCase().includes(q)) continue
      if (!map[t.bucketId]) map[t.bucketId] = []
      map[t.bucketId].push(t)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesLabelFilter fecha sobre labelFilter, listado explicitamente abaixo
  }, [tasks, searchQuery, labelFilter, area])

  // ELO-2177: reinicia o destaque sempre que o taskId da URL mudar (ex.: um
  // novo clique em "Minhas Tarefas" enquanto o Kanban já está aberto).
  useEffect(() => {
    if (highlightTaskId !== consumedTaskIdRef.current) {
      consumedTaskIdRef.current = null
      setActiveHighlightId(null)
    }
  }, [highlightTaskId])

  // ELO-2177: se a tarefa alvo está na seção "Tarefas concluídas" (colapsada
  // por padrão), expande o bucket correspondente antes do scroll poder achá-la.
  useEffect(() => {
    if (!highlightTaskId) return
    const target = tasks.find((t) => t.id === highlightTaskId)
    if (!target || target.status !== 'done') return
    setExpandedDoneBuckets((prev) => {
      if (prev.has(target.bucketId)) return prev
      const next = new Set(prev)
      next.add(target.bucketId)
      return next
    })
  }, [highlightTaskId, tasks])

  // ELO-2177: rola até o card em dois eixos (coluna horizontalmente dentro do
  // board, depois o card verticalmente dentro da coluna) e aplica o pulso
  // visual. `scrollIntoView` com `inline: 'center'` cobriria os dois eixos
  // num único container de scroll, mas aqui há DOIS containers de scroll
  // aninhados (o board horizontal e a lista vertical de cada coluna) — o
  // scroll em dois passos evita que um cancele o outro.
  useEffect(() => {
    if (!highlightTaskId || highlightTaskId === consumedTaskIdRef.current) return
    let verticalTimer: ReturnType<typeof setTimeout> | undefined
    // Espera o DOM assentar (a expansão do bucket "concluídas", se houver,
    // acontece num efeito separado acima) antes de procurar o elemento.
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-task-id="${highlightTaskId}"]`)
      if (!el) return // tarefa não encontrada no DOM — falha silenciosa (ELO-2177)
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      // Passo 2: depois que o scroll horizontal assenta, garante o
      // enquadramento vertical dentro da coluna (o `inline: 'center'` acima
      // pode não centralizar bem o eixo vertical quando há dois containers
      // de scroll aninhados).
      verticalTimer = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }, 350)
      consumedTaskIdRef.current = highlightTaskId
      setActiveHighlightId(highlightTaskId)
    }, 80)
    return () => { clearTimeout(timer); clearTimeout(verticalTimer) }
  }, [highlightTaskId, tasks, expandedDoneBuckets])

  // Remove o pulso visual depois da animação (~2s, ver globals.css) e avisa o
  // pai para limpar `?taskId=` da URL — o card já foi visto, não precisa mais
  // do parâmetro.
  useEffect(() => {
    if (!activeHighlightId) return
    const timer = setTimeout(() => {
      setActiveHighlightId(null)
      clearHighlightParam()
    }, 2000)
    return () => clearTimeout(timer)
  }, [activeHighlightId])

  /** ELO-2177: clicar no card destacado cancela o pulso na hora, além do
   * comportamento normal do clique (expandir o card). */
  function handleExpandTask(task: PMTask) {
    if (task.id === activeHighlightId) {
      setActiveHighlightId(null)
      clearHighlightParam()
    }
    openExpand(task)
  }

  // Ordem renderizada das colunas: respeita localBucketOrder (atualizado otimisticamente no drag)
  const orderedBuckets = useMemo((): PMBucket[] => {
    if (localBucketOrder.length === 0) return buckets
    return localBucketOrder
      .map((id) => buckets.find((b) => b.id === id))
      .filter((b): b is PMBucket => b !== undefined)
  }, [localBucketOrder, buckets])

  // `allBuckets` do MarketingKanbanCard (menu "Clonar para") é
  // idêntico para todo card de toda coluna — só depende de `orderedBuckets`,
  // nunca da tarefa. Antes era recalculado (novo array) a cada card, a cada
  // render — um dos vários motivos pelos quais `memo()` no card sozinho não
  // evitava trabalho. Hoisted para 1 array estável por render do quadro.
  const allBucketsForCard = useMemo(
    () => orderedBuckets.map((b) => ({ id: b.id, name: b.name })),
    [orderedBuckets],
  )

  async function handleDeleteBucket() {
    if (!deleteBucketTarget || !projectId) return
    setDeleting(true)
    try {
      await deletePMBucket(projectId, deleteBucketTarget.id)
      audit.logBucket('pm_bucket.delete', { id: deleteBucketTarget.id, name: deleteBucketTarget.name })
      setDeleteBucketTarget(null)
    } catch (err) {
      console.error(err)
    } finally {
      setDeleting(false)
    }
  }

  async function handleAddBucket() {
    const name = newBucketName.trim()
    if (!name || !projectId) return
    setNewBucketName('')
    setAddingBucket(false)
    const bucketId = await createMarketingBucket(projectId, name).catch((err) => {
      console.error(err)
      return null
    })
    if (bucketId) audit.logBucket('pm_bucket.create', { id: bucketId, name })
  }

  // ELO-2154: salva o novo nome da coluna e limpa o modo de edição.
  // Usa commitInProgressRef para evitar duplo-save quando blur dispara após Enter.
  async function handleRenameBucket(bucketId: string, newName: string) {
    const bucket = buckets.find((b) => b.id === bucketId)
    if (!bucket || !projectId) {
      setEditingBucketId(null)
      return
    }
    const trimmed = newName.trim()
    setEditingBucketId(null)
    if (!trimmed || trimmed === bucket.name) return
    await renameBucket(projectId, bucketId, trimmed).catch(console.error)
    audit.logBucket('pm_bucket.rename', { id: bucketId, name: trimmed })
  }

  async function handleNewTaskConfirm(
    title: string,
    opts: { dueDate?: Date; checklist: ChecklistItem[]; recurrence?: RecurrenceConfig; assignees: string[]; assigneesNames: string[] },
  ) {
    if (!newTaskBucket || !projectId) return
    const taskId = await createMarketingTask(projectId, newTaskBucket.id, title, opts).catch((err) => {
      console.error(err)
      return null
    })
    if (taskId) {
      audit.logTask(
        'pm_task.create',
        { id: taskId, title },
        { bucketId: newTaskBucket.id, bucketName: newTaskBucket.name },
      )
    }
    setNewTaskBucket(null)
  }

  function openExpand(task: PMTask) {
    setExpandedTaskId(task.id)
    setModalOpen(true)
  }

  function toggleDoneBucket(bucketId: string) {
    setExpandedDoneBuckets((prev) => {
      const next = new Set(prev)
      if (next.has(bucketId)) next.delete(bucketId)
      else next.add(bucketId)
      return next
    })
  }

  /** Captura o bucket original antes de qualquer optimistic update. ELO-2153. */
  function handleDragStart(event: DragStartEvent) {
    if (event.active.data.current?.type === 'task') {
      const bucketId = event.active.data.current.bucketId as string
      originalBucketRef.current = bucketId
      activeBucketRef.current = bucketId
      // ELO-3182: guarda a tarefa arrastada para o `DragOverlay` (Pedagogia).
      // Sem overlay, o card arrastado continua sendo o elemento DENTRO da
      // coluna, que tem `overflowY: auto` — por isso ele era CORTADO ao passar
      // para outra coluna. O overlay renderiza fora dessa caixa.
      setActiveDragTaskId(String(event.active.id))
    }
  }

  /**
   * Preview cross-column otimista: move a tarefa no state local enquanto ela está
   * sendo arrastada sobre outra coluna. Não faz escrita no Firestore — isso fica
   * para handleUnifiedDragEnd. ELO-2153.
   */
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over || !canWrite) return
    if (active.data.current?.type !== 'task') return

    const fromBucketId = activeBucketRef.current ?? (active.data.current?.bucketId as string)
    // over pode ser uma tarefa (tem data.type === 'task') ou a própria coluna (type === 'column')
    const toBucketId =
      over.data.current?.type === 'task'
        ? (over.data.current?.bucketId as string)
        : String(over.id)

    if (!toBucketId || fromBucketId === toBucketId) return

    // Optimistic update: muda bucketId da tarefa arrastada no state
    setTasks((prev) =>
      prev.map((t) => (t.id === String(active.id) ? { ...t, bucketId: toBucketId } : t)),
    )
    activeBucketRef.current = toBucketId
  }

  /**
   * Handler unificado de dragEnd: distingue pelo active.data.current.type.
   * - type 'column' → reordena colunas horizontalmente (antigo handleColumnDragEnd)
   * - type 'task', mesmo bucket → reordena dentro da coluna (antigo handleDragEnd)
   * - type 'task', bucket diferente → persiste cross-column move no Firestore (ELO-2153)
   * ELO-2153.
   */
  async function handleUnifiedDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const activeType = active.data.current?.type as string | undefined
    // ELO-3182: limpa o overlay SEMPRE, logo no início — inclusive nos vários
    // early-returns abaixo. Se ficasse só no caminho feliz, um drop inválido
    // (soltar fora, soltar no mesmo lugar) deixaria o card fantasma preso na
    // tela.
    setActiveDragTaskId(null)

    if (activeType === 'column') {
      originalBucketRef.current = null
      activeBucketRef.current = null
      if (!over || active.id === over.id || !projectId) return
      // Garante que só reordena quando cai sobre outra coluna
      if (over.data.current?.type !== 'column') return
      const currentOrder = localBucketOrder.length > 0 ? localBucketOrder : buckets.map((b) => b.id)
      const oldIndex = currentOrder.indexOf(String(active.id))
      const newIndex = currentOrder.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex)
      setLocalBucketOrder(newOrder)
      await reorderBuckets(projectId, newOrder).catch(console.error)
      audit.logBucket('pm_task.reorder', {
        id: String(active.id),
        name: buckets.find((b) => b.id === String(active.id))?.name,
      })
      return
    }

    if (activeType === 'task') {
      // originalBucketRef capturado em handleDragStart — antes de qualquer optimistic update
      // (active.data.current.bucketId seria o bucket atual pós-re-render, não o original)
      const originalBucketId = originalBucketRef.current ?? (active.data.current?.bucketId as string)
      const finalBucketId = activeBucketRef.current ?? originalBucketId
      originalBucketRef.current = null
      activeBucketRef.current = null

      if (!projectId) return

      if (finalBucketId !== originalBucketId) {
        // Cross-column: o optimistic update no state já foi feito pelo handleDragOver.
        // Se dropped fora de qualquer alvo, reverte.
        if (!over) {
          setTasks((prev) =>
            prev.map((t) => (t.id === String(active.id) ? { ...t, bucketId: originalBucketId } : t)),
          )
          return
        }
        // Persiste no Firestore passando o task com o bucketId original (antes do drag)
        // para que moveTaskToBucket saiba de onde veio.
        const taskToMove = tasks.find((t) => t.id === String(active.id))
        if (!taskToMove) return
        try {
          await moveTaskToBucket(projectId, { ...taskToMove, bucketId: originalBucketId }, finalBucketId)
          const toBucket = buckets.find((b) => b.id === finalBucketId)
          audit.logTask(
            'pm_task.move',
            { id: taskToMove.id, title: taskToMove.title },
            {
              bucketId: finalBucketId,
              bucketName: toBucket?.name,
              changes: [{ field: 'bucketId', before: originalBucketId, after: finalBucketId }],
            },
          )
        } catch (err) {
          console.error('[crossColumnDrag] falhou ao mover tarefa:', err)
          // Reverte o optimistic update
          setTasks((prev) =>
            prev.map((t) => (t.id === String(active.id) ? { ...t, bucketId: originalBucketId } : t)),
          )
        }
        return
      }

      // Same-column reorder
      if (!over || active.id === over.id) return
      const bucketId = originalBucketId
      const taskById = Object.fromEntries(
        (tasksByBucket[bucketId] ?? []).map((t) => [t.id, t]),
      )
      const activeTask = taskById[String(active.id)]
      const overTask = taskById[String(over.id)]
      // Se over for a coluna em si (não uma tarefa) ou tarefa não encontrada, abort
      if (!activeTask || !overTask) return
      // Bloqueia movimentação entre grupos de dueDate distintos — EXCETO em
      // Pedagogia (ELO-3182), que usa ordenação manual pura estilo Trello
      // (as tarefas importadas nunca têm `dueDate`, ver blindagem do painel
      // de atrasos). Parametrizado por área: Marketing/Administrativo
      // continuam com o bloqueio original, sem mudança de comportamento.
      if (area !== 'pedagogia' && getDueDateDay(activeTask) !== getDueDateDay(overTask)) return
      const currentIds = localTaskOrder[bucketId] ?? tasksByBucket[bucketId]?.map((t) => t.id) ?? []
      const oldIndex = currentIds.indexOf(String(active.id))
      const newIndex = currentIds.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return
      const newOrder = arrayMove(currentIds, oldIndex, newIndex)
      setLocalTaskOrder((prev) => ({ ...prev, [bucketId]: newOrder }))
      await reorderTasksInBucket(projectId, bucketId, newOrder).catch(console.error)
      // Uma reordenação inteira é UMA ação — auditar tarefa por tarefa geraria N
      // registros para um único arraste.
      audit.logTask(
        'pm_task.reorder',
        { id: activeTask.id, title: activeTask.title },
        { bucketId, bucketName: buckets.find((b) => b.id === bucketId)?.name },
      )
    }
  }

  /**
   * Clona uma tarefa (com subtarefas) para o bucket de destino. (ELO-2155)
   * Busca subtarefas antes de clonar e registra audit log `pm_task.clone`.
   * Não precisa de optimistic update: a tarefa clonada aparece via listener do Firestore.
   */
  async function handleCloneTask(task: PMTask, targetBucketId: string) {
    if (!projectId) return
    try {
      const subtasks = await getTaskSubtasks(projectId, task.bucketId, task.id)
      const newTaskId = await cloneTask(projectId, task, subtasks, targetBucketId)
      const toBucket = buckets.find((b) => b.id === targetBucketId)
      audit.logTask(
        'pm_task.clone',
        { id: newTaskId, title: `Cópia de — ${task.title}` },
        {
          bucketId: targetBucketId,
          bucketName: toBucket?.name,
          changes: [{ field: 'clonedFrom', before: null, after: task.id }],
        },
      )
    } catch (err) {
      console.error('[cloneTask] falhou ao clonar tarefa:', err)
    }
  }

  /**
   * Solicita confirmação e exclui uma tarefa via menu do card. (ELO-2155)
   * Fecha o TaskDetailModal se a tarefa excluída for a que está aberta.
   */
  async function handleConfirmDeleteTask() {
    if (!deleteTaskTarget || !projectId) return
    setDeletingTask(true)
    try {
      await deletePMTask(projectId, deleteTaskTarget.bucketId, deleteTaskTarget.id)
      audit.logTask(
        'pm_task.delete',
        { id: deleteTaskTarget.id, title: deleteTaskTarget.title },
        {
          bucketId: deleteTaskTarget.bucketId,
          bucketName: buckets.find((b) => b.id === deleteTaskTarget.bucketId)?.name,
        },
      )
      setTasks((prev) => prev.filter((t) => t.id !== deleteTaskTarget.id))
      // Fecha o modal de detalhe se a tarefa excluída estava aberta
      if (expandedTaskId === deleteTaskTarget.id) {
        setModalOpen(false)
        setExpandedTaskId(null)
      }
      setDeleteTaskTarget(null)
    } catch (err) {
      console.error('[deleteTask] falhou ao excluir tarefa:', err)
    } finally {
      setDeletingTask(false)
    }
  }

  /**
   * Move uma tarefa para outro bucket via menu "Mover para" do card. (ELO-2153)
   * Aplica optimistic update imediato e reverte em caso de erro na escrita.
   * Mantido para coexistir com o drag-and-drop cross-column — ambos os mecanismos
   * chamam moveTaskToBucket mas por caminhos distintos.
   */
  async function handleMoveTask(task: PMTask, toBucketId: string) {
    if (!projectId || task.bucketId === toBucketId) return
    const fromBucketId = task.bucketId
    // Optimistic update: reflete a mudança de coluna antes da confirmação do Firestore
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, bucketId: toBucketId } : t)),
    )
    try {
      await moveTaskToBucket(projectId, task, toBucketId)
      const toBucket = buckets.find((b) => b.id === toBucketId)
      audit.logTask(
        'pm_task.move',
        { id: task.id, title: task.title },
        {
          bucketId: toBucketId,
          bucketName: toBucket?.name,
          changes: [{ field: 'bucketId', before: fromBucketId, after: toBucketId }],
        },
      )
    } catch (err) {
      console.error('[moveTask] falhou ao mover tarefa:', err)
      // Revert: restaura o bucketId original em caso de falha
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, bucketId: fromBucketId } : t)),
      )
    }
  }

  /**
   * Arquiva/desarquiva uma tarefa via menu do card. (ELO-3182)
   *
   * Correção do gate ux-ui-reviewer (15/09/2026): o card sumindo/reaparecendo
   * sem nenhum feedback era ambíguo com "excluiu" ou "deu erro silencioso" —
   * `setArchiveToast` sempre confirma a ação, com "Desfazer" reaplicando a
   * transição oposta, e mostra erro em linguagem humana se a escrita falhar
   * (em vez de só `console.error`, que o usuário nunca vê).
   */
  async function handleToggleArchive(task: PMTask) {
    if (!projectId) return
    const nextArchived = !task.archived
    try {
      await setPMTaskArchived(projectId, task.bucketId, task.id, nextArchived)
      setArchiveToast({
        message: nextArchived ? 'Tarefa arquivada.' : 'Tarefa desarquivada.',
        variant: 'success',
        undo: () => {
          setPMTaskArchived(projectId, task.bucketId, task.id, !nextArchived).catch((err) => {
            console.error('[toggleArchive] falhou ao desfazer:', err)
            setArchiveToast({ message: 'Não foi possível desfazer. Tente novamente.', variant: 'error' })
          })
        },
      })
    } catch (err) {
      console.error('[toggleArchive] falhou ao arquivar/desarquivar tarefa:', err)
      setArchiveToast({
        message: nextArchived
          ? 'Não foi possível arquivar a tarefa. Tente novamente.'
          : 'Não foi possível desarquivar a tarefa. Tente novamente.',
        variant: 'error',
      })
    }
  }

  // ELO-3182 (refinamento visual Pedagogia): fundo do quadro no tom do Trello,
  // exclusivo desta área — Marketing/Administrativo continuam com `--eh-bg`
  // (cinza neutro do CoreHUB). Ver `--eh-pm-board-*` em globals.css (dark
  // mode tem uma variante própria, mais escura, para não brigar com o tema).
  const isPedagogia = area === 'pedagogia'

  // ELO-3182: Esc sai do modo ampliado — comportamento esperado por quem já
  // usou qualquer tela cheia. Gated por `isPedagogia && immersive`: nas
  // outras áreas `immersive` nunca fica `true` (nenhum botão pra ligá-lo),
  // então o listener não tem efeito nenhum lá mesmo que o hook rode sempre
  // (hooks não podem ser condicionais — a condição fica DENTRO do efeito).
  useEffect(() => {
    if (!isPedagogia || !immersive) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setImmersive(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isPedagogia, immersive, setImmersive])

  // ELO-3182 (2ª rodada — "sobra espaço branco"): `AppLayout.tsx` é global
  // (serve TODAS as telas do CoreHub) e aplica `px-6 py-6` (24px) + fundo
  // `--eh-bg` no `<main>` que envolve QUALQUER página, incluindo esta —
  // NÃO tocado aqui de propósito (mudar o `<main>` global vazaria pra
  // Marketing/Administrativo/toda tela do app). Compensado só localmente,
  // só quando `isPedagogia`, com margem negativa exatamente do tamanho do
  // padding do pai + crescimento equivalente em largura/altura — a técnica
  // padrão para "furar" o padding de um container ancestral sem alterá-lo.
  // `overflow: 'hidden'` porque o BOARD (filho, mais abaixo) já tem seu
  // próprio `overflowX: 'auto'` — sem isso, a margem negativa criaria uma
  // segunda barra de scroll no `<main>` pai (o navegador soma a área
  // "estourada" pela margem negativa ao scrollable content, mesmo sem
  // conteúdo real ali).
  const PEDAGOGIA_MAIN_PADDING_PX = 24
  const pageStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: isPedagogia ? `calc(100% + ${PEDAGOGIA_MAIN_PADDING_PX * 2}px)` : '100%',
    minHeight: 0,
    width: isPedagogia ? `calc(100% + ${PEDAGOGIA_MAIN_PADDING_PX * 2}px)` : undefined,
    margin: isPedagogia ? `-${PEDAGOGIA_MAIN_PADDING_PX}px` : undefined,
    overflow: isPedagogia ? 'hidden' : undefined,
    background: isPedagogia ? 'var(--eh-pm-board-bg)' : 'var(--eh-bg, var(--eh-bg))',
    // ELO-3182 (refinamento visual Pedagogia): `globals.css:150` aplica
    // `font-family: var(--eh-font)` (Hanken Grotesk) no `body` — herdado por
    // TUDO por padrão. `font-family` é uma propriedade herdável, e um style
    // INLINE (especificidade sempre maior que qualquer seletor de classe/
    // elemento, exceto `!important`) neste container raiz do quadro
    // sobrescreve o valor herdado para ele e para todos os descendentes que
    // não tenham a própria declaração. Verificado por leitura de
    // especificidade CSS (inline > `body{}` elemento) — não há `!important`
    // em `--eh-font` que pudesse vencer o inline. Título do card e cabeçalho
    // de coluna já setam a própria `fontFamily` (redundante, mas explícito);
    // este nível pega o resto (botão "+ Adicionar tarefa", inputs, etc.).
    fontFamily: isPedagogia
      ? 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif'
      : undefined,
    fontSize: isPedagogia ? 14 : undefined,
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: isMobile ? 'stretch' : 'center',
    flexDirection: isMobile ? 'column' : 'row',
    justifyContent: 'space-between',
    // Refinamento visual Pedagogia (ELO-3182, pedido do Marcos: "a barra
    // corta a tela em duas... no Trello ela é fundida com o quadro"):
    // altura ~48px medida na captura real (desktop, não-mobile — no mobile
    // o padding empilhado naturalmente já muda a altura).
    padding: isMobile ? '12px 12px 10px' : isPedagogia ? '0 24px' : '16px 24px 12px',
    height: isMobile || !isPedagogia ? undefined : 48,
    // NÃO é hex chapado: `pageStyle` (o container PAI) já pinta o mesmo
    // `var(--eh-pm-board-bg)` (o gradiente inteiro) por baixo de header E
    // board — aqui só uma camada preta translúcida por cima, então o
    // gradiente do header continua o do board sem costura (é literalmente
    // o mesmo gradiente, só com overlay).
    //
    // rgba(0,0,0,0.2) — RECALCULADO na 2ª rodada a partir de pixels reais do
    // Trello (0,4 da 1ª rodada ficou "escuro demais", segundo o Marcos).
    // Resolvendo `header = board*(1-alpha)` pelos 3 canais entre a barra
    // real do Trello e o fundo do quadro logo abaixo dela: alpha ≈ 0,18–0,23
    // — bate com a estimativa do Marcos (~0,18).
    //
    // O "pior caso" de contraste NÃO é a ponta mais clara do gradiente
    // inteiro (#5fc5d0, canto inferior-direito do board) — o header é uma
    // faixa de 48px no TOPO, e um gradiente 135deg nunca alcança sua própria
    // extremidade dentro dessa faixa (geometria do ângulo). Calculado via
    // projeção do gradiente CSS real sobre a faixa do header em larguras de
    // até 2560px: o ponto mais claro que o header de fato cobre é ~#48ada5,
    // não #5fc5d0. Nesse ponto real: alpha 0,18 dá 4,41:1 (reprova por
    // pouco), alpha 0,2 dá 4,59:1 (passa, margem mínima sobre 4,5:1) — por
    // isso 0,2 e não 0,18 cravado. Mesmo valor no modo escuro (base já mais
    // escura, folga bem maior: 10,25:1 no pior caso equivalente).
    background: isPedagogia ? 'rgba(0,0,0,0.2)' : 'var(--eh-surface)',
    borderBottom: isPedagogia ? 'none' : '1px solid var(--eh-border, var(--eh-border))',
    flexShrink: 0,
    gap: isMobile ? 10 : 16,
  }

  const columnStyle: CSSProperties = {
    // 340px fixos são mais largos que a tela de um celular (390px menos o
    // padding), então nem uma coluna inteira aparecia. 85vw mostra a coluna
    // atual por completo e deixa espiar a próxima — a borda visível é o que
    // sinaliza que o quadro rola para o lado. A rolagem horizontal é mantida
    // de propósito: é como Kanban funciona no mobile, e é o que preserva o
    // drag-and-drop entre colunas.
    // Refinamento visual Pedagogia (desktop): 272px é a largura útil medida
    // na captura real do board (1440×900) — mais estreita que os 340px do
    // CoreHUB, resultando em colunas mais compactas/densas, como o Trello.
    // Mobile continua 85vw para as três áreas (decisão de UX do CoreHUB, não
    // informada pela captura desktop do Trello).
    width: isMobile ? '85vw' : isPedagogia ? 272 : 340,
    flexShrink: 0,
    background: isPedagogia ? 'var(--eh-pm-board-column-bg)' : 'var(--eh-bg)',
    borderRadius: 12,
    // Refinamento visual Pedagogia: sombra dupla medida por computed style
    // da coluna real do Trello (mesmo valor do card, ver MarketingKanbanCard).
    ...(isPedagogia ? { boxShadow: '0 1px 1px 0 rgba(30,31,33,0.25), 0 0 1px 0 rgba(30,31,33,0.31)' } : {}),
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '100%',
  }

  const colHeaderStyle: CSSProperties = {
    padding: '12px 14px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  }

  const addTaskBtnStyle: CSSProperties = {
    width: '100%',
    padding: '7px 12px',
    background: 'transparent',
    border: '1px dashed var(--eh-border-hover)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12.5,
    color: 'var(--eh-text-2)',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    flexShrink: 0,
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--eh-text-2)' }}>
        Carregando...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--eh-danger)' }}>
        {error}
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      {/* HEADER */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Pedagogia: branco sobre o overlay escuro do header (~16px/600,
              medido na captura real do Trello) — 4,59:1 no pior caso REAL do
              gradiente (mesmo cálculo do headerStyle acima). Outras áreas
              mantêm --eh-text-strong sobre --eh-surface branco, inalterado. */}
          <h1 style={{ margin: 0, fontSize: isPedagogia ? 16 : 17, fontWeight: isPedagogia ? 600 : 700, color: isPedagogia ? 'var(--eh-pm-header-fg)' : 'var(--eh-text-strong)' }}>
            {projectTitle}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: isMobile ? 'wrap' : undefined }}>
          {/* busca de 280px fixos não cabe ao lado do título + 4 abas em 390px */}
          <div style={{ position: 'relative', width: isMobile ? '100%' : 280 }}>
            {/* Pedagogia: sem ícone (pedido do Marcos — "tire o ícone",
                busca minimalista). O emoji 🔍 continua nas outras áreas,
                onde o campo é claro e o ícone ajuda a identificar o controle. */}
            {!isPedagogia && (
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
            )}
            {/* Pedagogia: campo branco translúcido sobre o header escuro —
                fundo/borda/texto/placeholder brancos, como o Trello real.
                Placeholder via className (`::placeholder` não dá pra
                declarar inline) — ver globals.css. */}
            <input
              type="text"
              placeholder={isPedagogia ? 'Buscar' : 'Buscar tarefas, subtarefas e categorias...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={isPedagogia ? 'eh-pm-header-input' : undefined}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                // Sem ícone na Pedagogia → o padding-left volta a ser simétrico.
                paddingLeft: isPedagogia ? 12 : 30,
                paddingRight: searchQuery ? 28 : 12,
                paddingTop: isPedagogia ? 7 : 6,
                paddingBottom: isPedagogia ? 7 : 6,
                fontSize: 13,
                // Minimalista: sem borda em repouso — só o fundo translúcido
                // define o campo. A borda aparece no foco (via CSS, ver
                // `.eh-pm-header-input:focus` em globals.css), que é o que dá
                // o feedback de "estou digitando aqui" sem poluir em repouso.
                border: isPedagogia ? '1px solid transparent' : '1px solid var(--eh-border)',
                borderRadius: isPedagogia ? 6 : 8,
                background: isPedagogia ? 'var(--eh-pm-header-surface)' : 'var(--eh-bg)',
                color: isPedagogia ? 'var(--eh-pm-header-fg)' : 'var(--eh-text-strong)',
                outline: 'none',
                transition: isPedagogia ? 'background-color .15s ease, border-color .15s ease' : undefined,
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
                  color: isPedagogia ? 'var(--eh-pm-header-fg-muted)' : 'var(--eh-muted-2)',
                  lineHeight: 1,
                  padding: 0,
                }}
                aria-label="Limpar busca"
              >
                ✕
              </button>
            )}
          </div>
          {/* ELO-3182: dropdown só aparece quando o projeto tem alguma etiqueta
              gravada — Marketing/Administrativo hoje não têm, então este bloco
              não aparece lá (comportamento visual inalterado). */}
          <LabelFilterDropdown labels={labels} selected={labelFilter} onChange={setLabelFilter} pedagogia={isPedagogia} />
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? 'Ocultar tarefas arquivadas' : 'Mostrar tarefas arquivadas'}
            className={isPedagogia ? 'eh-pm-header-btn' : undefined}
            data-active={isPedagogia ? showArchived : undefined}
            style={
              isPedagogia
                ? {
                    padding: '6px 12px',
                    borderRadius: 7,
                    fontSize: 13,
                    fontWeight: 500,
                    border: '1px solid transparent',
                    color: 'var(--eh-pm-header-fg)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }
                : {
                    padding: '6px 12px',
                    borderRadius: 7,
                    fontSize: 13,
                    fontWeight: 500,
                    border: `1px solid ${showArchived ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
                    background: showArchived ? 'var(--eh-primary-soft, var(--eh-surface))' : 'var(--eh-surface)',
                    color: showArchived ? 'var(--eh-primary)' : 'var(--eh-text-3)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }
            }
          >
            {showArchived ? 'Arquivadas: visíveis' : 'Mostrar arquivadas'}
          </button>
          <div style={{ display: 'flex', gap: 4, overflowX: isMobile ? 'auto' : undefined, paddingBottom: isMobile ? 2 : undefined }}>
            <NavButton label="Quadro" active={true} onClick={() => undefined} pedagogia={isPedagogia} />
            <NavButton label="Grade" active={false} onClick={() => navigate(`${navBase}/grade`)} pedagogia={isPedagogia} />
            <NavButton label="Calendário" active={false} onClick={() => navigate(`${navBase}/calendario`)} pedagogia={isPedagogia} />
            <NavButton label="Equipe" active={false} onClick={() => setTeamModalOpen(true)} pedagogia={isPedagogia} />
            {canSeeTemplates && (
              <NavButton label="Templates" active={false} onClick={() => navigate(`${navBase}/templates`)} pedagogia={isPedagogia} />
            )}
          </div>
          {/* ELO-3182: botão de ampliar — "ícone para ampliar e preencher a
              tela toda desse kanban, e sair a lateral das abas". Só desktop
              (a sidebar no mobile já é um drawer que se fecha sozinho, sem
              ocupar espaço permanente — não há "lateral" competindo com o
              quadro pra justificar o mecanismo lá, e teria que lidar com o
              próprio drawer aberto simultaneamente). Só Pedagogia: as outras
              áreas nunca recebem `isPedagogia=true`, então este bloco nunca
              renderiza pra elas. */}
          {isPedagogia && !isMobile && (
            <button
              type="button"
              onClick={() => setImmersive(!immersive)}
              className="eh-pm-header-btn"
              data-active={immersive}
              aria-pressed={immersive}
              aria-label={immersive ? 'Sair da ampliação' : 'Ampliar quadro'}
              title={immersive ? 'Sair da ampliação (Esc)' : 'Ampliar quadro'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 7,
                border: '1px solid transparent',
                color: 'var(--eh-pm-header-fg)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {immersive ? (
                // Recolher — setas apontando pra DENTRO (par convencional do ícone de expandir).
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 2v3a1 1 0 0 1-1 1H2M10 2v3a1 1 0 0 0 1 1h3M6 14v-3a1 1 0 0 0-1-1H2M10 14v-3a1 1 0 0 1 1-1h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                // Ampliar — setas apontando pra FORA.
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ELO-3182 (correção ux-ui-reviewer): estado vazio explícito — sem
          isso, ligar o toggle num quadro sem arquivadas parecia botão quebrado. */}
      {showArchived && archivedCount === 0 && (
        <div
          style={{
            padding: '10px 20px',
            background: 'var(--eh-bg)',
            borderBottom: '1px solid var(--eh-border)',
            fontSize: 12.5,
            color: 'var(--eh-text-2)',
            flexShrink: 0,
          }}
        >
          Nenhuma tarefa arquivada neste quadro.
        </div>
      )}

      {/* BOARD */}
      <div
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: isMobile || isPedagogia ? '12px 12px' : '16px 20px',
          display: 'flex',
          // Refinamento visual Pedagogia (desktop): gap entre colunas mais
          // apertado, proporcional às colunas mais estreitas (272px) — Trello
          // empacota as listas mais densamente que o board padrão do CoreHUB.
          gap: isMobile ? 10 : isPedagogia ? 8 : 12,
          alignItems: 'flex-start',
        }}
      >
        {/* DndContext único: gerencia tanto reordenação de colunas (horizontal)
            quanto reordenação e cross-column de tarefas (vertical). ELO-2153. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          // ELO-3182: sem `measuring` explícito, o dnd-kit mede os retângulos
          // dos itens só uma vez, ao iniciar o arrasto. Numa coluna de 454
          // cards que rola durante o próprio arrasto, essas medidas ficam
          // defasadas e o card "pula" para posições erradas — parte dos "muitos
          // bugs" que o Marcos relatou. `Always` remede a cada frame do arrasto,
          // mantendo as posições corretas enquanto a lista rola.
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={canWrite ? handleDragStart : undefined}
          onDragOver={canWrite ? handleDragOver : undefined}
          onDragEnd={canWrite ? (e) => void handleUnifiedDragEnd(e) : undefined}
          // Esc durante o arrasto cancela — sem isto o overlay ficaria preso
          // na tela, já que `onDragEnd` não dispara no cancelamento.
          onDragCancel={() => setActiveDragTaskId(null)}
        >
          <SortableContext
            items={orderedBuckets.map((b) => b.id)}
            strategy={horizontalListSortingStrategy}
          >
            {orderedBuckets.map((bucket, colIndex) => {
              const accentColor = COLUMN_ACCENT_COLORS[colIndex % COLUMN_ACCENT_COLORS.length]
              const bucketTasks = tasksByBucket[bucket.id] ?? []
              const doneTasks = doneTasksByBucket[bucket.id] ?? []
              const isDoneExpanded = expandedDoneBuckets.has(bucket.id)
              const orderedIds = localTaskOrder[bucket.id] ?? bucketTasks.map((t) => t.id)
              const taskById = Object.fromEntries(bucketTasks.map((t) => [t.id, t]))
              // Mesmo raciocínio de `allBucketsForCard` acima, mas
              // por coluna (exclui a própria) — 1 array por coluna por
              // render, em vez de 1 por card por render.
              const otherBucketsForCard = allBucketsForCard.filter((b) => b.id !== bucket.id)
              const orderedTasks = orderedIds.map((id) => taskById[id]).filter((t): t is PMTask => t !== undefined)

              return (
                <SortableColumn
                  key={bucket.id}
                  id={bucket.id}
                  // Refinamento visual Pedagogia: sem faixa colorida no topo da
                  // coluna — o Trello não tem esse indicador, e a cor de accent
                  // por coluna perde sentido no fundo colorido do board.
                  outerStyle={isPedagogia ? columnStyle : { ...columnStyle, borderTop: `4px solid ${accentColor}` }}
                  headerContent={
                    <div style={colHeaderStyle}>
                      {editingBucketId === bucket.id ? (
                        /* Modo de renomeação inline (ELO-2154) */
                        <div style={{ flex: 1, marginRight: 4 }}>
                          <input
                            ref={editingInputRef}
                            type="text"
                            value={editingBucketName}
                            onChange={(e) => setEditingBucketName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                commitInProgressRef.current = true
                                void handleRenameBucket(bucket.id, editingBucketName)
                              }
                              if (e.key === 'Escape') {
                                commitInProgressRef.current = true
                                setEditingBucketId(null)
                              }
                            }}
                            onBlur={() => {
                              if (commitInProgressRef.current) {
                                commitInProgressRef.current = false
                                return
                              }
                              void handleRenameBucket(bucket.id, editingBucketName)
                            }}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              border: '1px solid var(--eh-primary)',
                              borderRadius: 6,
                              padding: '3px 8px',
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--eh-text-3)',
                              background: 'var(--eh-surface)',
                              outline: 'none',
                              fontFamily: 'inherit',
                            }}
                          />
                          <p style={{ fontSize: 10.5, color: 'var(--eh-muted-2)', margin: '3px 0 0', lineHeight: 1.3 }}>
                            Templates desta coluna precisarão ser atualizados manualmente.
                          </p>
                        </div>
                      ) : (
                        <>
                          <span
                            style={{
                              // Refinamento visual Pedagogia. CORREÇÃO: a primeira
                              // medição pegou `fontSize: 20` de um WRAPPER de layout
                              // do Trello, não do texto — na tela ficou visivelmente
                              // maior que o original e ainda cortava o nome. Medido de
                              // novo, agora pela ALTURA DE GLIFO na captura real
                              // (varredura de pixels escuros): 16px de altura de letra
                              // ⇒ `font-size` ~14px. O Trello também QUEBRA o nome em
                              // duas linhas ("FINALIZADOS-/APRESENTAÇÕES") em vez de
                              // truncar com reticências.
                              fontSize: isPedagogia ? 14 : 13,
                              fontWeight: isPedagogia ? 600 : 600,
                              lineHeight: isPedagogia ? '20px' : undefined,
                              fontFamily: isPedagogia
                                ? 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif'
                                : undefined,
                              color: isPedagogia ? 'var(--eh-pm-board-column-header-fg)' : 'var(--eh-text-3)',
                              flex: 1,
                              // Pedagogia: quebra em 2 linhas como o Trello, sem cortar.
                              overflow: isPedagogia ? undefined : 'hidden',
                              textOverflow: isPedagogia ? undefined : 'ellipsis',
                              whiteSpace: isPedagogia ? 'normal' : 'nowrap',
                            }}
                          >
                            {bucket.name}
                          </span>
                          <span
                            style={{
                              marginLeft: 8,
                              // Mesma correção do nome: 16 era derivado do wrapper.
                              // No Trello a contagem é discreta, menor que o nome.
                              fontSize: isPedagogia ? 12 : 11.5,
                              fontWeight: isPedagogia ? 500 : 700,
                              color: isPedagogia ? 'var(--eh-pm-board-column-header-fg)' : 'var(--eh-muted-2)',
                              background: isPedagogia ? 'transparent' : 'var(--eh-border)',
                              borderRadius: 20,
                              padding: isPedagogia ? '0' : '1px 8px',
                              flexShrink: 0,
                            }}
                          >
                            {bucketTasks.length}
                          </span>
                          {canWrite && (
                            <button
                              type="button"
                              aria-label={`Opções da coluna ${bucket.name}`}
                              title="Opções da coluna"
                              onClick={(e) => {
                                e.stopPropagation()
                                const rect = e.currentTarget.getBoundingClientRect()
                                if (openMenuBucketId === bucket.id) {
                                  setOpenMenuBucketId(null)
                                  setMenuAnchorRect(null)
                                } else {
                                  setMenuAnchorRect({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width })
                                  setOpenMenuBucketId(bucket.id)
                                }
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              style={{
                                flexShrink: 0, marginLeft: 6, padding: '2px 6px',
                                border: 'none', background: 'transparent',
                                cursor: 'pointer', color: 'var(--eh-muted-2)',
                                display: 'flex', alignItems: 'center', borderRadius: 5,
                                fontSize: 15, letterSpacing: 2, lineHeight: 1,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-border)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                            >
                              ⋯
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  }
                >
                  {/* TASK LIST — SortableContext por coluna dentro do DndContext único. ELO-2153. */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 8px' }}>
                    <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                      {orderedTasks.map((task) => (
                        <MarketingKanbanCard
                          key={task.id}
                          sortableId={task.id}
                          bucketId={bucket.id}
                          task={task}
                          onExpand={() => handleExpandTask(task)}
                          accentColor={accentColor}
                          onStartDateAutoFilled={(t, date) => setToastTask({ task: t, date })}
                          readOnly={!canWrite}
                          buckets={otherBucketsForCard}
                          allBuckets={allBucketsForCard}
                          onMove={(toBucketId) => void handleMoveTask(task, toBucketId)}
                          onClone={(targetBucketId) => void handleCloneTask(task, targetBucketId)}
                          onDelete={() => setDeleteTaskTarget(task)}
                          highlighted={task.id === activeHighlightId}
                          users={users}
                          area={area}
                          labelsById={labelsById}
                          onToggleArchive={projectId ? () => void handleToggleArchive(task) : undefined}
                        />
                      ))}
                    </SortableContext>

                    {/* SEÇÃO TAREFAS CONCLUÍDAS — Marketing/Administrativo apenas.
                        Decisão explícita do Marcos (ELO-3182): a Pedagogia NÃO tem
                        seção colapsável, como o Trello real — `doneTasks` já é
                        sempre [] aqui para 'pedagogia' (doneTasksByBucket retorna
                        {} nessa área), então este bloco nunca renderiza lá. Guarda
                        redundante em `area !== 'pedagogia'` deixa a intenção
                        explícita em vez de depender só do array vazio. */}
                    {area !== 'pedagogia' && doneTasks.length > 0 && (
                      <div
                        style={{
                          marginTop: bucketTasks.length > 0 ? 4 : 0,
                          borderTop: bucketTasks.length > 0 ? '1px solid var(--eh-border)' : 'none',
                          paddingTop: bucketTasks.length > 0 ? 6 : 0,
                        }}
                      >
                        <button
                          onClick={() => toggleDoneBucket(bucket.id)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 0',
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: 'var(--eh-text-3)',
                          }}
                        >
                          {isDoneExpanded ? '▼' : '▶'} Tarefas concluídas ({doneTasks.length})
                        </button>
                        {isDoneExpanded && doneTasks.map((task) => (
                          // Este bloco só renderiza para Marketing/Administrativo
                          // (guarda `area !== 'pedagogia'` acima) — a Pedagogia não
                          // tem mais seção colapsável nem esmaecimento de concluídas
                          // (ver tasksByBucket/doneTasksByBucket acima). Opacidade
                          // 0,7 sempre aqui, sem ramo condicional: TypeScript já
                          // estreita `area` para excluir 'pedagogia' neste escopo.
                          <div key={task.id} style={{ opacity: 0.7 }}>
                            <MarketingKanbanCard
                              sortableId={task.id}
                              bucketId={bucket.id}
                              task={task}
                              onExpand={() => handleExpandTask(task)}
                              accentColor={accentColor}
                              onStartDateAutoFilled={(t, date) => setToastTask({ task: t, date })}
                              readOnly={!canWrite}
                              buckets={otherBucketsForCard}
                              allBuckets={allBucketsForCard}
                              onMove={(toBucketId) => void handleMoveTask(task, toBucketId)}
                              onClone={(targetBucketId) => void handleCloneTask(task, targetBucketId)}
                              onDelete={() => setDeleteTaskTarget(task)}
                              highlighted={task.id === activeHighlightId}
                              users={users}
                              area={area}
                              labelsById={labelsById}
                              onToggleArchive={projectId ? () => void handleToggleArchive(task) : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ADD TASK */}
                  {canWrite && (
                    <div style={{ padding: '0 12px 12px', flexShrink: 0 }}>
                      <button
                        onClick={() => setNewTaskBucket(bucket)}
                        style={addTaskBtnStyle}
                        dangerouslySetInnerHTML={{ __html: `${PLUS_ICON} Adicionar tarefa` }}
                      />
                    </div>
                  )}
                </SortableColumn>
              )
            })}
          </SortableContext>

          {/* ELO-3182 (Pedagogia): o card arrastado é renderizado AQUI, fora
              das colunas, num portal do próprio dnd-kit. Antes ele era o
              elemento dentro da coluna — que tem `overflowY: auto` —, então
              aparecia CORTADO ao passar para outra coluna (relato do Marcos).
              O overlay também elimina a travada ao arrastar para cima/baixo:
              o elemento flutuante não participa do layout da lista, então
              mover não força recálculo de posição dos 454 vizinhos.

              Marketing/Administrativo continuam sem overlay (comportamento
              anterior intacto) — `activeDragTask` só é preenchido quando
              `isPedagogia`. */}
          <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
            {isPedagogia && activeDragTask ? (
              <div
                style={{
                  // Mesma linguagem visual do card "na mão" que o Marcos
                  // aprovou ("gostei do jeito que ele se locomove"), agora
                  // sem depender do elemento original.
                  transform: 'rotate(3deg)',
                  boxShadow: '0 12px 24px -6px rgba(15,23,42,0.35), 0 0 0 1px rgba(15,23,42,0.06)',
                  borderRadius: 8,
                  cursor: 'grabbing',
                  width: isMobile ? '85vw' : 272 - 24,
                }}
              >
                <MarketingKanbanCard
                  sortableId={activeDragTask.id}
                  bucketId={activeDragTask.bucketId}
                  task={activeDragTask}
                  onExpand={() => {}}
                  accentColor={undefined}
                  readOnly
                  buckets={[]}
                  allBuckets={[]}
                  users={users}
                  area={area}
                  labelsById={labelsById}
                  overlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* ADD BUCKET */}
        {canWrite && (
        <div style={{ width: isMobile ? '85vw' : 280, flexShrink: 0 }}>
          {addingBucket ? (
            <div style={{ background: 'var(--eh-bg)', borderRadius: 12, padding: 14 }}>
              <input
                ref={newBucketRef}
                type="text"
                placeholder="Nome da coluna..."
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddBucket()
                  if (e.key === 'Escape') { setAddingBucket(false); setNewBucketName('') }
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  border: '1px solid var(--eh-primary)',
                  borderRadius: 8,
                  padding: '7px 10px',
                  fontSize: 13,
                  outline: 'none',
                  marginBottom: 8,
                  background: 'var(--eh-surface)',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => void handleAddBucket()}
                  style={{ padding: '5px 14px', borderRadius: 6, background: 'var(--eh-primary)', color: 'var(--eh-surface)', border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Criar
                </button>
                <button
                  onClick={() => { setAddingBucket(false); setNewBucketName('') }}
                  style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--eh-surface)', color: 'var(--eh-text-2)', border: '1px solid var(--eh-border)', fontSize: 12.5, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingBucket(true)}
              // Pedagogia: branco translúcido sobre o gradiente, como o
              // Trello real (captura enviada pelo Marcos). O `#62B09B` que ele
              // identificou é o RESULTADO da sobreposição naquele ponto, não
              // uma cor chapada: resolvendo `resultado = fundo(1-α) + 255α`
              // contra o fundo medido ali (#2e9376) dá α ≈ 0,26 por canal
              // (0,249 / 0,269 / 0,270). Por isso o botão acompanha o
              // gradiente em vez de destoar dele — e por isso `#62B09B`
              // chapado ficaria errado em qualquer outro ponto da tela.
              //
              // Bônus: resolve o problema de contraste. Branco sobre #62B09B
              // chapado dá 2,56:1 (reprova AA); translúcido sobre o gradiente
              // o composto acompanha o fundo e a legibilidade se mantém —
              // mesma técnica já validada no cabeçalho desta tela.
              className={isPedagogia ? 'eh-pm-add-column' : undefined}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: isPedagogia ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.6)',
                border: isPedagogia ? 'none' : '1.5px dashed var(--eh-border-hover)',
                borderRadius: isPedagogia ? 8 : 12,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: isPedagogia ? 600 : undefined,
                color: isPedagogia ? '#ffffff' : 'var(--eh-text-2)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: isPedagogia ? 'background-color .15s ease' : undefined,
              }}
              dangerouslySetInnerHTML={{ __html: `${PLUS_ICON} Nova coluna` }}
            />
          )}
        </div>
        )}
      </div>

      {/* DROPDOWN MENU DE OPÇÕES DE COLUNA (ELO-2154) — portal no body para não ser cortado pelo overflow */}
      {openMenuBucketId && menuAnchorRect && createPortal(
        <div
          ref={menuDropdownRef}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: menuAnchorRect.bottom + 4,
            left: menuAnchorRect.right - 168,
            width: 168,
            background: 'var(--eh-surface)',
            border: '1px solid var(--eh-border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.16)',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => {
              const bucket = buckets.find((b) => b.id === openMenuBucketId)
              if (bucket) {
                setEditingBucketId(bucket.id)
                setEditingBucketName(bucket.name)
              }
              setOpenMenuBucketId(null)
              setMenuAnchorRect(null)
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 14px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--eh-text)',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Editar
          </button>
          <div style={{ height: 1, background: 'var(--eh-border)', margin: '0 8px' }} />
          <button
            type="button"
            onClick={() => {
              const bucket = buckets.find((b) => b.id === openMenuBucketId)
              if (bucket) setDeleteBucketTarget(bucket)
              setOpenMenuBucketId(null)
              setMenuAnchorRect(null)
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 14px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--eh-danger)',
              textAlign: 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Excluir Coluna
          </button>
        </div>,
        document.body,
      )}

      {/* TOAST — startDate auto-fill */}
      {toastTask && (
        <StartDateToast
          date={toastTask.date}
          onOpenTask={() => { openExpand(toastTask.task); setToastTask(null) }}
          onClose={() => setToastTask(null)}
        />
      )}

      {/* TOAST — arquivar/desarquivar tarefa (ELO-3182) */}
      {archiveToast && (
        <ActionToast
          message={archiveToast.message}
          variant={archiveToast.variant}
          actionLabel={archiveToast.undo ? 'Desfazer' : undefined}
          onAction={archiveToast.undo}
          onClose={() => setArchiveToast(null)}
        />
      )}

      {/* TASK DETAIL MODAL */}
      <TaskDetailModal
        task={expandedTask}
        open={modalOpen}
        users={teamUsers}
        showRecurrence
        readOnly={!canWrite}
        // ELO-3182 (refinamento visual): área + nome do bucket + dicionário de
        // etiquetas repassados só para trocar a hierarquia visual do cabeçalho
        // estilo Trello quando area==='pedagogia' — nas demais áreas o modal
        // ignora bucketName/labelsById e renderiza exatamente como hoje.
        area={area}
        bucketName={expandedTask ? bucketMap[expandedTask.bucketId] : undefined}
        labelsById={labelsById}
        projectName={projectTitle}
        onClose={() => { setModalOpen(false); setExpandedTaskId(null) }}
        onSave={(updated) => {
          const previous = tasks.find((t) => t.id === updated.id)
          setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
          // ELO-2044: concluir/desmarcar sao acoes distintas de "editar" no log.
          // Sao as que o usuario mais faz, e chamar as tres de "editou uma
          // tarefa" esconderia exatamente o que se quer auditar.
          const wasDone = previous?.status === 'done'
          const isDone = updated.status === 'done'
          const action =
            isDone && !wasDone
              ? 'pm_task.done'
              : !isDone && wasDone
                ? 'pm_task.undone'
                : 'pm_task.update'
          const changes = diffFields(
            previous as unknown as Record<string, unknown> | undefined,
            updated as unknown as Record<string, unknown>,
          )
          // Sem mudanca de campo E sem transicao de status, o save foi um no-op
          // (abrir e fechar o modal) — nao vira registro.
          if (changes.length > 0 || action !== 'pm_task.update') {
            audit.logTask(
              action,
              { id: updated.id, title: updated.title },
              {
                bucketId: updated.bucketId,
                bucketName: buckets.find((b) => b.id === updated.bucketId)?.name,
                ...(changes.length > 0 ? { changes } : {}),
              },
            )
          }
          if (isDone && !wasDone && updated.recurrence && updated.dueDate && projectId) {
            markTaskDone(projectId, updated.bucketId, updated).catch(console.error)
          }
        }}
        onStartDateAutoFilled={(t, date) => setToastTask({ task: t, date })}
        onToggleChecklistItem={
          expandedTask && projectId
            ? async (itemId, checked) => {
                await toggleChecklistItem(projectId, expandedTask.bucketId, expandedTask, itemId, checked)
                const item = (expandedTask.checklist ?? []).find((c) => c.id === itemId)
                audit.logChecklistItem(
                  'pm_checklist.item_status',
                  expandedTask,
                  { id: itemId, title: item?.title },
                  [{ field: 'concluido', before: !checked, after: checked }],
                )
              }
            : undefined
        }
        onUpdateChecklistItemStatus={
          expandedTask && projectId
            ? async (itemId, status) => {
                const result = await updateChecklistItemStatus(projectId, expandedTask.bucketId, expandedTask, itemId, status)
                const item = (expandedTask.checklist ?? []).find((c) => c.id === itemId)
                audit.logChecklistItem(
                  'pm_checklist.item_status',
                  expandedTask,
                  { id: itemId, title: item?.title },
                  [{ field: 'status', before: item?.status ?? null, after: status }],
                )
                if (result.autoFilledStartDate && result.filledDate) {
                  setToastTask({ task: expandedTask, date: result.filledDate })
                }
              }
            : undefined
        }
        onAddChecklistItem={
          expandedTask && projectId
            ? async (title) => {
                await addChecklistItem(
                  projectId,
                  expandedTask.bucketId,
                  expandedTask.id,
                  title,
                  expandedTask.checklist ?? [],
                )
                audit.logChecklistItem('pm_checklist.item_add', expandedTask, { id: title, title })
              }
            : undefined
        }
        onRenameChecklistItem={
          expandedTask && projectId
            ? async (itemId, newTitle) => {
                const previousTitle = (expandedTask.checklist ?? []).find((c) => c.id === itemId)?.title
                await updateChecklistItemTitle(
                  projectId,
                  expandedTask.bucketId,
                  expandedTask.id,
                  itemId,
                  newTitle,
                  expandedTask.checklist ?? [],
                )
                audit.logChecklistItem(
                  'pm_checklist.item_update',
                  expandedTask,
                  { id: itemId, title: newTitle },
                  [{ field: 'titulo', before: previousTitle ?? null, after: newTitle }],
                )
              }
            : undefined
        }
        onDeleteChecklistItem={
          expandedTask && projectId
            ? async (itemId) => {
                const removed = (expandedTask.checklist ?? []).find((c) => c.id === itemId)
                await deleteChecklistItem(
                  projectId,
                  expandedTask.bucketId,
                  expandedTask.id,
                  itemId,
                  expandedTask.checklist ?? [],
                )
                audit.logChecklistItem('pm_checklist.item_delete', expandedTask, {
                  id: itemId,
                  title: removed?.title,
                })
              }
            : undefined
        }
        onDelete={
          expandedTask && projectId
            ? async (task) => {
                await deletePMTask(projectId, task.bucketId, task.id)
                audit.logTask(
                  'pm_task.delete',
                  { id: task.id, title: task.title },
                  {
                    bucketId: task.bucketId,
                    bucketName: buckets.find((b) => b.id === task.bucketId)?.name,
                  },
                )
                setTasks((prev) => prev.filter((t) => t.id !== task.id))
              }
            : undefined
        }
      />

      {/* MODAL NOVA TAREFA */}
      {newTaskBucket && (
        <NewMarketingTaskModal
          bucket={newTaskBucket}
          users={teamUsers}
          onClose={() => setNewTaskBucket(null)}
          onConfirm={handleNewTaskConfirm}
          area={area}
        />
      )}

      {/* MODAL CONFIRMAÇÃO DE EXCLUSÃO DE COLUNA */}
      {deleteBucketTarget && (
        <DeleteConfirmModal
          title={`Excluir coluna '${deleteBucketTarget.name}'?`}
          subtitle={`${tasks.filter((t) => t.bucketId === deleteBucketTarget.id).length} tarefa(s) serão excluídas permanentemente. Essa ação não pode ser desfeita.`}
          confirmLabel="Excluir coluna"
          cancelLabel="Cancelar"
          deleting={deleting}
          onConfirm={() => void handleDeleteBucket()}
          onCancel={() => setDeleteBucketTarget(null)}
        />
      )}

      {/* MODAL CONFIRMAÇÃO DE EXCLUSÃO DE TAREFA (ELO-2155) */}
      {deleteTaskTarget && (
        <DeleteConfirmModal
          title="Excluir tarefa?"
          subtitle={`A tarefa "${deleteTaskTarget.title}" será excluída permanentemente. Essa ação não pode ser desfeita.`}
          confirmLabel="Excluir tarefa"
          cancelLabel="Cancelar"
          deleting={deletingTask}
          onConfirm={() => void handleConfirmDeleteTask()}
          onCancel={() => setDeleteTaskTarget(null)}
        />
      )}

      {/* MODAL EQUIPE */}
      <TeamModal
        open={teamModalOpen}
        projectId={projectId}
        users={users}
        team={projectTeam}
        onClose={() => setTeamModalOpen(false)}
        onSave={(newTeam) => setProjectTeam(newTeam)}
      />
    </div>
  )
}
