import { useMemo } from 'react'
import { diffFields } from '../utils/diffFields'

/**
 * Trilha de auditoria. No CoreHub cada ação vira um documento no Firestore
 * (~780 linhas entre API e tipos); aqui só registra no console, mantendo a
 * mesma superfície para os componentes que já chamam `audit.logTask(...)`.
 *
 * Ponto de extensão: para voltar a persistir, basta trocar o corpo destas
 * funções — nenhum componente precisa mudar.
 */

type AuditAction = string

function log(kind: string, action: AuditAction, target: unknown, extra?: unknown) {
  console.debug('[audit]', kind, action, target, extra ?? '')
}

export function usePmAudit(area: string, projectId: string | null, projectName: string) {
  return useMemo(() => {
    const ctx = { area, projectId, projectName }
    return {
      logTask: (action: AuditAction, task: { id: string; title?: string }, extra?: unknown) =>
        log('task', action, task, { ...ctx, extra }),
      logBucket: (action: AuditAction, bucket: { id: string; name?: string }, extra?: unknown) =>
        log('bucket', action, bucket, { ...ctx, extra }),
      logChecklistItem: (
        action: AuditAction,
        task: { id: string; title?: string; bucketId?: string },
        item: { id: string; title?: string },
        extra?: unknown,
      ) => log('checklistItem', action, { task, item }, { ...ctx, extra }),
      logProject: (action: AuditAction, project: { id: string; title?: string }, extra?: unknown) =>
        log('project', action, project, { ...ctx, extra }),
      logTemplate: (action: AuditAction, template: { id: string; title?: string; name?: string }, extra?: unknown) =>
        log('template', action, template, { ...ctx, extra }),
    }
  }, [area, projectId, projectName])
}

export type PmAudit = ReturnType<typeof usePmAudit>

/**
 * Registra o save de uma tarefa escolhendo a ação pelo que mudou — concluir e
 * reabrir são ações distintas de uma edição comum, e um save sem nenhuma
 * mudança real não gera entrada (senão todo clique em "Salvar" viraria ruído
 * no log).
 */
export function logTaskSave(
  audit: PmAudit,
  previous: { status?: string; title?: string } | undefined,
  updated: { id: string; status?: string; title?: string; bucketId?: string },
  bucketName?: string,
): void {
  const wasDone = previous?.status === 'done'
  const isDone = updated.status === 'done'
  const action = isDone && !wasDone
    ? 'pm_task.done'
    : !isDone && wasDone
      ? 'pm_task.undone'
      : 'pm_task.update'

  const changes = diffFields(
    previous as Record<string, unknown> | undefined,
    updated as Record<string, unknown>,
  )
  if (changes.length === 0 && action === 'pm_task.update') return

  audit.logTask(
    action,
    { id: updated.id, title: updated.title },
    {
      ...(updated.bucketId ? { bucketId: updated.bucketId } : {}),
      ...(bucketName ? { bucketName } : {}),
      ...(changes.length > 0 ? { changes } : {}),
    },
  )
}
