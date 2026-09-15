/**
 * Versão em memória do `marketingPlannerApi` do CoreHub — mesmas assinaturas
 * públicas, sem Firestore. As funções `subscribe*` devolvem `Unsubscribe` e
 * reagem a toda mutação através do emissor do `store.ts`.
 */

import type {
  ChecklistItem,
  MarketingTaskTemplate,
  PMBucket,
  PMOfficeLabel,
  PMProject,
  PMTask,
  RecurrenceConfig,
} from '../types/pmOffice'
import {
  Timestamp,
  getState,
  mutate,
  newId,
  subscribe,
  tsNow,
  type KanbanState,
} from './store'
// Registra a fábrica de seed antes do primeiro `getState()`.
import './seed'

import type { PmArea } from './auditLogApi'

type ChecklistStatus = NonNullable<ChecklistItem['status']>
type Unsubscribe = () => void
/** As 3 áreas que têm templates próprios — subconjunto de `PmArea`, igual ao original. */
type TemplateArea = 'marketing' | 'administrativo' | 'pedagogia'

/**
 * Cria uma assinatura reativa: entrega o valor atual e reentrega a cada
 * mutação. O `subscribe` do store já agenda a primeira entrega em microtask,
 * então o callback nunca roda de forma síncrona — mesmo contrato do
 * `onSnapshot`.
 */
function subscribeSelector<T>(select: (state: KanbanState) => T, cb: (value: T) => void): Unsubscribe {
  return subscribe(() => cb(select(getState())))
}

// ── Projeto ──────────────────────────────────────────────────────────────────

export async function getOrCreateAreaProject(_area: PmArea): Promise<PMProject> {
  // O app de demonstração tem UM projeto singleton — `area` não seleciona
  // entre vários como no original, mas a assinatura é preservada.
  return { ...getState().project }
}

// ── Buckets ──────────────────────────────────────────────────────────────────

export function subscribeMarketingBuckets(
  projectId: string,
  cb: (buckets: PMBucket[]) => void,
): Unsubscribe {
  return subscribeSelector(
    (s) =>
      s.buckets
        .filter((b) => b.projectId === projectId)
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((b) => ({ ...b })),
    cb,
  )
}

export async function createMarketingBucket(projectId: string, name: string): Promise<string> {
  const id = newId('bkt')
  mutate((draft) => {
    const maxOrder = draft.buckets.reduce((max, b) => Math.max(max, b.order ?? 0), -1)
    draft.buckets.push({
      id,
      projectId,
      name,
      categoryId: null,
      categoryName: null,
      order: maxOrder + 1,
      externalId: '',
      createdAt: tsNow(),
      updatedAt: tsNow(),
    })
  })
  return id
}

export async function renameBucket(
  projectId: string,
  bucketId: string,
  newName: string,
): Promise<void> {
  mutate((draft) => {
    const bucket = draft.buckets.find((b) => b.id === bucketId && b.projectId === projectId)
    if (!bucket) return
    bucket.name = newName
    bucket.updatedAt = tsNow()
  })
}

export async function reorderBuckets(
  projectId: string,
  orderedBucketIds: string[],
): Promise<void> {
  mutate((draft) => {
    orderedBucketIds.forEach((bucketId, index) => {
      const bucket = draft.buckets.find((b) => b.id === bucketId && b.projectId === projectId)
      if (bucket) bucket.order = index
    })
  })
}

// ── Tarefas ──────────────────────────────────────────────────────────────────

export function subscribeMarketingTasks(
  projectId: string,
  cb: (tasks: PMTask[]) => void,
  opts?: { includeArchived?: boolean },
): Unsubscribe {
  return subscribeSelector((s) => {
    let all = s.tasks.filter((t) => t.projectId === projectId).map((t) => ({ ...t }))
    if (!opts?.includeArchived) all = all.filter((t) => t.archived !== true)
    all.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    return all
  }, cb)
}

