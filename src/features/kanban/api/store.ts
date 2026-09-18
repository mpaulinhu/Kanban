/**
 * Repositório em memória do quadro, persistido em `localStorage`.
 *
 * Três responsabilidades, deliberadamente juntas num arquivo só porque são
 * indissociáveis: (1) o substituto de `Timestamp`, (2) o estado do quadro com
 * espelho em `localStorage`, (3) o emissor que alimenta as funções
 * `subscribe*`. Separá-las exigiria import circular entre os três módulos.
 */

import { DEMO_USER } from '@/providers/AuthProvider'
import type {
  MarketingTaskTemplate,
  PMBucket,
  PMOfficeLabel,
  PMProject,
  PMTask,
  PMTaskComment,
} from '../types/pmOffice'
// Só o TIPO — sem ciclo em runtime (mesmo padrão que `seed.ts` já usa pra
// importar `UserRecord` de `usersApi.ts`, que por sua vez importa `SEED_USERS`
// deste módulo via `seed.ts`).
import type { UserRecord } from './usersApi'

// ── Timestamp ────────────────────────────────────────────────────────────────

/**
 * Tipo mínimo de data/hora usado em todo o estado. Os componentes leem
 * `.seconds` (via `toDate()` de `utils/index.ts`) e `applyLazyOverdueTransition`
 * chama `.toMillis()`; `Timestamp.fromDate` é usado por `dateToTs` no
 * `TaskDetailModal`. Nada além disso é consumido, então nada além disso existe.
 */
export class Timestamp {
  readonly seconds: number
  readonly nanoseconds: number

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds
    this.nanoseconds = nanoseconds
  }

  static fromDate(date: Date): Timestamp {
    const millis = date.getTime()
    return new Timestamp(Math.floor(millis / 1000), (millis % 1000) * 1e6)
  }

  static fromMillis(millis: number): Timestamp {
    return new Timestamp(Math.floor(millis / 1000), (millis % 1000) * 1e6)
  }

  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now())
  }

  toDate(): Date {
    return new Date(this.toMillis())
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.round(this.nanoseconds / 1e6)
  }

  toJSON(): { seconds: number; nanoseconds: number } {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds }
  }
}

export function tsFromDate(d: Date): Timestamp {
  return Timestamp.fromDate(d)
}

export function tsNow(): Timestamp {
  return Timestamp.now()
}

/** `{ seconds, nanoseconds }` sobrevive ao JSON do localStorage como objeto cru — isto devolve o método `toDate()`/`toMillis()` que a UI espera. */
function reviveTimestamp(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value
  if (!value || typeof value !== 'object') return null
  const raw = value as { seconds?: unknown; nanoseconds?: unknown }
  if (typeof raw.seconds !== 'number') return null
  return new Timestamp(raw.seconds, typeof raw.nanoseconds === 'number' ? raw.nanoseconds : 0)
}

// ── Usuário de demonstração ──────────────────────────────────────────────────

export interface DemoUser {
  uid: string
  name: string
  email: string
  roleLevel: number
}

/**
 * Quem "assina" toda escrita que precisa de um autor (comentário novo, checagem
 * de quem pode editar ou apagar).
 *
 * Deriva de `DEMO_USER` em vez de repetir os valores: enquanto não há login, os
 * dois precisam ser a MESMA pessoa. Quando eram objetos separados, o app dizia
 * que você era um usuário e assinava seus comentários como outro, e a checagem
 * de "posso editar este comentário?" nunca batia.
 */
export const CURRENT_USER: DemoUser = {
  uid: DEMO_USER.uid,
  name: DEMO_USER.displayName,
  email: DEMO_USER.email,
  roleLevel: DEMO_USER.roleLevel,
}

// ── Formato persistido ───────────────────────────────────────────────────────

export interface AttachmentBlob {
  /** `data:` URL — sobrevive ao `localStorage` (um `blob:` morre com a aba). */
  dataUrl: string
  mimeType: string | null
}

export interface KanbanState {
  project: PMProject
  buckets: PMBucket[]
  tasks: PMTask[]
  labels: PMOfficeLabel[]
  templates: MarketingTaskTemplate[]
  /** Chaveado por `${taskId}` → lista ordenada cronologicamente. */
  comments: Record<string, PMTaskComment[]>
  /** Chaveado pelo `storagePath` sintético do anexo. */
  attachmentBlobs: Record<string, AttachmentBlob>
  /**
   * Usuários do workspace — inicializado a partir de `SEED_USERS`, mas
   * MUTÁVEL a partir daqui: `usersApi.createUser` grava aqui via `mutate()`,
   * o que persiste em `localStorage` como o resto do estado. Antes vivia só
   * em `SEED_USERS` (array estático em `seed.ts`), e `createUser` era um stub
   * que rejeitava com "exige backend" — sem lugar pra gravar um usuário novo,
   * a única opção era recusar. Agora tem.
   */
  users: UserRecord[]
}

