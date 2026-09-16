// `Timestamp` é um tipo local definido em `api/store.ts` — expõe a mesma
// interface que a UI consome (`.seconds`, `.toDate()`, `.toMillis()`,
// `Timestamp.fromDate`).
import type { Timestamp } from '../api/store'

/** Reexportado do módulo de audit log, onde o tipo é definido. */
export type { PmArea } from '../api/auditLogApi'

export interface ChecklistItem {
  id: string
  title: string
  isChecked: boolean
  orderHint: string
  status?: 'aguardando' | 'em_producao' | 'revisao' | 'refazer' | 'finalizado'
}

export interface RecurrenceConfig {
  pattern: 'daily' | 'weekly' | 'monthly' | 'business-days' | 'custom-days'
  interval: number
  daysOfWeek?: number[]   // 0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb — obrigatório quando pattern === 'custom-days'
  endDate?: Timestamp | null
}

/**
 * Dicionário de etiquetas nomeadas de um projeto. `PMTask.labels[]` guarda só
 * o `id` desta entrada; nome/cor vivem AQUI e propagam por referência —
 * renomear ou trocar cor não reescreve nenhuma task.
 */
export interface PMOfficeLabel {
  id: string
  /**
   * Nome de exibição — pode ser `null` quando a etiqueta nunca foi batizada.
   * Duas etiquetas sem nome e de mesma cor são indistinguíveis entre si (ver
   * `mergedInto` abaixo). A UI usa `displayName` para o rótulo efetivo, nunca
   * `name` cru.
   */
  name: string | null
  /**
   * Rótulo SEMPRE exibível no chip, mesmo quando `name` é `null` (ex.: "Sem
   * nome #1 (amarela)") — WCAG 2.2 AA 1.4.1: cor nunca é o único portador de
   * informação. Editável na UI; `name` continua `null` até alguém batizar a
   * etiqueta de verdade.
   */
  displayName: string
  /**
   * Chave de cor da etiqueta (`'green'`, `'blue'`, …). Nunca um hex: a UI
   * resolve a chave para um par fundo/texto com contraste verificado, em
   * `LABEL_COLOR_TOKENS`.
   */
  colorKey?: string | null
  order: number
  /**
   * Quando presente, esta etiqueta foi fundida em outra (`id` do alvo) — a UI
   * trata os cards que ainda referenciam este `id` como se fossem do alvo,
   * SEM reescrever `PMTask.labels[]`. Reversível: remover `mergedInto` desfaz
   * a fusão sem perder associação nenhuma.
   */
  mergedInto?: string | null
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface PersonRecord {
  key: string
  source: 'clickup' | 'planner' | 'both'
  email: string | null
  uid: string | null
  displayName: string | null
  taskCount: number
  resolved: boolean
  /** Mais de um usuário compartilha este e-mail — resolução automática seria
   * arbitrária. Excluído do `resolvedMap` até revisão manual. */
  ambiguous?: boolean
}

export type EmailToUserMap = Record<string, { uid: string; displayName: string }>

export interface PMProject {
  id: string
  title: string
  source: 'manual'
  status: string
  externalId: string
  progress?: number
  dueDate?: Timestamp
  updatedAt?: Timestamp
  /** UIDs dos membros do quadro. */
  team?: string[]
  /**
   * Quadro arquivado: some da listagem por padrão. Ortogonal a `status` —
   * arquivar não muda nenhum outro campo do quadro nem das tarefas dentro dele.
   */
  archived?: boolean
  archivedAt?: Timestamp
}

export interface PMBucket {
  id: string
  projectId: string
  name: string
  categoryId: string | null
  categoryName: string | null
  order: number
  wbsOrder?: number | null
  categoryOrder?: number | null
  externalId: string
  updatedAt?: Timestamp
  createdAt?: Timestamp
}

export interface PMOfficeTemplate {
  id: string
  name: string
  buckets: { name: string; tasks: string[] }[]
  projectType: 'audiovisual' | 'tecnologia' | 'editorial' | 'desenvolvimento'
  isCustom?: boolean
}

export interface MarketingTaskTemplate {
  id: string
  name: string
  /** Nome(s) da(s) coluna(s) do quadro associadas ao template (PMBucket.name) */
  categorias: string[]
  /** Itens de checklist em ordem, texto livre */
  checklist: string[]
  /** true para templates de exemplo; false para os criados pelo usuário */
  isDefault?: boolean
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Anexo de uma tarefa. O metadado (nome, tipo, tamanho) é independente do
 * binário: um anexo pode existir na lista sem ter arquivo disponível, e a UI
 * mostra esse estado em vez de oferecer um download que falharia.
 */
export interface PMTaskAttachment {
  id: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  /** Onde o binário está guardado. `null` quando só existe o metadado. */
  storagePath: string | null
  /** `true` quando o arquivo em si não está disponível para download. */
  fileMissing: boolean
}

/**
 * Comentário de uma tarefa — guardado à parte da task, não em
 * `PMTask.comments[]`: diferente de `attachments` (dezenas por tarefa, no
 * máximo), o volume de comentários numa thread ativa pode crescer sem teto
 * óbvio.
 *
 * `PMTask.commentCount` (ver abaixo) é o contador DESNORMALIZADO que evita
 * percorrer os comentários para mostrar "3 comentários" no card do quadro.
 */
export interface PMTaskComment {
  id: string
  authorUid: string
  /** Nome de exibição no momento em que o comentário foi escrito — desnormalizado (como `PmAuditMetadata.projectName`) para não exigir lookup do usuário por comentário exibido. Congela se o autor for renomeado depois — aceitável para uma thread, que descreve o passado. */
  authorName: string
  text: string
  createdAt: Timestamp
  /** Presente só se o comentário foi editado depois de criado. */
  updatedAt?: Timestamp
}

export interface PMTask {
  id: string
  projectId: string
  bucketId: string
  parentTaskId: string | null
  title: string
  description: string | null
  source: 'manual'
  type: 'task' | 'subtask'
  /**
   * `'atrasado'` é um 4º status real e persistido, trocável manualmente no
   * mesmo `<select>` de `todo`/`in_progress`/`done` (`TaskDetailModal.tsx`).
   * Além da troca manual, existe um gatilho AUTOMÁTICO — mas deliberadamente
   * LAZY: quando uma tarefa com `dueDate` no passado e status
   * `todo`/`in_progress` é carregada/aberta, o app grava `status: 'atrasado'`
   * naquele momento. Não há varredura em lote nem verificação em background.
   * Ver `previousStatusBeforeAtrasado`.
   */
  status: 'todo' | 'in_progress' | 'done' | 'atrasado'
  priority: string
  progress: number
  assignees: string[]
  assigneesNames?: string[]
  dependsOn?: string[]
  checklist?: ChecklistItem[]
  checklistTotal?: number
  checklistDone?: number
  recurrence?: RecurrenceConfig
  dueDate?: Timestamp | null
  startDate?: Timestamp | null
  order?: number | null
  outlineLevel?: number
  wbsOrder?: number | null
  externalId: string
  /** Checkbox opcional exibido em subtarefas específicas. */
  avisoApi?: boolean
  /** Observações livres da tarefa, editáveis pelo usuário. */
  observacoes?: string | null
  /** Status granular em texto livre, quando a tarefa precisa de um rótulo mais específico que `status`. */
  rawStatus?: string
  /** Campo de texto livre para referências, usado por subtarefas específicas. */
  referencias?: string | null
  /** Campo de link livre, usado por subtarefas específicas. */
  linkRoteiro?: string | null
  /** Timestamp da conclusão mais recente — gravado automaticamente em toda transição →done;
   * removido quando a tarefa é reaberta. Invisível na UI, usado apenas para
   * métricas futuras de prazo. */
  completedAt?: Timestamp | null
  /**
   * Status salvo ANTES da transição AUTOMÁTICA (lazy) para `'atrasado'` — só
   * gravado por essa transição, nunca por uma troca manual do usuário para
   * "Atrasado" (essa é uma escolha explícita, não reversível sozinha). Usado
   * para reverter simetricamente: se a `dueDate` for adiada para o futuro, a
   * próxima vez que a tarefa for carregada/aberta o status volta a este valor
   * e o campo é removido.
   */
  previousStatusBeforeAtrasado?: 'todo' | 'in_progress' | null
  /**
   * Etiquetas aplicadas — guarda o **labelId** do dicionário de etiquetas do
   * projeto, nunca nome nem cor cru. Renomear uma etiqueta no dicionário
   * propaga para todo card que a referencia sem reescrever nenhuma task.
   * Ausente/`[]` = "Sem etiqueta" (opção explícita no filtro, não um estado
   * implícito).
   */
  labels?: string[]
  /**
   * Tarefa arquivada — mesma convenção que `PMProject` usa (`archived: true` +
   * `archivedAt`). Ortogonal a `status`: arquivar não muda
   * Status/progress/dueDate.
   */
  archived?: boolean
  archivedAt?: Timestamp
  /** Inventário de anexos — metadado sem binário, ver {@link PMTaskAttachment}. */
  attachments?: PMTaskAttachment[]
  /**
   * Contador desnormalizado de comentários — incrementado/decrementado a cada
   * `addTaskComment`/`deleteTaskComment` (ver `commentsApi.ts`). Existe só para
   * o card do quadro mostrar "N comentários" sem precisar carregar a thread
   * inteira de cada card (uma coluna pode ter centenas de cards).
   * Ausente/`0` = "sem comentários".
   */
  commentCount?: number
}
