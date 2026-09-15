import { useMemo } from 'react'

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
      logTemplate: (action: AuditAction, template: { id: string; title?: string }, extra?: unknown) =>
        log('template', action, template, { ...ctx, extra }),
    }
  }, [area, projectId, projectName])
}

export type PmAudit = ReturnType<typeof usePmAudit>
