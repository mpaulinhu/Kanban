/**
 * Dados de exemplo do quadro — equipe pedagógica de uma editora brasileira
 * (formações de professores, alinhamento com municípios, visitas a escolas).
 *
 * Nomes/e-mails são fictícios, domínio `@exemplo.com.br`.
 */

import type {
  ChecklistItem,
  MarketingTaskTemplate,
  PMBucket,
  PMOfficeLabel,
  PMProject,
  PMTask,
  PMTaskComment,
} from '../types/pmOffice'
import type { UserRecord } from './usersApi'
import { type KanbanState, Timestamp, registerSeedFactory, tsFromDate } from './store'

export const PROJECT_ID = 'pmoffice_area_pedagogia'

function d(iso: string): Timestamp {
  return tsFromDate(new Date(`${iso}T12:00:00`))
}

// ── Usuários ─────────────────────────────────────────────────────────────────

export const SEED_USERS: UserRecord[] = [
  {
    uid: 'demo-user-ana',
    name: 'Ana Beatriz Moreira',
    email: 'ana.moreira@exemplo.com.br',
    role: 'admin',
    jobTitle: 'Coordenadora pedagógica',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-carla',
    name: 'Carla Menezes',
    email: 'carla.menezes@exemplo.com.br',
    role: 'editor',
    jobTitle: 'Consultora pedagógica',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-rafael',
    name: 'Rafael Tavares',
    email: 'rafael.tavares@exemplo.com.br',
    role: 'editor',
    jobTitle: 'Formador de professores',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-juliana',
    name: 'Juliana Prado',
    email: 'juliana.prado@exemplo.com.br',
    role: 'editor',
    jobTitle: 'Analista de conteúdo',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-marcelo',
    name: 'Marcelo Figueiredo',
    email: 'marcelo.figueiredo@exemplo.com.br',
    role: 'viewer',
    jobTitle: 'Assistente pedagógico',
    department: null,
    isActive: true,
  },
]

const ANA = SEED_USERS[0]
const CARLA = SEED_USERS[1]
const RAFAEL = SEED_USERS[2]
const JULIANA = SEED_USERS[3]
const MARCELO = SEED_USERS[4]

// ── Etiquetas ────────────────────────────────────────────────────────────────

// `trelloColor` guarda a chave de cor consumida por `labelColors.ts` — só as 8
// chaves conhecidas (`green`/`blue`/`yellow`/`red`/`purple`/`pink`/`lime`/`orange`).
const LABELS: PMOfficeLabel[] = [
  { id: 'lbl-formacao', name: 'Formação', displayName: 'Formação', trelloColor: 'blue', order: 0, mergedInto: null },
  { id: 'lbl-municipio', name: 'Município', displayName: 'Município', trelloColor: 'green', order: 1, mergedInto: null },
  { id: 'lbl-visita', name: 'Visita a escola', displayName: 'Visita a escola', trelloColor: 'lime', order: 2, mergedInto: null },
  { id: 'lbl-urgente', name: 'Urgente', displayName: 'Urgente', trelloColor: 'red', order: 3, mergedInto: null },
  { id: 'lbl-material', name: 'Material didático', displayName: 'Material didático', trelloColor: 'purple', order: 4, mergedInto: null },
  { id: 'lbl-reuniao', name: 'Reunião', displayName: 'Reunião', trelloColor: 'yellow', order: 5, mergedInto: null },
  { id: 'lbl-relatorio', name: 'Relatório', displayName: 'Relatório', trelloColor: 'orange', order: 6, mergedInto: null },
  { id: 'lbl-eventos', name: 'Eventos', displayName: 'Eventos', trelloColor: 'pink', order: 7, mergedInto: null },
]

// ── Colunas ──────────────────────────────────────────────────────────────────

const BUCKET_DEFS: { id: string; name: string }[] = [
  { id: 'bkt-afazer', name: 'A fazer' },
  { id: 'bkt-andamento', name: 'Em andamento' },
  { id: 'bkt-formacoes', name: 'Formações agendadas' },
  { id: 'bkt-aguardando', name: 'Aguardando município' },
  { id: 'bkt-concluidas', name: 'Concluídas' },
]

function buildBuckets(): PMBucket[] {
  return BUCKET_DEFS.map((b, index) => ({
    id: b.id,
    projectId: PROJECT_ID,
    name: b.name,
    categoryId: null,
    categoryName: null,
    order: index,
    externalId: '',
    createdAt: d('2026-01-12'),
  }))
}

// ── Tarefas ──────────────────────────────────────────────────────────────────

