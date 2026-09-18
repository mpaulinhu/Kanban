/** API do quadro: leitura e mutação das tarefas sobre o estado em memória (ver `store.ts`). */

import type { PMTask } from '../types/pmOffice'
import { getState, mergeIntoTask, mutate, tsNow } from './store'

export type PMTaskPatch = Partial<Pick<PMTask,
  'title' | 'description' | 'status' | 'progress' |
  'startDate' | 'dueDate' | 'assignees' | 'assigneesNames' |
  'avisoApi' | 'observacoes' | 'rawStatus' | 'referencias' | 'linkRoteiro' |
  'order' | 'wbsOrder' | 'parentTaskId' |
  'previousStatusBeforeAtrasado' |
  'labels' |
  'attachments' |
  /** `recurrence: undefined` significa "remover a recorrência", não "não mexer". */
  'recurrence' | 'checklist' | 'checklistDone'
>>

export async function updatePMProject(
  projectId: string,
  data: { team: string[] },
): Promise<void> {
  mutate((draft) => {
    if (draft.project.id !== projectId) return
    Object.assign(draft.project, data, { updatedAt: tsNow() })
  })
}

export async function updatePMTask(
  projectId: string,
  bucketId: string,
  taskId: string,
  data: PMTaskPatch,
  options?: { clearPreviousStatusBeforeAtrasado?: boolean },
): Promise<void> {
  mutate((draft) => {
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (!task) return
    mergeIntoTask(task, data)
    // `mergeIntoTask` ignora `undefined` (semântica de `{ merge: true }`), mas
    // `recurrence: undefined` é como o modal pede a REMOÇÃO da recorrência.
    // A chave precisa estar presente no patch para diferenciar "remover" de
    // "não mexer".
    if ('recurrence' in data && data.recurrence === undefined) {
      delete task.recurrence
    }
    if (options?.clearPreviousStatusBeforeAtrasado) {
      delete task.previousStatusBeforeAtrasado
    }
  })
}

export async function deletePMBucket(projectId: string, bucketId: string): Promise<void> {
  mutate((draft) => {
    draft.tasks = draft.tasks.filter((t) => !(t.projectId === projectId && t.bucketId === bucketId))
    draft.buckets = draft.buckets.filter((b) => !(b.projectId === projectId && b.id === bucketId))
  })
}

/** Início do dia local (00:00) — mesmo critério de "atrasado" do original. */
function startOfTodayLocal(referenceDate: Date = new Date()): Date {
  const midnight = new Date(referenceDate)
  midnight.setHours(0, 0, 0, 0)
  return midnight
}

/**
 * Transição lazy para `'atrasado'` e sua reversão simétrica — mesma regra do
 * original: só o caminho AUTOMÁTICO grava `previousStatusBeforeAtrasado`, então
 * uma escolha manual do usuário nunca é revertida sozinha.
 */
export async function applyLazyOverdueTransition(task: PMTask): Promise<PMTask> {
  const today = startOfTodayLocal()

  if (
    (task.status === 'todo' || task.status === 'in_progress') &&
    task.dueDate &&
    task.dueDate.toMillis() < today.getTime()
  ) {
    const previousStatus = task.status
    const patch: PMTaskPatch = { status: 'atrasado', previousStatusBeforeAtrasado: previousStatus }
    await updatePMTask(task.projectId, task.bucketId, task.id, patch)
    return { ...task, ...patch }
  }

  const wasAutoMarkedOverdue = task.status === 'atrasado' && !!task.previousStatusBeforeAtrasado
  const dueDateIsNowFuture = !task.dueDate || task.dueDate.toMillis() >= today.getTime()
  if (wasAutoMarkedOverdue && dueDateIsNowFuture) {
    const revertedStatus = task.previousStatusBeforeAtrasado as 'todo' | 'in_progress'
    mutate((draft) => {
      const stored = draft.tasks.find((t) => t.id === task.id)
      if (!stored) return
      stored.status = revertedStatus
      delete stored.previousStatusBeforeAtrasado
    })
    const { previousStatusBeforeAtrasado: _drop, ...rest } = task
    return { ...rest, status: revertedStatus }
  }

  return task
}

/** Lê o projeto atual sem assinar — usado por `marketingPlannerApi.getOrCreateAreaProject`. */
export function peekProject() {
  return getState().project
}
