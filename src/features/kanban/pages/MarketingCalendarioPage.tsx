import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
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
import type { PMOfficeLabel, PMTask } from '../types/pmOffice'
import { usersApi } from '../api/usersApi'
import type { UserRecord } from '../api/usersApi'
import { useRole } from '@/hooks/useRole'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import {
  addChecklistItem,
  deleteChecklistItem,
  getOrCreateAreaProject,
  markTaskDone,
  subscribeMarketingTasks,
  subscribePMOfficeLabels,
  toggleChecklistItem,
  updateChecklistItemStatus,
  updateChecklistItemTitle,
  deletePMTask,
} from '../api/marketingPlannerApi'
import { updatePMTask } from '../api/pmOfficeApi'
import { TaskDetailModal } from '../components/TaskDetailModal'
import { TeamModal } from '../components/TeamModal'
import { LabelChips } from '../components/LabelChips'
import { AssigneeAvatars } from '../components/AssigneeAvatars'
import {
  STATUS_DOT,
  CARD_STATUS_OPTIONS,
  CARD_STATUS_LABEL,
  findPhotoByName,
  fmtDate,
} from '../components/MarketingKanbanCard'
import { StartDateToast } from '@/components/Toast'
// Mesmos dropdowns/estilo do Quadro (KanbanBoardPage) — ver comentário
// acima do bloco de filtros mais abaixo para o porquê da paridade.
// `SortDropdown` NÃO entra: suas opções são "ordem manual" (drag entre
// posições de coluna) e "data" (que aqui já É a estrutura da grade) —
// nenhuma das duas se aplica a uma visão organizada por dia.
import { LabelFilterDropdown, NO_LABEL_FILTER_KEY } from '../components/LabelFilterDropdown'
import { AssigneeFilterDropdown, StatusFilterDropdown, NO_ASSIGNEE_FILTER_KEY } from '../components/BoardFiltersDropdown'
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

/**
 * Opções do filtro de Status no header — sem "Concluída": tarefa `done` já é
 * excluída da grade em TODA visão do calendário (regra pré-existente, ver
 * `tasksByDay`/`unscheduled`), então oferecer esse filtro escondendo tudo
 * seria um controle que nunca mostra nada.
 */
const STATUS_OPTIONS_CAL: { id: PMTask['status']; label: string }[] = [
  { id: 'todo', label: 'A fazer' },
  { id: 'in_progress', label: 'Em andamento' },
  { id: 'atrasado', label: 'Atrasada' },
]

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

/**
 * Idêntico ao `NavButton` de `KanbanBoardPage.tsx` — mesmo componente,
 * duplicado porque as duas telas não compartilham um módulo de UI comum
 * ainda. `pedagogia`: botões do header transparentes sobre o fundo do
 * quadro/calendário, com texto branco, ganhando fundo translúcido só no
 * hover (classe `.eh-pm-header-btn`, que também cobre o `:hover` — não
 * declarável inline). Ativo ("Calendário"): fundo translúcido mais forte +
 * borda, via `data-active` (mesma classe lê o atributo).
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
/**
 * Card de tarefa da visão Dia — visual pareado com `MarketingKanbanCard`
 * (etiqueta, chip de status clicável, data, avatares dos responsáveis), mas
 * SEM as partes que só fazem sentido dentro de uma coluna do Quadro: sem
 * arrasto (`useSortable` exige um `SortableContext`, que esta tela não tem —
 * um dia não é uma coluna) e sem menu "Mover para outra coluna"/"Clonar"
 * (não existe coluna de destino aqui). Clicar no corpo do card abre o mesmo
 * `TaskDetailModal` que o Quadro usa.
 */
