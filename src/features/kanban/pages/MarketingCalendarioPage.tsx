import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { tsFromDate } from '../api/store'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { PMTask } from '../types/pmOffice'
import { usersApi } from '../api/usersApi'
import type { UserRecord } from '../api/usersApi'
import { useRole } from '@/hooks/useRole'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  addChecklistItem,
  deleteChecklistItem,
  getOrCreateAreaProject,
  subscribeMarketingTasks,
  toggleChecklistItem,
  updateChecklistItemStatus,
  updateChecklistItemTitle,
  deletePMTask,
} from '../api/marketingPlannerApi'
import { updatePMTask } from '../api/pmOfficeApi'
import { TaskDetailModal } from '../components/TaskDetailModal'
import { StartDateToast } from '@/components/Toast'
import { usePmAudit } from '../hooks/usePmAudit'

type CalView = 'month' | 'week' | 'day'

const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
// Abreviação para o mobile (coluna de ~40px). Cortar "Seg"/"Sex" e "Qua"/"Qui"
// em 2 letras produz pares idênticos (SE/SE, QU/QU), então a 3ª letra que os
// distingue é mantida — cabe nos ~40px com fontSize 9.5.
const WEEK_DAYS_SHORT = ['D', 'Sg', 'T', 'Qa', 'Qi', 'Sx', 'S']

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const STATUS_DOT: Record<string, string> = {
  todo: 'var(--eh-muted-2)',
  in_progress: '#3b82f6',
  done: '#22c55e',
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  const secs = (ts as { seconds?: number }).seconds
  return typeof secs === 'number' ? new Date(secs * 1000) : null
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDow = firstDay.getDay()
  const days: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) days.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d))
  while (days.length % 7 !== 0) days.push(null)
  return days
}

