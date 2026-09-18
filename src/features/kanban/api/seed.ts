/**
 * Dados de exemplo do quadro — uma equipe de produto digital tocando o
 * lançamento de um app: descoberta, design, desenvolvimento e suporte.
 *
 * Pessoas, empresas e arquivos são fictícios; o domínio dos e-mails é
 * `@exemplo.com.br`. Servem só para o quadro não abrir vazio.
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

export const PROJECT_ID = 'board-demo'

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
    jobTitle: 'Gerente de produto',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-carla',
    name: 'Carla Menezes',
    email: 'carla.menezes@exemplo.com.br',
    role: 'editor',
    jobTitle: 'Designer de produto',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-rafael',
    name: 'Rafael Tavares',
    email: 'rafael.tavares@exemplo.com.br',
    role: 'editor',
    jobTitle: 'Desenvolvedor',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-juliana',
    name: 'Juliana Prado',
    email: 'juliana.prado@exemplo.com.br',
    role: 'editor',
    jobTitle: 'Analista de dados',
    department: null,
    isActive: true,
  },
  {
    uid: 'demo-user-marcelo',
    name: 'Marcelo Figueiredo',
    email: 'marcelo.figueiredo@exemplo.com.br',
    role: 'viewer',
    jobTitle: 'Suporte ao cliente',
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

// `colorKey` guarda a chave de cor consumida por `labelColors.ts` — só as 8
// chaves conhecidas (`green`/`blue`/`yellow`/`red`/`purple`/`pink`/`lime`/`orange`).
const LABELS: PMOfficeLabel[] = [
  { id: 'lbl-produto', name: 'Produto', displayName: 'Produto', colorKey: 'blue', order: 0, mergedInto: null },
  { id: 'lbl-design', name: 'Design', displayName: 'Design', colorKey: 'purple', order: 1, mergedInto: null },
  { id: 'lbl-dev', name: 'Desenvolvimento', displayName: 'Desenvolvimento', colorKey: 'green', order: 2, mergedInto: null },
  { id: 'lbl-urgente', name: 'Urgente', displayName: 'Urgente', colorKey: 'red', order: 3, mergedInto: null },
  { id: 'lbl-pesquisa', name: 'Pesquisa', displayName: 'Pesquisa', colorKey: 'lime', order: 4, mergedInto: null },
  { id: 'lbl-reuniao', name: 'Reunião', displayName: 'Reunião', colorKey: 'yellow', order: 5, mergedInto: null },
  { id: 'lbl-bug', name: 'Bug', displayName: 'Bug', colorKey: 'orange', order: 6, mergedInto: null },
  { id: 'lbl-lancamento', name: 'Lançamento', displayName: 'Lançamento', colorKey: 'pink', order: 7, mergedInto: null },
]

// ── Colunas ──────────────────────────────────────────────────────────────────

const BUCKET_DEFS: { id: string; name: string }[] = [
  { id: 'bkt-afazer', name: 'A fazer' },
  { id: 'bkt-andamento', name: 'Em andamento' },
  { id: 'bkt-revisao', name: 'Em revisão' },
  { id: 'bkt-aguardando', name: 'Aguardando terceiros' },
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
    title: 'Definir o roadmap do primeiro trimestre',
    description:
      'Consolidar as entregas prioritárias do trimestre com base nos pedidos de clientes e na capacidade atual do time.',
    status: 'todo',
    dueDate: d('2026-02-20'),
    assignees: [ANA],
    labels: ['lbl-produto'],
    checklistTitles: ['Levantar pedidos recorrentes', 'Estimar esforço por entrega', 'Validar com a diretoria', 'Publicar roadmap'],
    checklistDoneCount: 1,
  },
  {
    id: 'tsk-002',
    bucketId: 'bkt-afazer',
    title: 'Revisar o fluxo de cadastro de novos usuários',
    description: 'Revisão das telas de cadastro antes de passar para desenvolvimento.',
    status: 'todo',
    dueDate: d('2026-03-06'),
    assignees: [CARLA],
    labels: ['lbl-design'],
    checklistTitles: ['Revisar telas 1 a 6', 'Ajustar mensagens de erro', 'Conferir acessibilidade'],
    checklistDoneCount: 0,
    attachmentNames: ['fluxo-cadastro-v2.pdf'],
  },
  {
    id: 'tsk-003',
    bucketId: 'bkt-afazer',
    title: 'Preparar apresentação de resultados para a diretoria',
    status: 'todo',
    dueDate: d('2026-03-18'),
    assignees: [ANA, JULIANA],
    labels: ['lbl-produto', 'lbl-reuniao'],
  },
  {
    id: 'tsk-004',
    bucketId: 'bkt-afazer',
    title: 'Atualizar a base de testes automatizados',
    status: 'todo',
    dueDate: d('2026-04-02'),
    assignees: [RAFAEL],
    labels: ['lbl-dev'],
    checklistTitles: ['Cobrir o fluxo de pagamento', 'Cobrir o fluxo de login', 'Rodar na esteira'],
    checklistDoneCount: 0,
  },
  {
    id: 'tsk-005',
    bucketId: 'bkt-afazer',
    title: 'Planejar entrevistas com usuários do plano gratuito',
    status: 'todo',
    dueDate: d('2026-05-14'),
    assignees: [JULIANA],
    labels: ['lbl-pesquisa'],
  },

  {
    id: 'tsk-006',
    bucketId: 'bkt-andamento',
    title: 'Refazer a tela de relatórios',
    description: 'Reconstrução da tela com os gráficos que os clientes mais pedem e exportação em CSV.',
    status: 'in_progress',
    startDate: d('2026-02-10'),
    dueDate: d('2026-03-27'),
    assignees: [RAFAEL, CARLA],
    labels: ['lbl-dev', 'lbl-design'],
    checklistTitles: ['Protótipo aprovado', 'Implementar gráficos', 'Implementar exportação', 'Testar com 3 clientes'],
    checklistDoneCount: 2,
    attachmentNames: ['prototipo-relatorios.pdf', 'metricas-uso.xlsx'],
  },
  {
    id: 'tsk-007',
    bucketId: 'bkt-andamento',
    title: 'Relatório de uso do produto — 1º bimestre',
    status: 'in_progress',
    startDate: d('2026-03-02'),
    dueDate: d('2026-04-10'),
    assignees: [ANA, JULIANA],
    labels: ['lbl-produto'],
    checklistTitles: ['Compilar indicadores', 'Escrever análise', 'Revisar com a diretoria'],
    checklistDoneCount: 1,
    attachmentNames: ['indicadores-1bim.xlsx'],
  },
  {
    id: 'tsk-008',
    bucketId: 'bkt-andamento',
    title: 'Pesquisa de satisfação com clientes ativos',
    status: 'in_progress',
    startDate: d('2026-02-24'),
    dueDate: d('2026-04-24'),
    assignees: [JULIANA],
    labels: ['lbl-pesquisa'],
  },
  {
    id: 'tsk-009',
    bucketId: 'bkt-andamento',
    title: 'Corrigir lentidão no carregamento da lista de pedidos',
    status: 'atrasado',
    startDate: d('2026-01-20'),
    dueDate: d('2026-02-13'),
    assignees: [RAFAEL],
    labels: ['lbl-bug', 'lbl-urgente', 'lbl-dev'],
    checklistTitles: ['Reproduzir o problema', 'Identificar a consulta lenta', 'Publicar correção'],
    checklistDoneCount: 1,
  },
  {
    id: 'tsk-010',
    bucketId: 'bkt-andamento',
    title: 'Migrar a documentação para o novo portal de ajuda',
    status: 'in_progress',
    startDate: d('2026-03-09'),
    dueDate: d('2026-05-29'),
    assignees: [MARCELO, CARLA],
    labels: ['lbl-produto'],
    checklistTitles: ['Migrar artigos de conta', 'Migrar artigos de cobrança', 'Revisar links quebrados', 'Publicar'],
    checklistDoneCount: 1,
  },

  {
    id: 'tsk-011',
    bucketId: 'bkt-revisao',
    title: 'Revisão de código — integração de pagamentos',
    status: 'todo',
    dueDate: d('2026-04-16'),
    assignees: [RAFAEL],
    labels: ['lbl-dev'],
    attachmentNames: ['checklist-revisao.pdf'],
  },
  {
    id: 'tsk-012',
    bucketId: 'bkt-revisao',
    title: 'Revisar textos da tela de planos',
    status: 'todo',
    dueDate: d('2026-05-08'),
    assignees: [ANA, CARLA],
    labels: ['lbl-design', 'lbl-produto'],
  },
  {
    id: 'tsk-013',
    bucketId: 'bkt-revisao',
    title: 'Testar o app nos navegadores mais usados',
    status: 'todo',
    dueDate: d('2026-06-12'),
    assignees: [CARLA],
    labels: ['lbl-dev'],
    checklistTitles: ['Chrome e Edge', 'Safari', 'Firefox'],
    checklistDoneCount: 2,
  },
  {
    id: 'tsk-014',
    bucketId: 'bkt-revisao',
    title: 'Preparar comunicado da versão 2.0',
    status: 'todo',
    dueDate: d('2026-07-27'),
    assignees: [ANA, MARCELO, JULIANA],
    labels: ['lbl-lancamento'],
  },
  {
    id: 'tsk-015',
    bucketId: 'bkt-revisao',
    title: 'Validar a nova política de senhas',
    status: 'todo',
    dueDate: d('2026-09-03'),
    assignees: [MARCELO],
    labels: ['lbl-dev', 'lbl-produto'],
  },

  {
    id: 'tsk-016',
    bucketId: 'bkt-aguardando',
    title: 'Aguardando retorno do fornecedor de e-mail',
    description: 'Abrimos chamado em 02/03 sobre o limite de envios. Retorno prometido para a semana do dia 16.',
    status: 'todo',
    dueDate: d('2026-03-20'),
    assignees: [RAFAEL],
    labels: ['lbl-dev'],
  },
  {
    id: 'tsk-017',
    bucketId: 'bkt-aguardando',
    title: 'Aprovação do orçamento de infraestrutura',
    status: 'atrasado',
    dueDate: d('2026-02-27'),
    assignees: [ANA],
    labels: ['lbl-urgente', 'lbl-produto'],
    attachmentNames: ['orcamento-infra.pdf'],
  },
  {
    id: 'tsk-018',
    bucketId: 'bkt-aguardando',
    title: 'Assinatura do contrato com o novo parceiro',
    status: 'todo',
    dueDate: d('2026-04-30'),
    assignees: [MARCELO],
    labels: ['lbl-produto'],
  },
  {
    id: 'tsk-019',
    bucketId: 'bkt-aguardando',
    title: 'Retorno do cliente sobre o piloto da nova tela',
    status: 'todo',
    dueDate: d('2026-05-21'),
    assignees: [JULIANA],
    labels: ['lbl-pesquisa'],
  },

  {
    id: 'tsk-020',
    bucketId: 'bkt-concluidas',
    title: 'Entrevistas de descoberta com cinco clientes',
    description: 'Cinco conversas de uma hora sobre o fluxo de cobrança, com relatório de achados para o time.',
    status: 'done',
    startDate: d('2026-02-03'),
    dueDate: d('2026-02-06'),
    assignees: [CARLA, JULIANA],
    labels: ['lbl-pesquisa'],
    checklistTitles: ['Recrutar participantes', 'Conduzir entrevistas', 'Escrever relatório'],
    checklistDoneCount: 3,
    attachmentNames: ['achados-entrevistas.pdf'],
  },
  {
    id: 'tsk-021',
    bucketId: 'bkt-concluidas',
    title: 'Reunião de alinhamento trimestral',
    status: 'done',
    startDate: d('2026-01-22'),
    dueDate: d('2026-01-23'),
    assignees: [ANA],
    labels: ['lbl-reuniao'],
  },
  {
    id: 'tsk-022',
    bucketId: 'bkt-concluidas',
    title: 'Guia de primeiros passos para novos clientes',
    status: 'done',
    startDate: d('2026-01-08'),
    dueDate: d('2026-02-28'),
    assignees: [MARCELO],
    labels: ['lbl-produto'],
    checklistTitles: ['Escrever visão geral', 'Escrever passo a passo', 'Revisão final'],
    checklistDoneCount: 3,
  },
  {
    id: 'tsk-023',
    bucketId: 'bkt-concluidas',
    title: 'Relatório final do piloto de 2025',
    status: 'done',
    startDate: d('2026-01-05'),
    dueDate: d('2026-01-30'),
    assignees: [ANA, JULIANA],
    labels: ['lbl-produto'],
    attachmentNames: ['relatorio-piloto-2025.pdf', 'anexo-dados-brutos.csv'],
  },
  {
    id: 'tsk-024',
    bucketId: 'bkt-concluidas',
    title: 'Corrigir falha no envio de notificações',
    status: 'done',
    startDate: d('2026-02-17'),
    dueDate: d('2026-02-19'),
    assignees: [RAFAEL],
    labels: ['lbl-bug'],
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
            // Anexo de exemplo não tem binário: a UI o mostra como indisponível
            // e desabilita o clique, em vez de oferecer um download que falha.
            storagePath: null,
            fileMissing: true,
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
    comment('cmt-006-1', ANA, 'O protótipo testou bem com os três clientes. Sugiro manter o filtro de período no topo.', '2026-02-12'),
    comment('cmt-006-2', RAFAEL, 'Anotado. Vou ajustar a ordem dos campos antes de fechar a implementação.', '2026-02-13'),
    comment('cmt-006-3', CARLA, 'Lembrando que a exportação precisa sair junto, senão a entrega fica pela metade.', '2026-02-20'),
  ],
  'tsk-009': [
    comment('cmt-009-1', RAFAEL, 'A consulta demora 8s com mais de 5 mil pedidos. Vou testar um índice novo esta semana.', '2026-02-16'),
    comment('cmt-009-2', ANA, 'Se não resolver até sexta, sugiro limitar a listagem por período como paliativo.', '2026-02-18'),
  ],
  'tsk-017': [
    comment('cmt-017-1', ANA, 'Orçamento enviado em 10/02. Sem retorno até agora — a renovação vence em 15/03.', '2026-02-28'),
  ],
  'tsk-020': [
    comment('cmt-020-1', JULIANA, 'Relatório entregue ao time. Duas pessoas pediram uma segunda rodada no meio do ano.', '2026-02-09'),
  ],
  'tsk-002': [
    comment('cmt-002-1', CARLA, 'Comecei pela tela 4, que é a que tem mais ajustes pendentes da revisão anterior.', '2026-02-25'),
  ],
}

// ── Templates de tarefa ──────────────────────────────────────────────────────

const TEMPLATES: MarketingTaskTemplate[] = [
  {
    id: 'tpl-entrega',
    name: 'Entrega de funcionalidade',
    categorias: ['Em revisão'],
    checklist: ['Alinhar escopo', 'Prototipar', 'Implementar', 'Revisar código', 'Testar', 'Publicar'],
    isDefault: true,
  },
  {
    id: 'tpl-pesquisa',
    name: 'Pesquisa com usuários',
    categorias: ['A fazer'],
    checklist: ['Definir perguntas', 'Recrutar participantes', 'Conduzir entrevistas', 'Escrever relatório'],
    isDefault: true,
  },
  {
    id: 'tpl-reuniao',
    name: 'Reunião recorrente',
    categorias: ['A fazer'],
    checklist: ['Definir pauta', 'Enviar convite', 'Realizar reunião', 'Registrar ata', 'Enviar encaminhamentos'],
    isDefault: true,
  },
]

// ── Montagem ─────────────────────────────────────────────────────────────────

function buildProject(): PMProject {
  return {
    id: PROJECT_ID,
    title: 'Meu quadro',
    source: 'manual',
    status: 'em_andamento',
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