function DayTaskCard({
  task,
  today,
  onOpen,
  onChangeStatus,
  users,
  labelsById,
}: {
  task: PMTask
  today: Date
  onOpen: () => void
  onChangeStatus: (next: PMTask['status']) => void
  users: UserRecord[]
  labelsById: Map<string, PMOfficeLabel>
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const taskDate = toDate(task.dueDate)
  const overdue = taskDate !== null && taskDate < today && task.status !== 'done'
  const names = task.assigneesNames ?? []

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--eh-border)',
        background: 'var(--eh-surface)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
        cursor: 'pointer',
      }}
      onClick={onOpen}
    >
      {task.labels && task.labels.length > 0 && (
        <LabelChips labelIds={task.labels} labelsById={labelsById} />
      )}
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--eh-text)', lineHeight: 1.4 }}>
        {task.title}
      </p>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* Chip de status clicável — mesmas 3 opções e mesma paleta do
              menu "⋯" do card do Quadro (STATUS_DOT/CARD_STATUS_OPTIONS,
              importados de MarketingKanbanCard.tsx). */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setStatusMenuOpen((v) => !v) }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--eh-text-2)',
              background: 'var(--eh-bg)',
              border: '1px solid var(--eh-border)',
              borderRadius: 20,
              padding: '3px 9px 3px 7px',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)', flexShrink: 0 }} />
            {CARD_STATUS_LABEL[task.status] ?? task.status}
          </button>
          {statusMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                zIndex: 20,
                background: 'var(--eh-surface)',
                border: '1px solid var(--eh-border)',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
                padding: 4,
                minWidth: 150,
              }}
            >
              {CARD_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChangeStatus(opt.value); setStatusMenuOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
                    fontSize: 12.5, fontWeight: task.status === opt.value ? 600 : 500,
                    color: task.status === opt.value ? 'var(--eh-text-strong)' : 'var(--eh-text-2)',
                    background: 'transparent', border: 'none', borderRadius: 5, padding: '6px 8px', cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: STATUS_DOT[opt.value] }} />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {taskDate && (
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: overdue ? 'var(--eh-danger)' : 'var(--eh-text-2)',
                background: overdue ? 'var(--eh-danger-hover, var(--eh-danger-bg))' : 'transparent',
                padding: overdue ? '2px 6px' : 0,
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              {fmtDate(taskDate)}
            </span>
          )}
        </div>
        {names.length > 0 && (
          <div onClick={(e) => e.stopPropagation()}>
            <AssigneeAvatars
              names={names}
              photoURLs={names.map((name) => findPhotoByName(name, users))}
              max={3}
              size={22}
            />
          </div>
        )}
      </div>
    </div>
  )
}

interface DayViewProps {
  date: Date
  tasksByDay: Record<string, PMTask[]>
  today: Date
  onTaskClick: (task: PMTask) => void
  onChangeStatus: (task: PMTask, next: PMTask['status']) => void
  users: UserRecord[]
  labelsById: Map<string, PMOfficeLabel>
}