export async function createMarketingTask(
  projectId: string,
  bucketId: string,
  title: string,
  opts?: {
    dueDate?: Date
    checklist?: ChecklistItem[]
    recurrence?: RecurrenceConfig
    assignees?: string[]
    assigneesNames?: string[]
  },
): Promise<string> {
  const id = newId('tsk')
  const checklist = opts?.checklist ?? []
  mutate((draft) => {
    draft.tasks.push({
      id,
      projectId,
      bucketId,
      parentTaskId: null,
      title,
      description: null,
      source: 'manual',
      type: 'task',
      status: 'todo',
      priority: 'normal',
      progress: 0,
      assignees: opts?.assignees ?? [],
      assigneesNames: opts?.assigneesNames ?? [],
      checklist,
      checklistTotal: checklist.length,
      checklistDone: 0,
      ...(opts?.dueDate ? { dueDate: Timestamp.fromDate(opts.dueDate) } : {}),
      ...(opts?.recurrence ? { recurrence: opts.recurrence } : {}),
      externalId: '',
      labels: [],
    })
  })
  return id
}

export async function deletePMTask(
  projectId: string,
  bucketId: string,
  taskId: string,
): Promise<void> {
  mutate((draft) => {
    draft.tasks = draft.tasks.filter(
      (t) => !(t.id === taskId && t.projectId === projectId && t.bucketId === bucketId),
    )
    delete draft.comments[taskId]
  })
}

export async function setPMTaskArchived(
  projectId: string,
  bucketId: string,
  taskId: string,
  archived: boolean,
): Promise<void> {
  mutate((draft) => {
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (!task) return
    task.archived = archived
    if (archived) task.archivedAt = tsNow()
  })
}

/**
 * Move a tarefa entre colunas preservando o id — no original é um `writeBatch`
 * que copia o doc e apaga o antigo; aqui basta trocar `bucketId`, com o mesmo
 * efeito observável.
 */
export async function moveTaskToBucket(
  projectId: string,
  task: PMTask,
  toBucketId: string,
): Promise<void> {
  mutate((draft) => {
    const stored = draft.tasks.find((t) => t.id === task.id && t.projectId === projectId)
    if (!stored) return
    stored.bucketId = toBucketId
  })
}