function checklist(titles: string[], doneCount: number): ChecklistItem[] {
  return titles.map((title, i) => ({
    id: `chk-${i}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
    title,
    isChecked: i < doneCount,
    orderHint: String(i).padStart(3, '0'),
    status: i < doneCount ? 'finalizado' : 'aguardando',
  }))
}

interface TaskSeed {
  id: string
  bucketId: string
  title: string
  status: PMTask['status']
  description?: string
  priority?: string
  dueDate?: Timestamp
  startDate?: Timestamp
  assignees?: UserRecord[]
  labels?: string[]
  checklistTitles?: string[]
  checklistDoneCount?: number
  attachmentNames?: string[]
}

const TASK_SEEDS: TaskSeed[] = [
  {
    id: 'tsk-001',
    bucketId: 'bkt-afazer',
    title: 'Montar cronograma de formações do 1º semestre',
    description:
      'Consolidar as datas das formações continuadas de Língua Portuguesa e Matemática por rede municipal, considerando o calendário escolar de cada município.',
    status: 'todo',
    priority: 'high',
    dueDate: d('2026-02-20'),
    assignees: [ANA],
    labels: ['lbl-formacao', 'lbl-municipio'],
    checklistTitles: ['Levantar calendários escolares', 'Definir carga horária', 'Validar com a coordenação', 'Publicar cronograma'],
    checklistDoneCount: 1,
  },
  {
    id: 'tsk-002',
    bucketId: 'bkt-afazer',
    title: 'Revisar material de apoio do 3º ano — alfabetização',
    description: 'Revisão pedagógica das sequências didáticas antes do envio para diagramação.',
    status: 'todo',
    dueDate: d('2026-03-06'),
    assignees: [JULIANA],
    labels: ['lbl-material'],
    checklistTitles: ['Ler sequências 1 a 6', 'Ajustar objetivos de aprendizagem', 'Conferir alinhamento BNCC'],
    checklistDoneCount: 0,
    attachmentNames: ['sequencias-3ano-v2.pdf'],
  },
  {
    id: 'tsk-003',
    bucketId: 'bkt-afazer',
    title: 'Preparar apresentação para a Secretaria de Educação de Itapetininga',
    status: 'todo',
    priority: 'normal',
    dueDate: d('2026-03-18'),
    assignees: [ANA, RAFAEL],
    labels: ['lbl-municipio', 'lbl-reuniao'],
  },
  {
    id: 'tsk-004',
    bucketId: 'bkt-afazer',
    title: 'Atualizar banco de questões do simulado diagnóstico',
    status: 'todo',
    dueDate: d('2026-04-02'),
    assignees: [MARCELO],
    labels: ['lbl-material'],
    checklistTitles: ['Revisar questões de Matemática', 'Revisar questões de Português', 'Subir no ambiente de testes'],
    checklistDoneCount: 0,
  },
  {
    id: 'tsk-005',
    bucketId: 'bkt-afazer',
    title: 'Planejar oficina de mediação de leitura para bibliotecários',
    status: 'todo',
    dueDate: d('2026-05-14'),
    assignees: [CARLA],
    labels: ['lbl-formacao'],
  },

  {
    id: 'tsk-006',
    bucketId: 'bkt-andamento',
    title: 'Formação continuada — Rede Municipal de Sorocaba (turma 2)',
    description: 'Segunda turma da formação de 20h sobre práticas de leitura no Ensino Fundamental I.',
    status: 'in_progress',
    priority: 'high',
    startDate: d('2026-02-10'),
    dueDate: d('2026-03-27'),
    assignees: [RAFAEL, CARLA],
    labels: ['lbl-formacao', 'lbl-municipio'],
    checklistTitles: ['Encontro 1 — leitura literária', 'Encontro 2 — produção textual', 'Encontro 3 — avaliação', 'Enviar certificados'],
    checklistDoneCount: 2,
    attachmentNames: ['plano-formacao-sorocaba.pdf', 'lista-presenca-encontro1.xlsx'],
  },
  {
    id: 'tsk-007',
    bucketId: 'bkt-andamento',
    title: 'Relatório de acompanhamento das escolas parceiras — 1º bimestre',
    status: 'in_progress',
    startDate: d('2026-03-02'),
    dueDate: d('2026-04-10'),
    assignees: [ANA, JULIANA],
    labels: ['lbl-relatorio'],
    checklistTitles: ['Compilar indicadores', 'Escrever análise qualitativa', 'Revisar com a coordenação'],
    checklistDoneCount: 1,
    attachmentNames: ['indicadores-1bim.xlsx'],
  },
  {
    id: 'tsk-008',
    bucketId: 'bkt-andamento',
    title: 'Curadoria de acervo para o projeto "Leitura em Família"',
    status: 'in_progress',
    startDate: d('2026-02-24'),
    dueDate: d('2026-04-24'),
    assignees: [CARLA],
    labels: ['lbl-material', 'lbl-eventos'],
  },
  {
    id: 'tsk-009',
    bucketId: 'bkt-andamento',
    title: 'Alinhar plano de implementação com a equipe de Campinas',
    status: 'atrasado',
    priority: 'urgent',
    startDate: d('2026-01-20'),
    dueDate: d('2026-02-13'),
    assignees: [ANA],
    labels: ['lbl-municipio', 'lbl-urgente', 'lbl-reuniao'],
    checklistTitles: ['Reunião de abertura', 'Definir escolas-piloto', 'Assinar termo de parceria'],
    checklistDoneCount: 1,
  },
  {
    id: 'tsk-010',
    bucketId: 'bkt-andamento',
    title: 'Adaptar trilha formativa para o formato EAD',
    status: 'in_progress',
    startDate: d('2026-03-09'),
    dueDate: d('2026-05-29'),
    assignees: [RAFAEL, MARCELO],
    labels: ['lbl-formacao', 'lbl-material'],
    checklistTitles: ['Roteirizar videoaulas', 'Gravar módulo 1', 'Gravar módulo 2', 'Publicar no ambiente virtual'],
    checklistDoneCount: 1,
  },

  {
    id: 'tsk-011',
    bucketId: 'bkt-formacoes',
    title: 'Formação de professores — Piracicaba (16 e 17/04/2026)',
    status: 'todo',
    priority: 'high',
    dueDate: d('2026-04-16'),
    assignees: [RAFAEL],
    labels: ['lbl-formacao', 'lbl-municipio'],
    attachmentNames: ['convite-piracicaba.pdf'],
  },
  {
    id: 'tsk-012',
    bucketId: 'bkt-formacoes',
    title: 'Encontro com coordenadores — Ribeirão Preto (08/05/2026)',
    status: 'todo',
    dueDate: d('2026-05-08'),
    assignees: [ANA, CARLA],
    labels: ['lbl-reuniao', 'lbl-municipio'],
  },
  {
    id: 'tsk-013',
    bucketId: 'bkt-formacoes',
    title: 'Oficina de avaliação formativa — Bauru (12/06/2026)',
    status: 'todo',
    dueDate: d('2026-06-12'),
    assignees: [CARLA],
    labels: ['lbl-formacao'],
    checklistTitles: ['Confirmar sala', 'Enviar material impresso', 'Confirmar lista de inscritos'],
    checklistDoneCount: 2,
  },
  {
    id: 'tsk-014',
    bucketId: 'bkt-formacoes',
    title: 'Semana pedagógica — Rede Municipal de Jundiaí (27 a 31/07/2026)',
    status: 'todo',
    dueDate: d('2026-07-27'),
    assignees: [ANA, RAFAEL, JULIANA],
    labels: ['lbl-formacao', 'lbl-eventos'],
  },
  {
    id: 'tsk-015',
    bucketId: 'bkt-formacoes',
    title: 'Formação sobre uso do material digital — Limeira (03/09/2026)',
    status: 'todo',
    dueDate: d('2026-09-03'),
    assignees: [MARCELO],
    labels: ['lbl-formacao', 'lbl-material'],
  },

  {
    id: 'tsk-016',
    bucketId: 'bkt-aguardando',
    title: 'Aguardando confirmação de datas — Secretaria de Americana',
    description: 'Enviamos três janelas possíveis em 02/03. Retorno prometido para a semana do dia 16.',
    status: 'todo',
    dueDate: d('2026-03-20'),
    assignees: [ANA],
    labels: ['lbl-municipio'],
  },
  {
    id: 'tsk-017',
    bucketId: 'bkt-aguardando',
    title: 'Aprovação do plano de formação — Secretaria de Marília',
    status: 'atrasado',
    priority: 'high',
    dueDate: d('2026-02-27'),
    assignees: [CARLA],
    labels: ['lbl-municipio', 'lbl-urgente'],
    attachmentNames: ['plano-formacao-marilia.pdf'],
  },
  {
    id: 'tsk-018',
    bucketId: 'bkt-aguardando',
    title: 'Empenho da verba para material impresso — São Carlos',
    status: 'todo',
    dueDate: d('2026-04-30'),
    assignees: [MARCELO],
    labels: ['lbl-municipio', 'lbl-material'],
  },
  {
    id: 'tsk-019',
    bucketId: 'bkt-aguardando',
    title: 'Retorno da escola sobre a visita técnica remarcada',
    status: 'todo',
    dueDate: d('2026-05-21'),
    assignees: [JULIANA],
    labels: ['lbl-visita'],
  },

  {
    id: 'tsk-020',
    bucketId: 'bkt-concluidas',
    title: 'Visita técnica — EMEF Paulo Freire (Sorocaba)',
    description: 'Acompanhamento de duas turmas do 2º ano e devolutiva para a coordenação da escola.',
    status: 'done',
    startDate: d('2026-02-03'),
    dueDate: d('2026-02-06'),
    assignees: [CARLA, RAFAEL],
    labels: ['lbl-visita', 'lbl-municipio'],
    checklistTitles: ['Observar aulas', 'Reunião com a coordenação', 'Escrever devolutiva'],
    checklistDoneCount: 3,
    attachmentNames: ['devolutiva-paulo-freire.pdf'],
  },
  {
    id: 'tsk-021',
    bucketId: 'bkt-concluidas',
    title: 'Reunião de alinhamento com a Secretaria de Indaiatuba',
    status: 'done',
    startDate: d('2026-01-22'),
    dueDate: d('2026-01-23'),
    assignees: [ANA],
    labels: ['lbl-reuniao', 'lbl-municipio'],
  },
  {
    id: 'tsk-022',
    bucketId: 'bkt-concluidas',
    title: 'Guia do professor — coleção de Ciências (5º ano)',
    status: 'done',
    startDate: d('2026-01-08'),
    dueDate: d('2026-02-28'),
    assignees: [JULIANA],
    labels: ['lbl-material'],
    checklistTitles: ['Escrever orientações gerais', 'Escrever orientações por capítulo', 'Revisão final'],
    checklistDoneCount: 3,
  },
  {
    id: 'tsk-023',
    bucketId: 'bkt-concluidas',
    title: 'Relatório final do projeto-piloto de 2025',
    status: 'done',
    startDate: d('2026-01-05'),
    dueDate: d('2026-01-30'),
    assignees: [ANA, JULIANA],
    labels: ['lbl-relatorio'],
    attachmentNames: ['relatorio-piloto-2025.pdf', 'anexo-dados-brutos.csv'],
  },
  {
    id: 'tsk-024',
    bucketId: 'bkt-concluidas',
    title: 'Visita a escolas rurais — Rede Municipal de Itu',
    status: 'done',
    startDate: d('2026-02-17'),
    dueDate: d('2026-02-19'),
    assignees: [RAFAEL],
    labels: ['lbl-visita'],
  },
]

function buildTask(seed: TaskSeed, index: number): PMTask {
  const items = seed.checklistTitles
    ? checklist(seed.checklistTitles, seed.checklistDoneCount ?? 0)
    : undefined
  const assignees = seed.assignees ?? []
  return {
    id: seed.id,
    projectId: PROJECT_ID,
    bucketId: seed.bucketId,
    parentTaskId: null,
    title: seed.title,
    description: seed.description ?? null,
    source: 'manual',
    type: 'task',
    status: seed.status,
    priority: seed.priority ?? 'normal',
    progress: seed.status === 'done' ? 100 : items ? Math.round(((seed.checklistDoneCount ?? 0) / items.length) * 100) : 0,
    assignees: assignees.map((u) => u.uid),
    assigneesNames: assignees.map((u) => u.name),
    ...(items ? { checklist: items, checklistTotal: items.length, checklistDone: seed.checklistDoneCount ?? 0 } : {}),
    ...(seed.dueDate ? { dueDate: seed.dueDate } : {}),
    ...(seed.startDate ? { startDate: seed.startDate } : {}),
    order: index,
    externalId: '',
    labels: seed.labels ?? [],
    ...(seed.attachmentNames
      ? {
          attachments: seed.attachmentNames.map((fileName, i) => ({
            id: `att-${seed.id}-${i}`,
            fileName,
            mimeType: mimeOf(fileName),
            sizeBytes: 120_000 + i * 45_000,
            // Anexo do seed não tem binário — a UI mostra "Pendente de
            // importação" e desabilita o clique, mesmo estado dos 240 anexos
            // ainda só existentes no Trello no app original.
            storagePath: null,
            pendingTrelloDownload: true,
          })),
        }
      : {}),
    ...(seed.status === 'done' && seed.dueDate ? { completedAt: seed.dueDate } : {}),
  }
}

function mimeOf(fileName: string): string | null {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    txt: 'text/plain',
  }
  return map[ext] ?? null
}

// ── Comentários ──────────────────────────────────────────────────────────────

function comment(id: string, author: UserRecord, text: string, at: string): PMTaskComment {
  return {
    id,
    authorUid: author.uid,
    authorName: author.name,
    text,
    createdAt: d(at),
  }
}

const COMMENTS: Record<string, PMTaskComment[]> = {
  'tsk-006': [
    comment('cmt-006-1', ANA, 'Encontro 1 foi ótimo, 42 professoras presentes. Sugiro repetir a dinâmica da roda de leitura na turma 3.', '2026-02-12'),
    comment('cmt-006-2', RAFAEL, 'Anotado. Vou ajustar o roteiro do encontro 2 para sobrar mais tempo na parte prática.', '2026-02-13'),
    comment('cmt-006-3', CARLA, 'Lembrando que os certificados precisam sair até duas semanas depois do último encontro.', '2026-02-20'),
  ],
  'tsk-009': [
    comment('cmt-009-1', ANA, 'A secretaria pediu para remarcar a reunião de abertura pela terceira vez. Vou insistir por e-mail esta semana.', '2026-02-16'),
    comment('cmt-009-2', CARLA, 'Se não houver retorno até sexta, sugiro escalar para a diretoria de ensino.', '2026-02-18'),
  ],
  'tsk-017': [
    comment('cmt-017-1', CARLA, 'Plano enviado em 10/02. Sem retorno até agora — o prazo do edital vence em 15/03.', '2026-02-28'),
  ],
  'tsk-020': [
    comment('cmt-020-1', RAFAEL, 'Devolutiva entregue à coordenação. A escola pediu uma segunda visita no segundo semestre.', '2026-02-09'),
  ],
  'tsk-002': [
    comment('cmt-002-1', JULIANA, 'Comecei pela sequência 4, que é a que tem mais ajustes pendentes da revisão anterior.', '2026-02-25'),
  ],
}

// ── Templates de tarefa ──────────────────────────────────────────────────────

const TEMPLATES: MarketingTaskTemplate[] = [
  {
    id: 'tpl-formacao',
    name: 'Formação presencial',
    categorias: ['Formações agendadas'],
    brandScope: 'ambas',
    checklist: ['Confirmar data com o município', 'Reservar espaço', 'Enviar material impresso', 'Confirmar lista de inscritos', 'Aplicar avaliação', 'Emitir certificados'],
    isDefault: true,
    area: 'pedagogia',
  },
  {
    id: 'tpl-visita',
    name: 'Visita a escola',
    categorias: ['A fazer'],
    brandScope: 'ambas',
    checklist: ['Agendar com a coordenação', 'Observar aulas', 'Reunião de devolutiva', 'Escrever relatório'],
    isDefault: true,
    area: 'pedagogia',
  },
  {
    id: 'tpl-reuniao',
    name: 'Reunião com município',
    categorias: ['A fazer'],
    brandScope: 'ambas',
    checklist: ['Definir pauta', 'Enviar convite', 'Realizar reunião', 'Registrar ata', 'Enviar encaminhamentos'],
    isDefault: true,
    area: 'pedagogia',
  },
]

// ── Montagem ─────────────────────────────────────────────────────────────────

function buildProject(): PMProject {
  return {
    id: PROJECT_ID,
    title: 'Pedagogia',
    source: 'manual',
    status: 'em_andamento',
    projectType: 'pedagogia',
    externalId: '',
    progress: 0,
    team: SEED_USERS.map((u) => u.uid),
  }
}

export function buildSeedState(): KanbanState {
  const orderByBucket = new Map<string, number>()
  const tasks = TASK_SEEDS.map((seed) => {
    const next = orderByBucket.get(seed.bucketId) ?? 0
    orderByBucket.set(seed.bucketId, next + 1)
    return buildTask(seed, next)
  })

  for (const task of tasks) {
    const thread = COMMENTS[task.id]
    if (thread) task.commentCount = thread.length
  }

  return {
    project: buildProject(),
    buckets: buildBuckets(),
    tasks,
    labels: LABELS.map((l) => ({ ...l })),
    templates: TEMPLATES.map((t) => ({ ...t })),
    comments: Object.fromEntries(
      Object.entries(COMMENTS).map(([taskId, thread]) => [taskId, thread.map((c) => ({ ...c }))]),
    ),
    attachmentBlobs: {},
  }
}

registerSeedFactory(buildSeedState)
