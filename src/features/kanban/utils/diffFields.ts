/** Um campo que mudou entre o valor anterior e o novo. */
export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

/**
 * Campos técnicos que nunca interessam no diff exibido ao usuário — sempre
 * mudam a cada escrita (timestamp) ou são metadados internos, não "o que a
 * pessoa alterou".
 *
 * `externalId`/`wbsOrder`/`syncedAt` entraram aqui pelo mesmo motivo: são
 * campos de sincronização com sistemas externos, nunca uma edição intencional
 * de alguém. Diferente de `status`/`projectType`/`source`, que descrevem uma
 * decisão humana e por isso aparecem no diff.
 *
 * `updated_at` (snake_case) cobre APIs mais antigas que ainda não migraram
 * para `updatedAt`. Sem essa variante, o timestamp desses campos vazava para
 * `metadata.changes` e derrubava a escrita do audit log — falha silenciosa,
 * sem nenhum sinal na UI.
 */
const IGNORED_FIELDS = new Set([
  'updatedAt', 'createdAt', 'uploadedAt', 'timestamp',
  'externalId', 'wbsOrder', 'syncedAt',
  'updated_at', 'created_at',
])

/** Compara dois valores por igualdade estrutural rasa — suficiente para string/number/boolean/array/objeto simples. */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Compara `before` (estado anterior do documento, ou `null` se é uma criação)
 * com `after` (os campos que a escrita está gravando — normalmente um patch
 * parcial, não o doc inteiro) e devolve só os campos que de fato mudaram de
 * valor. Usado para popular `metadata.changes` no Audit Log.
 *
 * Só compara as chaves presentes em `after` — updates parciais não devem
 * gerar "diff" para campos que nem foram tocados.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: Partial<T> | null | undefined,
  after: Partial<T>,
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const [field, afterValue] of Object.entries(after)) {
    if (IGNORED_FIELDS.has(field)) continue
    const beforeValue = before?.[field as keyof T]
    if (!isEqual(beforeValue, afterValue)) {
      changes.push({ field, before: beforeValue ?? null, after: afterValue })
    }
  }
  return changes
}
