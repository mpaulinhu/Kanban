/**
 * Audit log sem persistência: `logPmAction` só registra em `console.debug`.
 *
 * O contrato importante é ser fire-and-forget — NUNCA lança nem bloqueia a
 * ação principal, então plugar um destino real depois não muda nenhum call
 * site. `action` e `target.type` são `string` propositalmente abertos; os call
 * sites passam literais.
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