function getWeekDays(date: Date): Date[] {
  const start = new Date(date)
  start.setDate(date.getDate() - date.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function formatLabel(date: Date, view: CalView): string {
  if (view === 'month') return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
  if (view === 'day') {
    return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`
  }
  const w = getWeekDays(date)
  const [s, e] = [w[0], w[6]]
  const sm = MONTHS[s.getMonth()].slice(0, 3)
  const em = MONTHS[e.getMonth()].slice(0, 3)
  if (s.getMonth() === e.getMonth()) {
    return `${s.getDate()}–${e.getDate()} ${sm} ${e.getFullYear()}`
  }
  return `${s.getDate()} ${sm} – ${e.getDate()} ${em} ${e.getFullYear()}`
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

// Card draggable para tarefas já agendadas nas células do MonthView
function DraggableCalendarTask({
  task,
  isOverdue,
  onClick,
}: {
  task: PMTask
  isOverdue: boolean
  onClick: (e: MouseEvent<HTMLDivElement>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { source: 'calendar' },
  })
  return (
    <div
      ref={setNodeRef}
      title={task.title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 4,
        background: isOverdue ? 'var(--eh-danger-hover, var(--eh-danger-bg))' : 'var(--eh-bg)',
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.4 : 1,
        ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
      }}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          flexShrink: 0,
          background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)',
        }}
      />
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 500,
          color: isOverdue ? 'var(--eh-danger)' : 'var(--eh-text-3)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.3,
        }}
      >
        {task.title}
      </span>
    </div>
  )
}

// Célula droppable de um dia do MonthView — recebe o card arrastado da sidebar ou de outro dia
interface DroppableDayCellProps {
  day: Date
  isToday: boolean
  dayTasks: PMTask[]
  today: Date
  onDayClick: (date: Date) => void
  onTaskClick: (task: PMTask) => void
}

function DroppableDayCell({ day, isToday, dayTasks, today, onDayClick, onTaskClick }: DroppableDayCellProps) {
  const key = dayKey(day)
  const { setNodeRef, isOver } = useDroppable({ id: `day-${key}` })
  const isMobile = useMediaQuery('(max-width: 640px)')
  const visible = dayTasks.slice(0, 3)
  const overflow = dayTasks.length - 3
  return (
    <div
      ref={setNodeRef}
      onClick={() => onDayClick(day)}
      style={{
        minHeight: isMobile ? 56 : 100,
        background: isOver
          ? 'var(--eh-primary-subtle, rgba(59,130,246,0.08))'
          : isToday
            ? 'var(--eh-selection, #bfe0d8)'
            : 'var(--eh-surface)',
        border: `1px solid ${isToday ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
        outline: isOver ? '2px dashed var(--eh-primary)' : 'none',
        borderRadius: isMobile ? 6 : 8,
        padding: isMobile ? '4px 3px' : '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMobile ? 'center' : undefined,
        gap: isMobile ? 2 : 3,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          fontSize: isMobile ? (isToday ? 12 : 11.5) : (isToday ? 13 : 12),
          fontWeight: isToday ? 700 : 400,
          color: isToday
            ? 'var(--eh-primary)'
            : day.getDay() === 0 || day.getDay() === 6
              ? 'var(--eh-muted-2)'
              : 'var(--eh-text-3)',
          lineHeight: 1,
          marginBottom: isMobile ? 2 : 4,
          flexShrink: 0,
        }}
      >
        {day.getDate()}
      </span>
      {/* Em ~50px de coluna não cabe título de tarefa: no mobile a célula vira
          contador de tarefas (toque abre a visão Dia, que lista tudo). */}
      {isMobile ? (
        dayTasks.length > 0 && (
          <span
            aria-label={`${dayTasks.length} ${dayTasks.length === 1 ? 'tarefa' : 'tarefas'}`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999,
              background: 'var(--eh-primary)', color: 'var(--eh-surface)',
              fontSize: 10, fontWeight: 700, lineHeight: 1,
            }}
          >
            {dayTasks.length}
          </span>
        )
      ) : visible.map((task) => {
        const taskDate = toDate(task.dueDate)
        const isOverdue = taskDate !== null && taskDate < today
        return (
          <DraggableCalendarTask
            key={task.id}
            task={task}
            isOverdue={isOverdue}
            onClick={(e) => { e.stopPropagation(); onTaskClick(task) }}
          />
        )
      })}
      {!isMobile && overflow > 0 && (
        <span style={{ fontSize: 10, color: 'var(--eh-muted-2)', paddingLeft: 4 }}>
          +{overflow} mais
        </span>
      )}
    </div>
  )
}

// Mês: clicar num dia navega para a visão Dia daquele dia
interface MonthViewProps {
  calendarDays: (Date | null)[]
  tasksByDay: Record<string, PMTask[]>
  today: Date
  onDayClick: (date: Date) => void
  onTaskClick: (task: PMTask) => void
}

function MonthView({ calendarDays, tasksByDay, today, onDayClick, onTaskClick }: MonthViewProps) {
  const isMobile = useMediaQuery('(max-width: 640px)')
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 8px' : '16px 12px 16px 20px' }}>
      {/* As 7 colunas permanecem no mobile — é a natureza da grade mensal.
          O que encolhe é gap, padding e altura da célula, para caber em ~390px
          sem scroll horizontal. A inicial do dia da semana também
          é abreviada para 1 letra. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: isMobile ? 2 : 4 }}>
        {WEEK_DAYS.map((d) => (
          <div
            key={d}
            style={{
              textAlign: 'center',
              fontSize: isMobile ? 9.5 : 11.5,
              fontWeight: 700,
              color: 'var(--eh-muted-2)',
              textTransform: 'uppercase',
              letterSpacing: isMobile ? 0 : '0.06em',
              padding: '4px 0',
            }}
          >
            {/* Abreviação própria no mobile: cortar em 2 letras produziria
                SE/SE (Seg e Sex) e QU/QU (Qua e Qui), indistinguíveis. */}
            {isMobile ? WEEK_DAYS_SHORT[WEEK_DAYS.indexOf(d)] : d}
          </div>
        ))}
        {calendarDays.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} style={{ minHeight: isMobile ? 56 : 100 }} />
          const isToday = isSameDay(day, today)
          const key = dayKey(day)
          const dayTasks = tasksByDay[key] ?? []
          return (
            <DroppableDayCell
              key={key}
              day={day}
              isToday={isToday}
              dayTasks={dayTasks}
              today={today}
              onDayClick={onDayClick}
              onTaskClick={onTaskClick}
            />
          )
        })}
      </div>
    </div>
  )
}

