/**
 * Audit log desativado no app de demonstração — sem coleção onde gravar.
 *
 * `logPmAction` mantém a assinatura de 3 parâmetros do CoreHub e o
 * comportamento essencial de lá: fire-and-forget que NUNCA lança nem bloqueia
 * a ação principal. Aqui só registra em `console.debug`.
 *
 * `action` e `target.type` são `string` (no original são unions fechadas com
 * ~150 e ~30 membros, definidas em `features/audit-log/types.ts`, que não foi
 * copiado) — os call sites passam literais, que satisfazem `string`.
 */

export type PmArea =
  | 'editorial'
  | 'marketing'
  | 'audiovisual'
  | 'tecnologia'
  | 'administrativo'
  | 'desenvolvimento'
  | 'pedagogia'

export interface PmAuditMetadata {
  area: PmArea
  projectId: string
  projectName: string
  bucketId?: string
  bucketName?: string
  changes?: unknown
  [key: string]: unknown
}

export interface AuditTarget {
  id: string
  type: string
  description?: string
}

export function logPmAction(action: string, target: AuditTarget, meta: PmAuditMetadata): void {
  console.debug('[auditLog] (desativado)', action, target, meta)
}
