// Sem Firebase neste app: `Timestamp` vem do substituto local em
// `api/store.ts` — compatível com o que a UI consome (`.seconds`, `.toDate()`,
// `.toMillis()`, `Timestamp.fromDate`).
import type { Timestamp } from '../api/store'

/**
 * Reexportado do módulo de audit log (onde o CoreHub o define) porque os
 * componentes copiados o importam daqui.
 */
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
 * Dicionário de etiquetas nomeadas de um projeto (ELO-3182) —
 * `PMOffice/{projectId}/labels/{labelId}`. `PMTask.labels[]` guarda só o
 * `id` deste documento; nome/cor vivem AQUI e propagam por referência —
 * renomear ou trocar cor não reescreve nenhuma task.
 *
 * Nasceu para a importação do Trello ("Agenda Pedagogas"), mas o shape é
 * genérico o bastante para qualquer área que queira etiquetas no futuro
 * (não é exclusivo de Pedagogia).
 */
export interface PMOfficeLabel {
  id: string
  /**
   * Nome de exibição — pode ser `null` quando a etiqueta de origem não tinha
   * nome (2 das 11 etiquetas do Trello "Agenda Pedagogas": ambas `yellow`,
   * uma delas sem nome e com 33 usos, indistinguível de "COMERCIAL" só pela
   * cor — ver `mergedInto` abaixo). A UI usa `displayName` para o rótulo
   * efetivo, nunca `name` cru.
   */
  name: string | null
  /**
   * Rótulo SEMPRE exibível no chip, mesmo quando `name` é `null` (ex.: "Sem
   * nome #1 (amarela)") — WCAG 2.2 AA 1.4.1: cor nunca é o único portador de
   * informação. Editável na UI; `name` continua `null` até alguém batizar a
   * etiqueta de verdade.
   */
  displayName: string
  /** id da etiqueta no Trello, para casar reimportação sem duplicar. */
  trelloLabelId?: string | null
  /** Cor crua do Trello (ex. `'pink_dark'`), preservada só como referência — a UI nunca usa hex do Trello, sempre pares `var(--eh-*)` (ver `LABEL_COLOR_TOKENS`). */
  trelloColor?: string | null
  order: number
  /**
   * Quando presente, esta etiqueta foi fundida em outra (`id` do alvo) — a UI
   * trata os cards que ainda referenciam este `id` como se fossem do alvo,
   * SEM reescrever `PMTask.labels[]` (reversível: remover `mergedInto`
   * desfaz a fusão sem perder associação nenhuma). Usado para as 3 etiquetas
   * `pink_dark` do Trello, que o Marcos pode decidir fundir.
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
  /** Mais de um documento em `users` compartilha este e-mail — resolução
   * automática seria arbitrária (ELO-1445). Excluído do `resolvedMap` até
   * revisão manual. */
  ambiguous?: boolean
}

export type EmailToUserMap = Record<string, { uid: string; displayName: string }>