// Semana: clicar numa tarefa abre o modal
interface WeekViewProps {
  weekDays: Date[]
  tasksByDay: Record<string, PMTask[]>
  today: Date
  onTaskClick: (task: PMTask) => void
}

function WeekView({ weekDays, tasksByDay, today, onTaskClick }: WeekViewProps) {
  const isMobile = useMediaQuery('(max-width: 640px)')
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px 16px' : '16px 12px 16px 20px' }}>
      {/* Diferente do MonthView, aqui cada coluna carrega conteúdo (títulos de
          tarefa), então em ~50px seria ilegível — no mobile empilha em lista
          vertical de 1 coluna. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(7, 1fr)',
        gap: isMobile ? 8 : 4,
        height: isMobile ? undefined : '100%',
        alignContent: 'start',
      }}>
        {weekDays.map((day) => {
          const isToday = isSameDay(day, today)
          const tasks = tasksByDay[dayKey(day)] ?? []
          return (
            <div
              key={dayKey(day)}
              style={{
                background: isToday ? 'var(--eh-selection, #bfe0d8)' : 'var(--eh-surface)',
                border: `1px solid ${isToday ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
                borderRadius: 8,
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                // 200px fixos fazem sentido nas 7 colunas do desktop; empilhado
                // no mobile isso deixaria só ~2 dias visíveis por tela.
                minHeight: isMobile ? 62 : 200,
              }}
            >
              <div style={{ marginBottom: 6, textAlign: 'center' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--eh-muted-2)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
                  {WEEK_DAYS[day.getDay()]}
                </span>
                <span style={{ display: 'block', fontSize: isToday ? 15 : 13, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--eh-primary)' : 'var(--eh-text-strong)' }}>
                  {day.getDate()}
                </span>
              </div>
              {tasks.map((task) => {
                const taskDate = toDate(task.dueDate)
                const overdue = taskDate !== null && taskDate < today
                return (
                  <div
                    key={task.id}
                    title={task.title}
                    onClick={() => onTaskClick(task)}
                    style={{ padding: '2px 5px', borderRadius: 4, background: overdue ? 'var(--eh-danger-hover, var(--eh-danger-bg))' : 'var(--eh-bg)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)' }} />
                    <span style={{ fontSize: 10.5, fontWeight: 500, color: overdue ? 'var(--eh-danger)' : 'var(--eh-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.title}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Dia: clicar numa tarefa abre o modal
interface DayViewProps {
  date: Date
  tasksByDay: Record<string, PMTask[]>
  today: Date
  onTaskClick: (task: PMTask) => void
}

function DayView({ date, tasksByDay, today, onTaskClick }: DayViewProps) {
  const tasks = tasksByDay[dayKey(date)] ?? []
  const isToday = isSameDay(date, today)
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <p style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: isToday ? 'var(--eh-primary)' : 'var(--eh-text-strong)' }}>
        {WEEK_DAYS[date.getDay()]}, {date.getDate()} de {MONTHS[date.getMonth()]} de {date.getFullYear()}
      </p>
      {tasks.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--eh-muted-2)' }}>Nenhuma tarefa para este dia.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((task) => {
            const taskDate = toDate(task.dueDate)
            const overdue = taskDate !== null && taskDate < today
            return (
              <div
                key={task.id}
                onClick={() => onTaskClick(task)}
                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--eh-border)', background: overdue ? 'var(--eh-danger-hover, var(--eh-danger-bg))' : 'var(--eh-surface)', display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 3, flexShrink: 0, background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)' }} />
                <span style={{ fontSize: 13, color: overdue ? 'var(--eh-danger)' : 'var(--eh-text-3)', lineHeight: 1.4 }}>
                  {task.title}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Card draggable da sidebar "Sem data"
function DraggableTaskCard({ task, onOpen }: { task: PMTask; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { source: 'sidebar' } })
  return (
    <div
      ref={setNodeRef}
      style={{
        padding: '8px 10px',
        marginBottom: 6,
        borderRadius: 8,
        border: '1px solid var(--eh-border)',
        background: 'var(--eh-surface-2)',
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.4 : 1,
        ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
      }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span
          style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)' }}
        />
        <span style={{ fontSize: 12.5, color: 'var(--eh-text-3)', lineHeight: 1.4 }}>
          {task.title}
        </span>
      </div>
    </div>
  )
}

// Sidebar "Sem data" como sub-componente dentro do DndContext, para que
// useDroppable encontre o contexto correto (contexto flui para baixo na árvore).
function DroppableSidebar({
  open,
  onToggle,
  unscheduled,
  activeDragTask,
  onOpenTask,
}: {
  open: boolean
  onToggle: (v: boolean) => void
  unscheduled: PMTask[]
  activeDragTask: PMTask | null
  onOpenTask: (task: PMTask) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unscheduled-sidebar' })
  const showHighlight = isOver && !!activeDragTask?.dueDate
  return (
    <div
      ref={setNodeRef}
      style={{
        width: open ? 268 : 32,
        flexShrink: 0,
        borderLeft: '1px solid var(--eh-border)',
        background: showHighlight ? 'var(--eh-primary-subtle, rgba(59,130,246,0.08))' : 'var(--eh-surface)',
        outline: showHighlight ? '2px dashed var(--eh-primary)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.2s ease',
      }}
    >
      {open ? (
        <>
          <div
            onClick={() => onToggle(false)}
            title="Recolher painel"
            style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--eh-bg)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          >
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--eh-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', userSelect: 'none' }}>
              Sem data ({unscheduled.length})
            </p>
            <span style={{ color: 'var(--eh-text-3)', fontSize: 16, lineHeight: 1, flexShrink: 0, userSelect: 'none' }}>›</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            {unscheduled.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--eh-muted-2)', textAlign: 'center', paddingTop: 20 }}>
                Nenhuma tarefa sem data.
              </p>
            ) : (
              unscheduled.map((task) => (
                <DraggableTaskCard key={task.id} task={task} onOpen={() => onOpenTask(task)} />
              ))
            )}
          </div>
        </>
      ) : (
        <div
          onClick={() => onToggle(true)}
          title="Expandir painel Sem data"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, gap: 10, cursor: 'pointer' }}
        >
          <span style={{ color: 'var(--eh-text-3)', fontSize: 16, lineHeight: 1, userSelect: 'none' }}>‹</span>
          <span
            style={{
              writingMode: 'vertical-rl',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--eh-text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            Sem data ({unscheduled.length})
          </span>
        </div>
      )}
    </div>
  )
}

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
  marketing: 'Marketing Diário',
  administrativo: 'Administrativo',
  pedagogia: 'Pedagogia',
}
const RESOURCE_BY_AREA: Record<'marketing' | 'administrativo' | 'pedagogia', 'pm-marketing' | 'pm-administrativo' | 'pm-pedagogia'> = {
  marketing: 'pm-marketing',
  administrativo: 'pm-administrativo',
  pedagogia: 'pm-pedagogia',
}

export function MarketingCalendarioPage({ area = 'pedagogia' }: { area?: 'marketing' | 'administrativo' | 'pedagogia' } = {}) {
  const navigate = useNavigate()
  const navBase = NAV_BASE[area]
  const { roleLevel, canWriteScreen } = useRole()
  const canSeeTemplates = true
  // Viewer só pode ler o calendário — sem editar tarefa via modal.
  // Exceção por tela precisa afetar a escrita, não só a visibilidade.
  const canWrite = canWriteScreen()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  })
  const [calView, setCalView] = useState<CalView>('month')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectTitle, setProjectTitle] = useState(DEFAULT_TITLE[area])
  // Audit log das acoes humanas desta tela.
  const audit = usePmAudit(area, projectId, projectTitle)
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [toastTask, setToastTask] = useState<{ task: PMTask; date: Date } | null>(null)
  const [users, setUsers] = useState<UserRecord[]>([])

  // ID do card sendo arrastado (para DragOverlay)
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  useEffect(() => {
    // Para 'marketing' resolve exatamente como antes (via
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
    const unsub = subscribeMarketingTasks(projectId, (t) => { setTasks(t); setLoading(false) })
    return unsub
  }, [projectId])

  // Usa usersApi.listUsers() (sem includeInactive) em vez de ler a lista
  // crua: herda o filtro de inativos sem precisar
  // reimplementá-lo aqui. Não filtra `task.assigneesNames`/`task.assignees`
  // já persistidos na tarefa: essas listas são um snapshot no momento da
  // atribuição, resolvidas em `TaskDetailModal`/`MarketingKanbanCard`
  // independente deste array — só as OPÇÕES de novo assignment encolhem.
  useEffect(() => {
    usersApi
      .listUsers()
      .then(setUsers)
      .catch(() => undefined)
  }, [])

  // Filtra tarefas concluídas da grade — "done" não aparece em nenhuma visão do calendário
  const tasksByDay = useMemo(() => {
    const map: Record<string, PMTask[]> = {}
    for (const task of tasks) {
      if (task.status === 'done') continue
      const d = toDate(task.dueDate)
      if (!d) continue
      const k = dayKey(d)
      map[k] = [...(map[k] ?? []), task]
    }
    return map
  }, [tasks])

  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.dueDate && t.status !== 'done'),
    [tasks],
  )

  const expandedTask = useMemo(
    () => tasks.find((t) => t.id === expandedTaskId) ?? null,
    [tasks, expandedTaskId],
  )

  // Tarefa correspondente ao card sendo arrastado (para DragOverlay)
  const activeDragTask = useMemo(
    () => (activeDragTaskId ? tasks.find((t) => t.id === activeDragTaskId) ?? null : null),
    [activeDragTaskId, tasks],
  )

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const calendarDays = useMemo(() => getCalendarDays(year, month), [year, month])
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate])

  function goBack() {
    const next = new Date(currentDate)
    if (calView === 'month') { next.setDate(1); next.setMonth(next.getMonth() - 1) }
    else if (calView === 'week') { next.setDate(next.getDate() - 7) }
    else { next.setDate(next.getDate() - 1) }
    setCurrentDate(next)
  }

  function goForward() {
    const next = new Date(currentDate)
    if (calView === 'month') { next.setDate(1); next.setMonth(next.getMonth() + 1) }
    else if (calView === 'week') { next.setDate(next.getDate() + 7) }
    else { next.setDate(next.getDate() + 1) }
    setCurrentDate(next)
  }

  function goToday() {
    const d = new Date(); d.setHours(0, 0, 0, 0); setCurrentDate(d)
  }

  // Abre a visão Dia para a data clicada (vinda do MonthView)
  function goToDay(date: Date) {
    setCurrentDate(date)
    setCalView('day')
  }

  function openTask(task: PMTask) {
    setExpandedTaskId(task.id)
    setModalOpen(true)
  }

  // Ao soltar um card sobre uma célula de dia do MonthView, reagenda a tarefa.
  // Cobre dois cenários: card da sidebar "Sem data" e card já agendado de outro dia.
  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragTaskId(null)
    const { active, over } = event
    if (!over) return
    const overId = over.id as string

    // Cenário: calendário → sidebar (remove dueDate, tarefa volta para "Sem data")
    if (overId === 'unscheduled-sidebar') {
      const task = tasks.find((t) => t.id === (active.id as string))
      if (!task || !task.dueDate) return
      await updatePMTask(task.projectId, task.bucketId, task.id, { dueDate: null })
      audit.logTask(
        'pm_task.update',
        { id: task.id, title: task.title },
        {
          bucketId: task.bucketId,
          changes: [{ field: 'dueDate', before: toDate(task.dueDate), after: null }],
        },
      )
      return
    }

    if (!overId.startsWith('day-')) return
    // dayKey usa getMonth() (0-indexed); new Date() também usa mês 0-indexed — sem subtrair 1
    const dayStr = overId.replace('day-', '')
    const [y, m, d] = dayStr.split('-').map(Number)
    const targetDate = new Date(y, m, d, 12, 0, 0)
    const taskId = active.id as string
    const source = active.data.current?.source as string | undefined

    if (source === 'calendar') {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return
      // Não reagenda se o destino é o mesmo dia de origem
      const existingDate = toDate(task.dueDate)
      if (existingDate && isSameDay(existingDate, targetDate)) return
      await updatePMTask(task.projectId, task.bucketId, task.id, {
        dueDate: tsFromDate(targetDate),
      })
      audit.logTask(
        'pm_task.update',
        { id: task.id, title: task.title },
        {
          bucketId: task.bucketId,
          changes: [{ field: 'dueDate', before: existingDate, after: targetDate }],
        },
      )
    } else {
      // source === 'sidebar' ou sem source (compatibilidade com drags legados)
      const task = unscheduled.find((t) => t.id === taskId)
      if (!task) return
      await updatePMTask(task.projectId, task.bucketId, task.id, {
        dueDate: tsFromDate(targetDate),
      })
      audit.logTask(
        'pm_task.update',
        { id: task.id, title: task.title },
        {
          bucketId: task.bucketId,
          changes: [{ field: 'dueDate', before: null, after: targetDate }],
        },
      )
    }
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
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveDragTaskId(active.id as string)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragTaskId(null)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--eh-bg)' }}>
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: isMobile ? 'stretch' : 'center',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'space-between',
            padding: isMobile ? '12px 12px 10px' : '16px 24px 12px',
            background: 'var(--eh-surface)',
            borderBottom: '1px solid var(--eh-border)',
            flexShrink: 0,
            gap: isMobile ? 10 : 16,
          }}
        >
          <h1 style={{ margin: 0, fontSize: isMobile ? 15.5 : 17, fontWeight: 700, color: 'var(--eh-text-strong)' }}>
            {projectTitle}
          </h1>
          {/* 4 abas + título não cabem lado a lado em 390px: no mobile o header
              empilha e as abas rolam horizontalmente dentro da própria faixa. */}
          <div style={{ display: 'flex', gap: 4, overflowX: isMobile ? 'auto' : undefined, paddingBottom: isMobile ? 2 : undefined }}>
            <NavButton label="Quadro" active={false} onClick={() => navigate(`${navBase}/quadro`)} />
            <NavButton label="Calendário" active={true} onClick={() => undefined} />
            {canSeeTemplates && (
              <NavButton label="Templates" active={false} onClick={() => navigate(`${navBase}/templates`)} />
            )}
          </div>
        </div>

        {/* TOOLBAR */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 8 : 12,
            padding: isMobile ? '10px 12px' : '12px 24px',
            background: 'var(--eh-surface)',
            borderBottom: '1px solid var(--eh-border)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={goBack}
            style={{ width: 30, height: 30, flexShrink: 0, border: '1px solid var(--eh-border)', borderRadius: 7, background: 'var(--eh-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
          >
            ‹
          </button>
          {/* minWidth 220 fixo empurrava a toolbar além de 390px; no mobile o
              rótulo ocupa o espaço disponível entre as setas. */}
          <span style={{ fontSize: isMobile ? 13.5 : 15, fontWeight: 700, color: 'var(--eh-text-strong)', minWidth: isMobile ? 0 : 220, flex: isMobile ? 1 : undefined, textAlign: 'center' }}>
            {formatLabel(currentDate, calView)}
          </span>
          <button
            onClick={goForward}
            style={{ width: 30, height: 30, border: '1px solid var(--eh-border)', borderRadius: 7, background: 'var(--eh-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
          >
            ›
          </button>
          <button
            onClick={goToday}
            style={{ marginLeft: 8, padding: '5px 14px', border: '1px solid var(--eh-border)', borderRadius: 7, background: 'var(--eh-surface)', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, color: 'var(--eh-text-3)' }}
          >
            Hoje
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <NavButton label="Mês" active={calView === 'month'} onClick={() => setCalView('month')} />
            <NavButton label="Semana" active={calView === 'week'} onClick={() => setCalView('week')} />
            {/* Dia: sempre abre o dia de hoje */}
            <NavButton label="Dia" active={calView === 'day'} onClick={() => { goToday(); setCalView('day') }} />
          </div>
        </div>

        {/* CONTENT */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          {calView === 'month' && (
            <MonthView
              calendarDays={calendarDays}
              tasksByDay={tasksByDay}
              today={today}
              onDayClick={goToDay}
              onTaskClick={openTask}
            />
          )}
          {calView === 'week' && (
            <WeekView
              weekDays={weekDays}
              tasksByDay={tasksByDay}
              today={today}
              onTaskClick={openTask}
            />
          )}
          {calView === 'day' && (
            <DayView
              date={currentDate}
              tasksByDay={tasksByDay}
              today={today}
              onTaskClick={openTask}
            />
          )}

          {/* SIDEBAR — painel "Sem data", recolhível e droppable.
              DroppableSidebar é um sub-componente renderizado DENTRO do DndContext
              para que useDroppable encontre o contexto correto via árvore React. */}
          <DroppableSidebar
            open={sidebarOpen}
            onToggle={setSidebarOpen}
            unscheduled={unscheduled}
            activeDragTask={activeDragTask}
            onOpenTask={openTask}
          />
        </div>

        {/* TOAST — startDate auto-fill */}
        {toastTask && (
          <StartDateToast
            date={toastTask.date}
            onOpenTask={() => { openTask(toastTask.task); setToastTask(null) }}
            onClose={() => setToastTask(null)}
          />
        )}

        {/* TASK DETAIL MODAL */}
        <TaskDetailModal
          task={expandedTask}
          open={modalOpen}
          users={users}
          showRecurrence
          readOnly={!canWrite}
          onClose={() => { setModalOpen(false); setExpandedTaskId(null) }}
          onSave={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
          }}
          onStartDateAutoFilled={(t, date) => setToastTask({ task: t, date })}
          onToggleChecklistItem={
            expandedTask && projectId
              ? async (itemId, checked) => {
                  await toggleChecklistItem(projectId, expandedTask.bucketId, expandedTask, itemId, checked)
                  audit.logChecklistItem(
                    'pm_checklist.item_status',
                    expandedTask,
                    {
                      id: itemId,
                      title: (expandedTask.checklist ?? []).find((c) => c.id === itemId)?.title,
                    },
                    [{ field: 'concluido', before: !checked, after: checked }],
                  )
                }
              : undefined
          }
          onUpdateChecklistItemStatus={
            expandedTask && projectId
              ? async (itemId, status) => {
                  const previousItem = (expandedTask.checklist ?? []).find((c) => c.id === itemId)
                  const result = await updateChecklistItemStatus(projectId, expandedTask.bucketId, expandedTask, itemId, status)
                  audit.logChecklistItem(
                    'pm_checklist.item_status',
                    expandedTask,
                    { id: itemId, title: previousItem?.title },
                    [{ field: 'status', before: previousItem?.status ?? null, after: status }],
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
                  audit.logTask('pm_task.delete', { id: task.id, title: task.title }, {
                    bucketId: task.bucketId,
                  })
                  setTasks((prev) => prev.filter((t) => t.id !== task.id))
                  setModalOpen(false)
                  setExpandedTaskId(null)
                }
              : undefined
          }
        />
      </div>

      {/* DRAG OVERLAY — cópia leve do card sendo arrastado */}
      <DragOverlay>
        {activeDragTask ? (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--eh-border)',
              background: 'var(--eh-surface-2)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              width: 244,
              opacity: 0.9,
              pointerEvents: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <span
                style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: STATUS_DOT[activeDragTask.status] ?? 'var(--eh-muted-2)' }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--eh-text-3)', lineHeight: 1.4 }}>
                {activeDragTask.title}
              </span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