export async function reorderTasksInBucket(
  projectId: string,
  bucketId: string,
  orderedTaskIds: string[],
): Promise<void> {
  mutate((draft) => {
    orderedTaskIds.forEach((taskId, index) => {
      const task = draft.tasks.find(
        (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
      )
      if (task) task.order = index
    })
  })
}

export async function getTaskSubtasks(
  projectId: string,
  bucketId: string,
  taskId: string,
): Promise<PMTask[]> {
  return getState()
    .tasks.filter(
      (t) => t.projectId === projectId && t.bucketId === bucketId && t.parentTaskId === taskId,
    )
    .map((t) => ({ ...t }))
}

export async function cloneTask(
  projectId: string,
  task: PMTask,
  subtasks: PMTask[],
  targetBucketId: string,
): Promise<string> {
  const newTaskId = newId('tsk')
  mutate((draft) => {
    const maxOrder = draft.tasks
      .filter((t) => t.projectId === projectId && t.bucketId === targetBucketId)
      .reduce((max, t) => Math.max(max, t.order ?? -1), -1)

    draft.tasks.push({
      id: newTaskId,
      projectId,
      bucketId: targetBucketId,
      parentTaskId: null,
      title: `Cópia de — ${task.title}`,
      description: task.description ?? null,
      source: 'manual',
      type: 'task',
      status: 'todo',
      priority: task.priority ?? 'normal',
      progress: 0,
      assignees: task.assignees ?? [],
      assigneesNames: task.assigneesNames ?? [],
      checklist: (task.checklist ?? []).map(({ status: _s, ...item }) => ({ ...item, isChecked: false })),
      checklistTotal: task.checklistTotal ?? 0,
      checklistDone: 0,
      ...(task.startDate ? { startDate: task.startDate } : {}),
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
      order: maxOrder + 1,
      externalId: '',
      labels: task.labels ?? [],
    })

    subtasks.forEach((sub, idx) => {
      draft.tasks.push({
        id: newId('tsk'),
        projectId,
        bucketId: targetBucketId,
        parentTaskId: newTaskId,
        title: sub.title,
        description: null,
        source: 'manual',
        type: 'subtask',
        status: 'todo',
        priority: 'normal',
        progress: 0,
        assignees: sub.assignees ?? [],
        assigneesNames: sub.assigneesNames ?? [],
        ...(sub.startDate ? { startDate: sub.startDate } : {}),
        ...(sub.dueDate ? { dueDate: sub.dueDate } : {}),
        order: idx,
        externalId: '',
      })
    })
  })
  return newTaskId
}

// ── Recorrência ──────────────────────────────────────────────────────────────

function isBusinessDay(date: Date): boolean {
  const day = date.getDay()
  return day !== 0 && day !== 6
}

function calcNextDate(dueDate: Date, recurrence: RecurrenceConfig): Date {
  const d = new Date(dueDate)
  if (recurrence.pattern === 'daily') {
    d.setDate(d.getDate() + recurrence.interval)
  } else if (recurrence.pattern === 'weekly') {
    d.setDate(d.getDate() + recurrence.interval * 7)
  } else if (recurrence.pattern === 'monthly') {
    d.setMonth(d.getMonth() + recurrence.interval)
  } else if (recurrence.pattern === 'business-days') {
    let remaining = recurrence.interval
    while (remaining > 0) {
      d.setDate(d.getDate() + 1)
      if (isBusinessDay(d)) remaining--
    }
  } else if (recurrence.pattern === 'custom-days') {
    const days = recurrence.daysOfWeek ?? []
    if (days.length === 0) return d
    let safety = 0
    do {
      d.setDate(d.getDate() + 1)
      safety++
    } while (!days.includes(d.getDay()) && safety < 14)
  }
  return d
}

function appendRecurrenceOccurrence(draft: KanbanState, task: PMTask, nextDue: Date): void {
  const freshChecklist = (task.checklist ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    orderHint: item.orderHint,
    isChecked: false,
  }))
  draft.tasks.push({
    id: newId('tsk'),
    projectId: task.projectId,
    bucketId: task.bucketId,
    parentTaskId: task.parentTaskId ?? null,
    title: task.title,
    description: task.description ?? null,
    source: 'manual',
    type: 'task',
    status: 'todo',
    priority: task.priority ?? 'normal',
    progress: 0,
    assignees: task.assignees ?? [],
    assigneesNames: task.assigneesNames ?? [],
    checklist: freshChecklist,
    checklistTotal: freshChecklist.length,
    checklistDone: 0,
    recurrence: task.recurrence,
    dueDate: Timestamp.fromDate(nextDue),
    startDate: null,
    externalId: task.externalId ?? '',
    labels: task.labels ?? [],
  })
}

