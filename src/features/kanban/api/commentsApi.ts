/**
 * Comentários de tarefa em memória — mesma superfície do `commentsApi` do
 * CoreHub. `PMTask.commentCount` continua sendo o contador desnormalizado que
 * o card do quadro lê, mantido em sincronia a cada criação/exclusão.
 */

import type { PMTaskComment } from '../types/pmOffice'
import { CURRENT_USER, getState, mutate, newId, subscribe, tsNow } from './store'

type Unsubscribe = () => void

/**
 * Nível de `admin` na hierarquia do monorepo
 * (`datametria_super_admin` 0 → `super_admin` 1 → `admin` 2 → …) — o original
 * importa `ROLE_LEVELS` de `@eloeditorial/shared-types`, pacote que não existe
 * neste app.
 */
const ADMIN_ROLE_LEVEL = 2

/** Thread em ordem cronológica (mais antigo primeiro), igual ao original. */
export function subscribeTaskComments(
  _projectId: string,
  _bucketId: string,
  taskId: string,
  cb: (comments: PMTaskComment[]) => void,
): Unsubscribe {
  return subscribe(() => {
    const thread = getState().comments[taskId] ?? []
    cb(
      thread
        .slice()
        .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())
        .map((c) => ({ ...c })),
    )
  })
}

export async function addTaskComment(
  projectId: string,
  bucketId: string,
  taskId: string,
  author: { uid: string; name: string },
  text: string,
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  mutate((draft) => {
    const thread = draft.comments[taskId] ?? []
    thread.push({
      id: newId('cmt'),
      authorUid: author.uid,
      authorName: author.name,
      text: trimmed,
      createdAt: tsNow(),
    })
    draft.comments[taskId] = thread
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (task) task.commentCount = (task.commentCount ?? 0) + 1
  })
}

export async function updateTaskComment(
  _projectId: string,
  _bucketId: string,
  taskId: string,
  commentId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  mutate((draft) => {
    const comment = draft.comments[taskId]?.find((c) => c.id === commentId)
    if (!comment) return
    comment.text = trimmed
    comment.updatedAt = tsNow()
  })
}

export async function deleteTaskComment(
  projectId: string,
  bucketId: string,
  taskId: string,
  commentId: string,
): Promise<void> {
  mutate((draft) => {
    const thread = draft.comments[taskId]
    if (!thread) return
    draft.comments[taskId] = thread.filter((c) => c.id !== commentId)
    const task = draft.tasks.find(
      (t) => t.id === taskId && t.projectId === projectId && t.bucketId === bucketId,
    )
    if (task) task.commentCount = Math.max(0, (task.commentCount ?? 0) - 1)
  })
}

/** Só o próprio autor edita — função pura, igual ao original. */
export function canEditComment(
  comment: Pick<PMTaskComment, 'authorUid'>,
  currentUid: string | null | undefined,
): boolean {
  return !!currentUid && comment.authorUid === currentUid
}

/**
 * Autor OU admin+ (`roleLevel <= admin`). Sem autenticação, `currentRoleLevel`
 * chega do usuário de demonstração via `useAuth()` do app novo — o default
 * abaixo cobre quem chamar sem o parâmetro resolvido.
 */
export function canDeleteComment(
  comment: Pick<PMTaskComment, 'authorUid'>,
  currentUid: string | null | undefined,
  currentRoleLevel: number = CURRENT_USER.roleLevel,
): boolean {
  if (currentRoleLevel <= ADMIN_ROLE_LEVEL) return true
  return canEditComment(comment, currentUid)
}