// v2: mudança de schema nos dados de exemplo (`trelloColor`→`colorKey`,
// remoção dos campos de livro/marca) — sem isso, quem já tinha o v1 salvo
// carregava etiquetas com `colorKey` ausente e via tudo cinza, porque o
// estado persistido nunca é migrado campo a campo, só descartado quando a
// versão muda.
const STORAGE_KEY = 'kanban.demo.state.v2'

// ── Emissor ──────────────────────────────────────────────────────────────────

type Listener = () => void

const listeners = new Set<Listener>()
let notifyScheduled = false

/**
 * Entrega assíncrona (microtask), nunca síncrona: o callback do assinante não
 * pode rodar no mesmo tick da mutação. Um `setState` síncrono dentro do próprio
 * handler de clique que disparou a escrita produziria ordem de render diferente
 * — os componentes assumem a entrega adiada.
 * Coalescido: várias mutações no mesmo tick acordam os assinantes uma vez só.
 */
function notify(): void {
  if (notifyScheduled) return
  notifyScheduled = true
  queueMicrotask(() => {
    notifyScheduled = false
    for (const listener of [...listeners]) listener()
  })
}

/**
 * Assina mutações e já entrega o estado atual de forma assíncrona — mesmo
 * contrato de `onSnapshot`, que dispara uma vez com o snapshot inicial.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  queueMicrotask(() => {
    if (listeners.has(listener)) listener()
  })
  return () => {
    listeners.delete(listener)
  }
}

// ── Estado ───────────────────────────────────────────────────────────────────

let state: KanbanState | null = null

function readPersisted(): KanbanState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return reviveState(JSON.parse(raw) as KanbanState)
  } catch {
    return null
  }
}

/** Campos de data de cada entidade — precisam voltar a ser `Timestamp` de verdade após o `JSON.parse`. */
const TASK_DATE_FIELDS = [
  'dueDate',
  'startDate',
  'completedAt',
  'archivedAt',
] as const

function reviveState(parsed: KanbanState): KanbanState {
  for (const task of parsed.tasks) {
    for (const field of TASK_DATE_FIELDS) {
      const revived = reviveTimestamp(task[field])
      // Nem todos esses campos são nullable no tipo (`archivedAt` é
      // `Timestamp | undefined`), então um valor irrecuperável sai por
      // `delete`, não por `= null`.
      if (revived) task[field] = revived
      else if (task[field] != null) delete task[field]
    }
  }
  for (const label of parsed.labels) {
    const createdAt = reviveTimestamp(label.createdAt)
    if (createdAt) label.createdAt = createdAt
    const updatedAt = reviveTimestamp(label.updatedAt)
    if (updatedAt) label.updatedAt = updatedAt
  }
  for (const thread of Object.values(parsed.comments)) {
    for (const comment of thread) {
      comment.createdAt = reviveTimestamp(comment.createdAt) ?? Timestamp.now()
      const updatedAt = reviveTimestamp(comment.updatedAt)
      if (updatedAt) comment.updatedAt = updatedAt
    }
  }
  return parsed
}

function persist(): void {
  if (!state) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Modo privado / cota estourada: o app segue funcionando em memória.
  }
}

export function getState(): KanbanState {
  if (state) return state
  // Import tardio quebra o ciclo store → seed → store (o seed monta
  // `Timestamp`s usando os helpers deste módulo).
  state = readPersisted() ?? loadSeed()
  return state
}

let seedFactory: (() => KanbanState) | null = null

/** O módulo `seed.ts` se registra aqui na importação — ver comentário em `getState`. */
export function registerSeedFactory(factory: () => KanbanState): void {
  seedFactory = factory
}

function loadSeed(): KanbanState {
  if (!seedFactory) {
    throw new Error('seed.ts não foi importado antes do primeiro acesso ao store.')
  }
  return seedFactory()
}

/**
 * Único ponto de escrita: aplica a mutação, espelha em `localStorage` e acorda
 * os assinantes. Nenhuma API deve mexer em `getState()` diretamente.
 */
export function mutate(fn: (draft: KanbanState) => void): void {
  const current = getState()
  fn(current)
  persist()
  notify()
}

/** Reseta para o seed — útil em desenvolvimento, sem call site na UI hoje. */
export function resetToSeed(): void {
  state = loadSeed()
  persist()
  notify()
}

// ── Utilitários compartilhados pelas APIs ────────────────────────────────────

export function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${random}`
}

export function findTask(draft: KanbanState, taskId: string): PMTask | undefined {
  return draft.tasks.find((t) => t.id === taskId)
}

/**
 * Aplica um patch parcial numa tarefa descartando chaves `undefined` — imita a
 * semântica de `setDoc(..., { merge: true })`, onde uma chave ausente não apaga
 * o valor existente.
 */
export function mergeIntoTask(task: PMTask, patch: Partial<PMTask>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    Reflect.set(task, key, value)
  }
}