export async function markTaskDone(
  projectId: string,
  bucketId: string,
  task: PMTask,
): Promise<void> {
  mutate((draft) => {
    const stored = draft.tasks.find(
      (t) => t.id === task.id && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (!stored) return
    stored.status = 'done'
    stored.progress = 100
    if (task.status !== 'done') stored.completedAt = tsNow()
    if (task.checklist && task.checklist.length > 0) {
      stored.checklist = task.checklist.map((item) => ({
        ...item,
        isChecked: true,
        status: 'finalizado' as const,
      }))
      stored.checklistDone = task.checklist.length
    }
    if (task.recurrence && task.dueDate) {
      appendRecurrenceOccurrence(draft, task, calcNextDate(task.dueDate.toDate(), task.recurrence))
    }
  })
}

// ── Checklist ────────────────────────────────────────────────────────────────

export async function addChecklistItem(
  projectId: string,
  bucketId: string,
  taskId: string,
  title: string,
  currentChecklist: ChecklistItem[],
): Promise<void> {
  const newItem: ChecklistItem = {
    id: `local_${Date.now()}`,
    title,
    isChecked: false,
    orderHint: String(currentChecklist.length),
  }
  mutate((draft) => {
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (!task) return
    task.checklist = [...currentChecklist, newItem]
    task.checklistTotal = currentChecklist.length + 1
  })
}

export async function toggleChecklistItem(
  projectId: string,
  bucketId: string,
  task: PMTask,
  itemId: string,
  checked: boolean,
): Promise<void> {
  const newChecklist = (task.checklist ?? []).map((item) =>
    item.id === itemId ? { ...item, isChecked: checked } : item,
  )
  const doneCount = newChecklist.filter((i) => i.isChecked).length
  const total = newChecklist.length
  const newStatus: PMTask['status'] =
    doneCount === total && total > 0 ? 'done' : doneCount > 0 ? 'in_progress' : 'todo'

  const autoFillStart = task.status === 'todo' && newStatus !== 'todo' && !task.startDate
  let startDateFill: Timestamp | null = null
  if (autoFillStart) {
    const taskDueDate = task.dueDate ? task.dueDate.toDate() : null
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)
    startDateFill = Timestamp.fromDate(
      taskDueDate !== null && taskDueDate < todayMidnight ? taskDueDate : new Date(),
    )
  }

  mutate((draft) => {
    const stored = draft.tasks.find(
      (t) => t.id === task.id && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (!stored) return
    stored.checklist = newChecklist
    stored.checklistDone = doneCount
    stored.status = newStatus
    if (startDateFill) stored.startDate = startDateFill
    if (newStatus === 'done' && task.status !== 'done') stored.completedAt = tsNow()
    else if (newStatus !== 'done' && task.status === 'done') delete stored.completedAt
  })
}

export async function updateChecklistItemStatus(
  projectId: string,
  bucketId: string,
  task: PMTask,
  itemId: string,
  status: ChecklistStatus,
): Promise<{ autoFilledStartDate: boolean; filledDate?: Date }> {
  const newChecklist = (task.checklist ?? [])
    .map((item) =>
      item.id === itemId ? { ...item, status, isChecked: status === 'finalizado' } : item,
    )
    .sort((a, b) => (a.orderHint > b.orderHint ? -1 : a.orderHint < b.orderHint ? 1 : 0))

  const doneCount = newChecklist.filter((i) => (i.status ? i.status === 'finalizado' : i.isChecked)).length
  const inProgressCount = newChecklist.filter(
    (i) => i.status === 'em_producao' || i.status === 'revisao' || i.status === 'refazer',
  ).length
  const total = newChecklist.length
  const newTaskStatus: PMTask['status'] =
    doneCount === total && total > 0
      ? 'done'
      : inProgressCount > 0 || doneCount > 0
        ? 'in_progress'
        : 'todo'

  const autoFilledStartDate = task.status === 'todo' && newTaskStatus !== 'todo' && !task.startDate

  let filledDate: Date | undefined
  if (autoFilledStartDate) {
    const taskDueDate = task.dueDate ? task.dueDate.toDate() : null
    const todayMidnight = new Date()
    todayMidnight.setHours(0, 0, 0, 0)
    filledDate = taskDueDate !== null && taskDueDate < todayMidnight ? taskDueDate : new Date()
  }

  mutate((draft) => {
    const stored = draft.tasks.find(
      (t) => t.id === task.id && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (!stored) return
    stored.checklist = newChecklist
    stored.checklistDone = doneCount
    stored.checklistTotal = total
    stored.status = newTaskStatus
    if (filledDate) stored.startDate = Timestamp.fromDate(filledDate)
    if (newTaskStatus === 'done' && task.status !== 'done') stored.completedAt = tsNow()
    else if (newTaskStatus !== 'done' && task.status === 'done') delete stored.completedAt

    if (newTaskStatus === 'done' && task.status !== 'done' && task.recurrence && task.dueDate) {
      appendRecurrenceOccurrence(draft, task, calcNextDate(task.dueDate.toDate(), task.recurrence))
    }
  })

  return { autoFilledStartDate, filledDate }
}

export async function updateChecklistItemTitle(
  projectId: string,
  bucketId: string,
  taskId: string,
  itemId: string,
  newTitle: string,
  currentChecklist: ChecklistItem[],
): Promise<void> {
  const newChecklist = currentChecklist.map((item) =>
    item.id === itemId ? { ...item, title: newTitle } : item,
  )
  mutate((draft) => {
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (task) task.checklist = newChecklist
  })
}

export async function deleteChecklistItem(
  projectId: string,
  bucketId: string,
  taskId: string,
  itemId: string,
  currentChecklist: ChecklistItem[],
): Promise<void> {
  const newChecklist = currentChecklist.filter((i) => i.id !== itemId)
  const checklistTotal = newChecklist.length
  const checklistDone = newChecklist.filter(
    (i) => i.status === 'finalizado' || i.isChecked === true,
  ).length
  mutate((draft) => {
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (!task) return
    task.checklist = newChecklist
    task.checklistTotal = checklistTotal
    task.checklistDone = checklistDone
  })
}

// ── Templates ────────────────────────────────────────────────────────────────

export function subscribeAreaTemplates(
  area: TemplateArea,
  cb: (templates: MarketingTaskTemplate[]) => void,
): Unsubscribe {
  return subscribeSelector(
    (s) =>
      s.templates
        .filter((t) => (t.area ?? 'marketing') === area)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map((t) => ({ ...t })),
    cb,
  )
}

let _templateSeedAttempted = false

export function isMarketingTemplateSeedAttempted(): boolean {
  return _templateSeedAttempted
}

/**
 * No-op deliberado: o seed de templates do app de demonstração já vem pronto
 * em `seed.ts`. A flag continua sendo marcada para que o call site
 * (`NewMarketingTaskModal`) não tente semear em loop.
 */
export async function seedMarketingTemplatesIfNeeded(
  existingTemplates: MarketingTaskTemplate[],
): Promise<void> {
  if (_templateSeedAttempted) return
  if (existingTemplates.some((t) => t.isDefault)) return
  _templateSeedAttempted = true
}

/** Migrações de categoria legada do Marketing — sem dado legado aqui. */
export async function migrateMarketingTemplatesCategorias(
  _existingTemplates: MarketingTaskTemplate[],
): Promise<void> {}

export async function migrateCasteloEloTemplates(
  _existingTemplates: MarketingTaskTemplate[],
): Promise<void> {}

// ── Etiquetas ────────────────────────────────────────────────────────────────

export function subscribePMOfficeLabels(
  projectId: string,
  cb: (labels: PMOfficeLabel[]) => void,
): Unsubscribe {
  return subscribeSelector(
    () =>
      getState().project.id === projectId
        ? getState()
            .labels.slice()
            .sort((a, b) => a.order - b.order)
            .map((l) => ({ ...l }))
        : [],
    cb,
  )
}

export async function createPMOfficeLabel(
  projectId: string,
  data: {
    name: string | null
    displayName: string
    trelloLabelId?: string | null
    trelloColor?: string | null
    order: number
  },
): Promise<string> {
  const id = newId('lbl')
  mutate((draft) => {
    if (draft.project.id !== projectId) return
    draft.labels.push({
      id,
      name: data.name,
      displayName: data.displayName,
      trelloLabelId: data.trelloLabelId ?? null,
      trelloColor: data.trelloColor ?? null,
      order: data.order,
      mergedInto: null,
      createdAt: tsNow(),
      updatedAt: tsNow(),
    })
  })
  return id
}

export async function updatePMOfficeLabel(
  projectId: string,
  labelId: string,
  data: Partial<Pick<PMOfficeLabel, 'name' | 'displayName' | 'trelloColor' | 'order' | 'mergedInto'>>,
): Promise<void> {
  mutate((draft) => {
    if (draft.project.id !== projectId) return
    const label = draft.labels.find((l) => l.id === labelId)
    if (!label) return
    Object.assign(label, data, { updatedAt: tsNow() })
  })
}

/** Pura, igual ao original — idempotente nos dois sentidos. */
export function toggleLabelInList(
  currentLabels: string[] | undefined,
  labelId: string,
  checked: boolean,
): string[] {
  const current = currentLabels ?? []
  if (checked) {
    return current.includes(labelId) ? current : [...current, labelId]
  }
  return current.filter((id) => id !== labelId)
}

export async function setPMTaskLabel(
  projectId: string,
  bucketId: string,
  taskId: string,
  currentLabels: string[] | undefined,
  labelId: string,
  checked: boolean,
): Promise<string[]> {
  const nextLabels = toggleLabelInList(currentLabels, labelId, checked)
  mutate((draft) => {
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (task) task.labels = nextLabels
  })
  return nextLabels
}