export interface PMProject {
  id: string
  title: string
  source: 'planner' | 'clickup' | 'graph' | 'manual' | 'linear'
  status: string
  projectType: string
  templateType?: 'livro' | 'guia' | 'ebook-fixo' | 'ebook-fluido' | 'livros-encantadas' | 'rv-mapas' | 'tecnologia-ra'
  layoutVariant?: 'planner-jepp' | 'app-ensino'
  externalId: string
  brands?: ('elo-editora' | 'perabook')[]
  editora?: 'elo' | 'pera' | 'outros'
  progress?: number
  /** Volume histórico total de tarefas por nome de assignee, incluindo tarefas já concluídas.
   * Populado pela Cloud Function `updateProjectAssigneesCount` sem filtro de status.
   * Não representa carga de trabalho atual — use apenas como indicador de volume histórico. */
  assigneesTaskCount?: Record<string, number>
  dueDate?: Timestamp
  syncedAt?: Timestamp
  updatedAt?: Timestamp
  team?: string[]
  /**
   * Projeto arquivado (ELO-3079) — some da listagem por padrão para TODO
   * mundo, inclusive `super_admin`; só `datametria_super_admin` consegue ver
   * (via toggle "Mostrar arquivados") e desarquivar. Ausente/`false` é o
   * default; nenhum projeto existente precisa de backfill retroativo.
   * Ortogonal a `status` — arquivar não muda `status`, `progress`, `brands`
   * nem nenhum outro campo do projeto ou dos livros/tarefas dentro dele.
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
  /**
   * Número de identidade do livro em RV Mapas (pedido do Marcos, 26/08/2026)
   * — diferente de `order`/`wbsOrder`/`categoryOrder`, que mudam quando a
   * lista é reordenada, este é atribuído UMA VEZ na criação (próximo inteiro
   * livre no projeto) e nunca muda depois, mesmo com o toggle de ordenação
   * da ELO-2930. Backfill inicial em
   * `scripts/firestore/backfill-rv-mapas-sequence-number.mjs`. Exclusivo de
   * `templateType === 'rv-mapas'` — `undefined` em outras áreas do PM Office.
   */
  sequenceNumber?: number | null
  /**
   * Posição na planilha de referência externa do Marcos (Google Sheets com
   * a ordem "oficial" dos mapas, 26/08/2026) — critério de ordenação que
   * antecede `createdAt` em RV Mapas: livro numerado na planilha usa esse
   * número; livro sem número continua ordenado por `createdAt`, entrando
   * DEPOIS de todos os numerados. Backfill em
   * `scripts/firestore/backfill-rv-mapas-sheet-order.mjs`. Diferente de
   * `sequenceNumber` (identidade interna, atribuída na criação) — este
   * reflete uma ordem externa que pode ser corrigida re-rodando o backfill
   * se a planilha for atualizada. Exclusivo de `templateType === 'rv-mapas'`.
   */
  sheetOrder?: number | null
  externalId: string
  updatedAt?: Timestamp
  /**
   * Timestamp de criação do bucket (ELO-2924) — gravado com `serverTimestamp()`
   * no momento em que o livro é criado. Opcional porque buckets criados antes
   * desta mudança não têm o campo (sem backfill retroativo). Distinto de
   * `order`, que também nasce de `Date.now()` mas é client-side e reaproveitado
   * por drag-and-drop/reordenação — `createdAt` existe só para ordenação
   * cronológica auditável (hoje usada por `templateType === 'rv-mapas'`).
   */
  createdAt?: Timestamp
  /** Editora do livro, importada da planilha de Acessibilidade/Rádio Novela (col 0). */
  editora?: string | null
  /** Duração do livro no formato hh:mm:ss, importada da planilha (col 3). */
  duracao?: string | null
  /**
   * Quantidade de páginas do livro (ELO-2652). Vive no bucket (= o livro), não
   * na subtarefa: o mesmo número serve a Áudio Descrição e a Libras, e guardar
   * em cada uma abriria espaço para divergirem. Preenchimento manual — não há FK
   * entre `PMBucket` e `books` (a importação casa por título), então não dá para
   * herdar `books.pages` do catálogo.
   */
  paginas?: number | null
  /** Quantidade de caracteres do livro (ELO-2652). Mesma justificativa de {@link paginas}. */
  caracteres?: number | null
  /** Indica que o livro está sendo migrado para outro projeto (ELO-2052). */
  isMoving?: boolean
  /** Prioridade do livro em si (ELO-2768) — independente da prioridade das tarefas. */
  priority?: 'urgent' | 'high' | 'normal' | 'low' | null
  /**
   * Selo (marca) do livro em si (ELO-2925) — independente do `PMProject.brands`,
   * que é a nível de projeto inteiro. Preenchimento manual, mesma justificativa de
   * {@link paginas}: não há FK entre `PMBucket` e `books`, então não há como herdar
   * automaticamente do catálogo (ver ELO-2926 para a ligação real, ainda não feita).
   */
  brand?: 'elo-editora' | 'perabook' | null
  /**
   * Ficha bibliográfica do livro (pedido do Marcos, 31/08/2026) — campos
   * PRÓPRIOS do bucket, sem FK com `books` (mesma limitação de
   * {@link paginas}/{@link brand}: a ligação real com o catálogo é a
   * ELO-2926, ainda não implementada). Preenchimento manual, sem validação
   * de formato de ISBN — editoras às vezes preenchem provisório antes do
   * definitivo.
   */
  author?: string | null
  /** "Ilustrador" não existe hoje nem no Catálogo (`books`) nem em `PMBucket` — campo novo em todo o sistema. */
  illustrator?: string | null
  isbnPhysical?: string | null
  isbnDigital?: string | null
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
  brandScope: 'elo-editora' | 'perabook' | 'ambas'
  /** Itens de checklist em ordem, texto livre */
  checklist: string[]
  /** true para templates seed; false para templates criados por admins */
  isDefault?: boolean
  /**
   * Área dona do template (ELO-2936, com Pedagogia na ELO-3182) — filtra a
   * coleção compartilhada `MarketingTaskTemplates` entre Marketing,
   * Administrativo e Pedagogia. Ausente (`undefined`) em todo template
   * gravado antes da ELO-2936: tratado como `'marketing'` na leitura (ver
   * `subscribeAreaTemplates` em `marketingPlannerApi.ts`) para não exigir
   * backfill nos dados existentes.
   */
  area?: 'marketing' | 'administrativo' | 'pedagogia'
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * Anexo de uma tarefa (ELO-3182 — nasce como INVENTÁRIO, sem binário; a
 * Fase 1/2 da ELO-3184 é quem trata upload/download de verdade).
 *
 * `storagePath: null` + `pendingTrelloDownload: true` é o estado de todo
 * anexo importado do Trello: o metadado já vem completo no JSON exportado
 * (nome, tipo, tamanho, id e URL originais), mas o BINÁRIO continua só no
 * Trello — a ELO-3184 Fase 2 (download real) foi adiada por falta de
 * credencial da API. Sem este inventário, "quantos arquivos ainda só
 * existem no Trello" não teria resposta; com ele, é `pendingTrelloDownload
 * === true` contado, de 240 até 0 conforme a Fase 2 rodar.
 *
 * Uma vez baixado e reenviado ao Storage do CoreHub (fora do escopo desta
 * issue), `storagePath` passa a apontar pro objeto real e
 * `pendingTrelloDownload` vira `false` — o shape já nasce pronto pra esse
 * caminho sem precisar de migração de schema depois.
 */
export interface PMTaskAttachment {
  id: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  /** Caminho no Storage do CoreHub — `null` enquanto o binário não foi baixado do Trello (ELO-3184 Fase 2). */
  storagePath: string | null
  /** `true` enquanto o arquivo só existe no Trello (URL exige auth e morre com a conta — nunca usar como link direto na UI). */
  pendingTrelloDownload: boolean
  /** URL original do Trello (`trello.com/1/cards/.../download/...`), preservada só como referência de auditoria/reimportação — não navegável sem sessão do Trello. */
  trelloUrl?: string | null
  /** id do anexo no Trello, para casar reimportação sem duplicar. */
  trelloAttachmentId?: string | null
}

/**
 * Comentário de uma tarefa (ELO-3183) — vive na subcoleção
 * `PMOffice/{projectId}/buckets/{bucketId}/tasks/{taskId}/comments/{commentId}`,
 * não em `PMTask.comments[]`: diferente de `attachments` (dezenas por
 * tarefa, no máximo), o volume de comentários numa thread ativa pode crescer
 * sem teto óbvio, e um array embutido reescreveria o documento inteiro da
 * task a cada novo comentário — subcoleção grava só o doc novo.
 *
 * `PMTask.commentCount` (ver abaixo) é o contador DESNORMALIZADO que evita
 * ler esta subcoleção para mostrar "3 comentários" no card do quadro.
 */
export interface PMTaskComment {
  id: string
  authorUid: string
  /** Nome de exibição no momento em que o comentário foi escrito — desnormalizado (como `PmAuditMetadata.projectName`) para não exigir lookup em `users/{uid}` por comentário exibido. Congela se o autor for renomeado depois — aceitável para uma thread, que descreve o passado. */
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
  // ELO-3182: 'trello' — importação única do quadro "Agenda Pedagogas".
  source: 'planner' | 'clickup' | 'graph' | 'manual' | 'linear' | 'trello'
  type: 'task' | 'subtask'
  /**
   * ELO-3121: `'atrasado'` é um 4º status real e persistido, trocável
   * manualmente no mesmo `<select>` de `todo`/`in_progress`/`done`
   * (`TaskDetailModal.tsx`). Além da troca manual, existe um gatilho
   * AUTOMÁTICO — mas deliberadamente LAZY (sem Cloud Function/Scheduler,
   * decisão de FinOps já fechada: mesmo risco de amplificação de custo via
   * trigger Firestore do incidente ELO-1989): quando uma tarefa com
   * `dueDate` no passado e status `todo`/`in_progress` é carregada/aberta,
   * o app grava `status: 'atrasado'` naquele momento — não há varredura em
   * lote nem verificação em background. Ver `previousStatusBeforeAtrasado`.
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
  /** Checkbox "AVISO API" — exclusivo da subtarefa Site de acessibilidade */
  avisoApi?: boolean
  /** Observações importadas da planilha de acessibilidade, editáveis pelo usuário */
  observacoes?: string | null
  /** Status granular (vocabulário da planilha de acessibilidade: "Gravando Libras", "Produzindo roteiro", etc.) */
  rawStatus?: string
  /** Referências para criação do mapa — exclusivo da subtarefa "Criação do Guia Pedagógico" em projetos RV Mapas */
  referencias?: string | null
  /** Link do roteiro — exclusivo da subtarefa "Criação do Guia Pedagógico" em projetos RV Mapas */
  linkRoteiro?: string | null
  /** Timestamp da conclusão mais recente — gravado automaticamente em toda transição →done;
   * limpo com deleteField() quando a tarefa é reaberta. Invisível na UI, usado apenas para
   * métricas futuras de prazo. ELO-2188. */
  completedAt?: Timestamp | null
  /**
   * ELO-3121: status salvo ANTES da transição AUTOMÁTICA (lazy) para
   * `'atrasado'` — só gravado por essa transição, nunca por uma troca manual
   * do usuário para "Atrasado" (essa é uma escolha explícita, não reversível
   * sozinha). Usado para reverter simetricamente: se a `dueDate` for adiada
   * para o futuro, a próxima vez que a tarefa for carregada/aberta o status
   * volta a este valor e o campo é limpo com `deleteField()`.
   */
  previousStatusBeforeAtrasado?: 'todo' | 'in_progress' | null
  /**
   * Etiquetas aplicadas (ELO-3182) — guarda o **labelId** do dicionário
   * `PMOffice/{projectId}/labels/{labelId}`, nunca nome nem cor cru. Renomear
   * uma etiqueta no dicionário propaga para todo card que a referencia sem
   * reescrever nenhuma task. Ausente/`[]` = "Sem etiqueta" (opção explícita
   * no filtro, não um estado implícito).
   */
  labels?: string[]
  /**
   * Tarefa arquivada (ELO-3182) — convenção da UI (`archived: true` +
   * `archivedAt`), a MESMA que `PMProject` já usa (ELO-3079). Ortogonal a
   * `status`: arquivar não muda status/progress/dueDate. Diferente da
   * convenção dos SCRIPTS de migração da ELO-3035 (`status: 'Concluído'` +
   * `archivedAt`, sem `archived: true`) — não confundir as duas ao filtrar.
   */
  archived?: boolean
  archivedAt?: Timestamp
  /**
   * Campos de importação do Trello (ELO-3182, board "Agenda Pedagogas") —
   * só a Pedagogia grava. `trelloParsedDate`/`trelloDateEnd` são o resultado
   * do parser de data-no-título (ver `scripts/firestore/import-trello-agenda-pedagogas.mjs`);
   * NUNCA usados como `dueDate` real — são puramente informativos, para não
   * poluir o painel global de atrasos (`/pm-office/atrasos`) com datas
   * extraídas de texto livre e potencialmente erradas (ex.: "13/04/3026").
   */
  trelloParsedDate?: Timestamp | null
  /** Fim do intervalo, quando o título descreve um período ("14 a 17/08/2026"). */
  trelloDateEnd?: Timestamp | null
  /** Trecho de texto bruto de onde a data foi extraída — preservado mesmo quando `trelloParsedDate` não pôde ser gravado (ano fora de 2022-2027). */
  trelloDateRaw?: string | null
  /** Confiança da extração — ver regras de parse no importador. */
  trelloDateConfidence?: 'alta' | 'media' | 'baixa' | null
  /** `true` quando o parser não achou NENHUMA data no título — sinaliza revisão manual. */
  trelloNeedsDateReview?: boolean
  /** Inventário de anexos (ELO-3182/ELO-3184 Fase 1) — metadado sem binário, ver {@link PMTaskAttachment}. */
  attachments?: PMTaskAttachment[]
  /**
   * Contador desnormalizado de comentários (ELO-3183) — incrementado/decrementado
   * a cada `addTaskComment`/`deleteTaskComment` (ver `commentsApi.ts`), nunca lido
   * a partir da subcoleção `comments` em massa. Existe só para o card do quadro
   * mostrar "N comentários" sem 1 leitura extra por card (a coluna Finalizados
   * chega a ter 454 cards) — mesmo raciocínio de `attachments.length` no card,
   * mas via campo próprio porque a subcoleção não vem embutida no doc da task
   * (diferente de `attachments`, que é array no próprio doc). Ausente/`0` =
   * "sem comentários".
   */
  commentCount?: number
}