function DayView({ date, tasksByDay, today, onTaskClick, onChangeStatus, users, labelsById }: DayViewProps) {
  const tasks = tasksByDay[dayKey(date)] ?? []
  const isToday = isSameDay(date, today)
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      {/* Cabeçalho do dia — card com fundo próprio: uma linha de texto solta
          sobre o gradiente do header (versão anterior) ficava com contraste
          ruim e sem destaque de "tela de detalhe". */}
      <div
        style={{
          padding: '14px 18px',
          borderRadius: 10,
          marginBottom: 16,
          background: isToday ? 'var(--eh-primary-soft, var(--eh-surface))' : 'var(--eh-surface)',
          border: `1px solid ${isToday ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
        }}
      >
        <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: isToday ? 'var(--eh-primary)' : 'var(--eh-text-strong)' }}>
          {WEEK_DAYS[date.getDay()]}, {date.getDate()} de {MONTHS[date.getMonth()]} de {date.getFullYear()}
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--eh-text-2)' }}>
          {tasks.length === 0 ? 'Nenhuma tarefa' : tasks.length === 1 ? '1 tarefa' : `${tasks.length} tarefas`}
        </p>
      </div>
      {tasks.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--eh-muted-2)' }}>Nenhuma tarefa para este dia.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((task) => (
            <DayTaskCard
              key={task.id}
              task={task}
              today={today}
              onOpen={() => onTaskClick(task)}
              onChangeStatus={(next) => onChangeStatus(task, next)}
              users={users}
              labelsById={labelsById}
            />
          ))}
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
  const [projectTeam, setProjectTeam] = useState<string[]>([])
  // Audit log das acoes humanas desta tela.
  const audit = usePmAudit(area, projectId, projectTitle)
  const [tasks, setTasks] = useState<PMTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [toastTask, setToastTask] = useState<{ task: PMTask; date: Date } | null>(null)
  const [users, setUsers] = useState<UserRecord[]>([])
  const [teamModalOpen, setTeamModalOpen] = useState(false)

  // Filtros — mesmo conjunto de estado do Quadro (KanbanBoardPage), pra que
  // as duas telas listem o mesmo recorte de tarefas quando os filtros
  // estiverem ajustados igual. `searchQuery` cobre o campo de busca do
  // header; `showArchived` inclui tarefas arquivadas na grade (o Quadro usa
  // o mesmo toggle pro mesmo propósito).
  const [labels, setLabels] = useState<PMOfficeLabel[]>([])
  const [labelFilter, setLabelFilter] = useState<string[]>([])
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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
        if (proj.team) setProjectTeam(proj.team)
      })
      .catch(() => { setError('Erro ao carregar projeto.'); setLoading(false) })
  }, [area])

  useEffect(() => {
    if (!projectId) return
    const unsub = subscribeMarketingTasks(projectId, (t) => { setTasks(t); setLoading(false) }, { includeArchived: showArchived })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showArchived intencionalmente re-assina o listener (mesmo padrão do Quadro — não é filtro client-side sobre o mesmo snapshot)
  }, [projectId, showArchived])

  // Dicionário de etiquetas do projeto — mesmo assinante do Quadro.
  useEffect(() => {
    if (!projectId) return
    return subscribePMOfficeLabels(projectId, setLabels)
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

  // `project.team` guarda UIDs (ver `seed.ts`), com fallback pro array
  // completo de usuários caso a equipe salva não bata com ninguém — mesmo
  // raciocínio do Quadro (`KanbanBoardPage.teamUsers`): times antigos podem
  // ter gravado nome em vez de UID, e cair pra lista vazia mascararia o erro.
  const teamUsers = useMemo(() => {
    if (projectTeam.length === 0) return users
    const filtered = users.filter((u) => projectTeam.includes(u.uid) || projectTeam.includes(u.name))
    return filtered.length > 0 ? filtered : users
  }, [users, projectTeam])

  // Dicionário de etiquetas por id — o card da visão Dia usa pra montar os
  // chips (`LabelChips`), mesmo padrão do Quadro (`KanbanBoardPage.labelsById`).
  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])

  /** Mesma função do Quadro — ver `KanbanBoardPage.matchesLabelFilter`. */
  function matchesLabelFilter(t: PMTask): boolean {
    if (labelFilter.length === 0) return true
    const taskLabels = t.labels ?? []
    if (labelFilter.includes(NO_LABEL_FILTER_KEY) && taskLabels.length === 0) return true
    return taskLabels.some((id) => labelFilter.includes(id))
  }

  /**
   * Tarefa passa em todos os filtros do header (etiqueta, responsável,
   * status, busca) — mesmas regras do Quadro (`KanbanBoardPage.tasksByBucket`),
   * portadas aqui pra que as duas telas listem o mesmo recorte quando
   * ajustadas igual. "Concluída" continua excluída da grade INDEPENDENTE do
   * filtro de status (regra pré-existente deste calendário — ver comentário
   * abaixo), então não faz sentido oferecer "Concluída" como opção aqui.
   */
  function matchesFilters(t: PMTask, q: string): boolean {
    if (!matchesLabelFilter(t)) return false
    if (statusFilter.length > 0 && !statusFilter.includes(t.status)) return false
    if (assigneeFilter.length > 0) {
      const uids = t.assignees ?? []
      const semResponsavel = uids.length === 0
      const casa = assigneeFilter.includes(NO_ASSIGNEE_FILTER_KEY)
        ? semResponsavel || uids.some((u) => assigneeFilter.includes(u))
        : uids.some((u) => assigneeFilter.includes(u))
      if (!casa) return false
    }
    if (!q) return true
    return (
      t.title.toLowerCase().includes(q) ||
      (t.checklist ?? []).some((item) => item.title.toLowerCase().includes(q))
    )
  }

  // Filtra tarefas concluídas da grade — "done" não aparece em nenhuma visão do calendário
  const tasksByDay = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const map: Record<string, PMTask[]> = {}
    for (const task of tasks) {
      if (task.status === 'done') continue
      if (!matchesFilters(task, q)) continue
      const d = toDate(task.dueDate)
      if (!d) continue
      const k = dayKey(d)
      map[k] = [...(map[k] ?? []), task]
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesFilters fecha sobre labelFilter/assigneeFilter/statusFilter, listados explicitamente abaixo
  }, [tasks, searchQuery, labelFilter, assigneeFilter, statusFilter])

  const unscheduled = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return tasks.filter((t) => !t.dueDate && t.status !== 'done' && matchesFilters(t, q))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesFilters fecha sobre labelFilter/assigneeFilter/statusFilter, listados explicitamente abaixo
  }, [tasks, searchQuery, labelFilter, assigneeFilter, statusFilter])

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

  /**
   * Troca o status pelo chip do card da visão Dia — mesma semântica de
   * `KanbanBoardPage.handleChangeTaskStatus`, replicada aqui porque o
   * Calendário tem seu próprio caminho de tarefas/audit:
   *  - `progress` 100 ao concluir, 0 ao voltar para "A fazer";
   *  - checklist inteiro marcado como finalizado na transição para done;
   *  - `markTaskDone` para tarefa recorrente com prazo.
   * Concluir tira a tarefa da grade (regra pré-existente: `done` nunca
   * aparece em nenhuma visão do calendário) — o chip aqui é sobretudo pra
   * corrigir status errado sem abrir o modal, ou reabrir uma já concluída
   * por engano por outro caminho.
   */
  async function handleDayCardStatusChange(task: PMTask, next: PMTask['status']) {
    if (!projectId || next === task.status) return
    const isDone = next === 'done'
    const patch: Record<string, unknown> = { status: next }
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
    setTasks((prev) => prev.map((t) => (t.id === task.id ? ({ ...t, ...patch } as PMTask) : t)))
    try {
      await updatePMTask(projectId, task.bucketId, task.id, patch, {
        clearPreviousStatusBeforeAtrasado: !!task.previousStatusBeforeAtrasado,
      })
      audit.logTask(
        isDone && task.status !== 'done' ? 'pm_task.done' : 'pm_task.update',
        { id: task.id, title: task.title },
        { bucketId: task.bucketId, changes: [{ field: 'status', before: task.status, after: next }] },
      )
      if (isDone && task.status !== 'done' && task.recurrence && task.dueDate) {
        markTaskDone(projectId, task.bucketId, { ...task, ...patch } as PMTask).catch(console.error)
      }
    } catch (err) {
      console.error('[handleDayCardStatusChange] falhou ao mudar status:', err)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    }
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

  // Mesmo fundo gradiente do Quadro (`--eh-pm-board-bg`, ver globals.css) —
  // ambas as telas de `area === 'pedagogia'`, a única montada neste app.
  const isPedagogia = area === 'pedagogia'

  // A casca do app (`AppShell.tsx`) é global e aplica 24px de padding + fundo
  // `--eh-bg` no `<main>` que envolve QUALQUER página, incluindo esta — NÃO
  // tocado aqui de propósito (mudar o `<main>` global vazaria pra toda tela
  // do app). Compensado só localmente, com margem negativa do tamanho do
  // padding do pai + crescimento equivalente em largura/altura — técnica
  // idêntica ao `pageStyle` do Quadro (`KanbanBoardPage.tsx`). Sem isso o
  // gradiente para exatamente na altura do conteúdo (a grade de dias é mais
  // baixa que a viewport) e expõe o cinza do `<main>` por baixo — era
  // precisamente esse bug antes desta técnica.
  const PEDAGOGIA_MAIN_PADDING_PX = 24
  const pageStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: isPedagogia ? '100vh' : '100%',
    minHeight: 0,
    width: isPedagogia ? `calc(100% + ${PEDAGOGIA_MAIN_PADDING_PX * 2}px)` : undefined,
    margin: isPedagogia ? `-${PEDAGOGIA_MAIN_PADDING_PX}px` : undefined,
    overflow: isPedagogia ? 'hidden' : undefined,
    background: isPedagogia ? 'var(--eh-pm-board-bg)' : 'var(--eh-bg)',
  }

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: isMobile ? 'stretch' : 'center',
    flexDirection: isMobile ? 'column' : 'row',
    justifyContent: 'space-between',
    padding: isMobile ? '12px 12px 10px' : isPedagogia ? '0 24px' : '16px 24px 12px',
    height: isMobile || !isPedagogia ? undefined : 48,
    // Barra fundida com o gradiente (fundo translúcido, sem borda) — mesmo
    // padrão do header do Quadro.
    background: isPedagogia ? 'rgba(0,0,0,0.2)' : 'var(--eh-surface)',
    borderBottom: isPedagogia ? 'none' : '1px solid var(--eh-border)',
    flexShrink: 0,
    gap: isMobile ? 10 : 16,
  }

  const toolbarStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: isMobile ? 8 : 12,
    padding: isMobile ? '10px 12px' : '12px 24px',
    background: isPedagogia ? 'rgba(0,0,0,0.12)' : 'var(--eh-surface)',
    borderBottom: isPedagogia ? '1px solid var(--eh-pm-header-border)' : '1px solid var(--eh-border)',
    flexShrink: 0,
    flexWrap: 'wrap',
  }

  const navBtnStyle: CSSProperties = {
    width: 30,
    height: 30,
    flexShrink: 0,
    border: `1px solid ${isPedagogia ? 'var(--eh-pm-header-border)' : 'var(--eh-border)'}`,
    borderRadius: 7,
    background: isPedagogia ? 'var(--eh-pm-header-surface)' : 'var(--eh-surface)',
    color: isPedagogia ? 'var(--eh-pm-header-fg)' : 'var(--eh-text-3)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveDragTaskId(active.id as string)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragTaskId(null)}
    >
      <div style={pageStyle}>
        {/* HEADER */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: isMobile ? 'wrap' : undefined, minWidth: 0, flexShrink: 0 }}>
            <h1 style={{ margin: 0, fontSize: isPedagogia ? 16 : 17, fontWeight: isPedagogia ? 600 : 700, color: isPedagogia ? 'var(--eh-pm-header-fg)' : 'var(--eh-text-strong)' }}>
              {projectTitle}
            </h1>
            {/* Filtros à ESQUERDA, colados no título — mesma posição/regra do
                Quadro (`KanbanBoardPage`): recortam o que a grade mostra,
                natureza diferente das abas de navegação à direita. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flexWrap: isMobile ? 'wrap' : undefined,
                marginLeft: isMobile ? 0 : 8,
                paddingLeft: isMobile ? 0 : 12,
                borderLeft: isMobile ? undefined : `1px solid ${isPedagogia ? 'var(--eh-pm-header-border)' : 'var(--eh-border)'}`,
              }}
            >
              <LabelFilterDropdown labels={labels} selected={labelFilter} onChange={setLabelFilter} pedagogia={isPedagogia} />
              <AssigneeFilterDropdown users={teamUsers} selected={assigneeFilter} onChange={setAssigneeFilter} pedagogia={isPedagogia} />
              <StatusFilterDropdown
                options={STATUS_OPTIONS_CAL}
                selected={statusFilter}
                onChange={setStatusFilter}
                pedagogia={isPedagogia}
              />
            </div>
          </div>
          {/* 3 abas + filtros + busca não cabem lado a lado em 390px: no
              mobile o header empilha e cada faixa rola horizontalmente
              dentro de si — mesmo tratamento do Quadro. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: isMobile ? 'wrap' : undefined, minWidth: 0 }}>
            <div style={{ position: 'relative', width: isMobile ? '100%' : undefined, flex: isMobile ? undefined : '1 1 auto', maxWidth: isMobile ? undefined : 220, minWidth: isMobile ? undefined : 120 }}>
              <input
                type="text"
                placeholder="Buscar"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={isPedagogia ? 'eh-pm-header-input' : undefined}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: isPedagogia ? '7px 12px' : '6px 10px',
                  paddingRight: searchQuery ? 28 : 12,
                  fontSize: 13,
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
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                    color: isPedagogia ? 'var(--eh-pm-header-fg-muted)' : 'var(--eh-muted-2)',
                    lineHeight: 1, padding: 0,
                  }}
                  aria-label="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              title={showArchived ? 'Ocultar tarefas arquivadas' : 'Mostrar tarefas arquivadas'}
              className={isPedagogia ? 'eh-pm-header-btn' : undefined}
              data-active={isPedagogia ? showArchived : undefined}
              style={
                isPedagogia
                  ? { padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 500, border: '1px solid transparent', color: 'var(--eh-pm-header-fg)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
                  : {
                      padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                      border: `1px solid ${showArchived ? 'var(--eh-primary)' : 'var(--eh-border)'}`,
                      background: showArchived ? 'var(--eh-primary-soft, var(--eh-surface))' : 'var(--eh-surface)',
                      color: showArchived ? 'var(--eh-primary)' : 'var(--eh-text-3)',
                    }
              }
            >
              {showArchived ? 'Arquivadas: visíveis' : 'Mostrar arquivadas'}
            </button>
            {/* Abas à direita: mesma posição do Quadro. */}
            <div style={{ display: 'flex', gap: 4, overflowX: isMobile ? 'auto' : undefined, paddingBottom: isMobile ? 2 : undefined }}>
              <NavButton label="Quadro" active={false} onClick={() => navigate(`${navBase}/quadro`)} pedagogia={isPedagogia} />
              <NavButton label="Calendário" active={true} onClick={() => undefined} pedagogia={isPedagogia} />
              <NavButton label="Equipe" active={false} onClick={() => setTeamModalOpen(true)} pedagogia={isPedagogia} />
              {canSeeTemplates && (
                <NavButton label="Templates" active={false} onClick={() => navigate(`${navBase}/templates`)} pedagogia={isPedagogia} />
              )}
            </div>
          </div>
        </div>

        {/* TOOLBAR */}
        <div style={toolbarStyle}>
          <button onClick={goBack} style={navBtnStyle}>‹</button>
          {/* minWidth 220 fixo empurrava a toolbar além de 390px; no mobile o
              rótulo ocupa o espaço disponível entre as setas. */}
          <span style={{ fontSize: isMobile ? 13.5 : 15, fontWeight: 700, color: isPedagogia ? 'var(--eh-pm-header-fg)' : 'var(--eh-text-strong)', minWidth: isMobile ? 0 : 220, flex: isMobile ? 1 : undefined, textAlign: 'center' }}>
            {formatLabel(currentDate, calView)}
          </span>
          <button onClick={goForward} style={navBtnStyle}>›</button>
          <button
            onClick={goToday}
            style={{
              marginLeft: 8, padding: '5px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
              border: `1px solid ${isPedagogia ? 'var(--eh-pm-header-border)' : 'var(--eh-border)'}`,
              background: isPedagogia ? 'var(--eh-pm-header-surface)' : 'var(--eh-surface)',
              color: isPedagogia ? 'var(--eh-pm-header-fg)' : 'var(--eh-text-3)',
            }}
          >
            Hoje
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <NavButton label="Mês" active={calView === 'month'} onClick={() => setCalView('month')} pedagogia={isPedagogia} />
            <NavButton label="Semana" active={calView === 'week'} onClick={() => setCalView('week')} pedagogia={isPedagogia} />
            {/* Dia: sempre abre o dia de hoje */}
            <NavButton label="Dia" active={calView === 'day'} onClick={() => { goToday(); setCalView('day') }} pedagogia={isPedagogia} />
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
              onChangeStatus={(task, next) => void handleDayCardStatusChange(task, next)}
              users={users}
              labelsById={labelsById}
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
          // `area` é o que ativa o modo "documento" (chip de status no
          // cabeçalho, checklist, anexos, comentários) — sem essa prop o
          // modal caía no formulário "clássico" (Título/Observações/Início/
          // Término/Atribuídos em campos soltos), diferente do que o Quadro
          // mostra pra MESMA tarefa. `bucketName` fica de fora de propósito:
          // esta tela não tem conceito de coluna (é organizada por data, não
          // por bucket) — sem essa prop o modal só deixa de mostrar o chip
          // da coluna no cabeçalho, o resto do modo documento funciona igual.
          area={area}
          labelsById={labelsById}
          projectName={projectTitle}
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

      {/* MODAL EQUIPE — mesma equipe do Quadro, mesmo projeto (`getOrCreateAreaProject`
          resolve o mesmo `projectId` nas duas telas). */}
      <TeamModal
        open={teamModalOpen}
        projectId={projectId}
        users={users}
        team={projectTeam}
        onClose={() => setTeamModalOpen(false)}
        onSave={(newTeam) => setProjectTeam(newTeam)}
        onUsersChange={setUsers}
      />
    </DndContext>
  )
}
