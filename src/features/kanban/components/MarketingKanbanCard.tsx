import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ChecklistItem, PMOfficeLabel, PMTask } from '../types/pmOffice'
import { updateChecklistItemStatus } from '../api/marketingPlannerApi'
import { logPmAction } from '../api/auditLogApi'
import type { UserRecord } from '../api/usersApi'
import { AssigneeAvatars } from './AssigneeAvatars'
import { LabelChips } from './LabelChips'
import { UserProfilePopover } from '@/components/UserProfilePopover'

/**
 * Exportada porque `DayView` (MarketingCalendarioPage.tsx) reusa a mesma
 * regra de resolução de foto pra montar o card de tarefa da visão Dia, sem
 * duplicar a lógica.
 */
export function findPhotoByName(name: string, users: UserRecord[]): string | undefined {
  const target = name.trim().toLowerCase()
  const matches = users.filter((u) => u.name.trim().toLowerCase() === target)
  return matches.length === 1 ? matches[0].photoURL : undefined
}

/** Resolve o e-mail do usuário por nome exato — mesma regra de `findPhotoByName`. */
function findEmailByName(name: string, users: UserRecord[]): string | undefined {
  const target = name.trim().toLowerCase()
  const matches = users.filter((u) => u.name.trim().toLowerCase() === target)
  return matches.length === 1 ? matches[0].email : undefined
}

/**
 * Só UM popover de perfil pode ficar aberto no quadro inteiro —
 * o estado vive dentro de cada card (que é memoizado; levantá-lo para a
 * página passaria um callback novo a cada render e anularia o `memo`), então
 * a exclusão mútua acontece por este evento: ao abrir, um card anuncia seu
 * id e todos os outros fecham o seu.
 */
const PROFILE_POPOVER_EVENT = 'kanban:profile-popover-open'



/**
 * Pulso visual de ~2s aplicado uma única vez à tarefa alvo de um link "Minhas
 * Tarefas" (Dashboard). Manter em sincronia com o fade-out abaixo — valores
 * divergentes produzem um corte visível no fim do pulso.
 */
const HIGHLIGHT_ANIMATION = 'eh-task-highlight-pulse 2s ease-in-out 1'

/**
 * Fallback pra suavizar o FIM do destaque: sem a transição, o
 * `background-color` corta de uma vez quando a animação termina.
 */
const HIGHLIGHT_FADE_OUT_TRANSITION = 'background-color 350ms ease-out'

/**
 * Exportado: `DayView` (MarketingCalendarioPage.tsx) usa a mesma paleta pro
 * card de tarefa da visão Dia — mesmas 4 cores, sem duplicar a definição.
 */
export const STATUS_DOT: Record<string, string> = {
  todo: 'var(--eh-muted-2)',
  // Laranja, não azul — pareado de propósito com o chip de status do
  // cabeçalho do modal (STATUS_CHIP_CFG em TaskDetailModal.tsx), que já
  // usava laranja para "Em andamento". Usado nos 3 pontos deste arquivo
  // (bolinha de título, bolinha ao lado da data — que TROCOU de prioridade
  // para status — e o submenu "⋯"), então a mudança fica consistente
  // dentro do próprio card.
  in_progress: '#f97316',
  done: '#22c55e',
  atrasado: '#ef4444',
}

/**
 * Opções do seletor de status do card. Só os três estados que o usuário
 * escolhe à mão — `atrasado` fica de fora de propósito: ele é atribuído
 * automaticamente quando o prazo vence (`applyLazyOverdueTransition`) e
 * oferecê-lo aqui como escolha manual quebraria essa reversão automática.
 * Uma tarefa atrasada continua mostrando o rótulo correto no menu, e
 * escolher qualquer opção daqui a tira do estado atrasado.
 *
 * Exportada: `DayView` reusa o mesmo seletor de status.
 */
export const CARD_STATUS_OPTIONS: { value: PMTask['status']; label: string }[] = [
  { value: 'todo', label: 'A fazer' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'done', label: 'Concluída' },
]

export const CARD_STATUS_LABEL: Record<string, string> = {
  todo: 'A fazer',
  in_progress: 'Em andamento',
  done: 'Concluída',
  atrasado: 'Atrasado',
}

type ChecklistStatus = NonNullable<ChecklistItem['status']>

const CHECKLIST_STATUS_META: Record<ChecklistStatus, { label: string; fg: string; bg: string }> = {
  aguardando:  { label: 'Aguardando',  fg: 'var(--eh-danger)',     bg: 'var(--eh-danger-bg)'  },
  em_producao: { label: 'Em produção', fg: 'var(--eh-warn-fg)',    bg: 'var(--eh-warn-bg)'    },
  revisao:     { label: 'Revisão',     fg: 'var(--eh-primary)',    bg: 'var(--eh-bar-track)'  },
  refazer:     { label: 'Refazer',     fg: 'var(--eh-muted-2)',    bg: 'var(--eh-surface-2)'  },
  finalizado:  { label: 'Finalizado',  fg: 'var(--eh-success-fg)', bg: 'var(--eh-success-bg)' },
}

const STATUS_ORDER: ChecklistStatus[] = ['aguardando', 'em_producao', 'revisao', 'refazer', 'finalizado']

function resolveStatus(item: ChecklistItem): ChecklistStatus {
  if (item.status) return item.status
  return item.isChecked ? 'finalizado' : 'aguardando'
}

function toDate(ts: unknown): Date | null {
  if (!ts) return null
  const secs = (ts as { seconds?: number }).seconds
  return typeof secs === 'number' ? new Date(secs * 1000) : null
}

/** Exportada: `DayTaskCard` (MarketingCalendarioPage.tsx) usa o mesmo formato de data. */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/**
 * `memo` reduz o custo de renderizar os 454 cards da Pedagogia
 * durante o arrasto, mas NÃO resolve a causa raiz do travamento — o
 * `contextValue` do `SortableContext` do dnd-kit muda a cada frame que o
 * `overIndex` muda (encostar num vizinho), e Contexto React ignora `memo`
 * por construção (todo consumidor do contexto — os `useSortable` de cada
 * card — é obrigado a re-renderizar mesmo memoizado). O ganho real aqui é
 * evitar trabalho redundante nos re-renders que já vão acontecer de
 * qualquer forma (ex.: reordenar outro card na mesma coluna, sem tocar em
 * `task`/`accentColor`/etc. deste aqui). A correção estrutural é
 * virtualizar a coluna (não feita nesta issue — dependência não instalada,
 * ver relato do specialist).
 */
export const MarketingKanbanCard = memo(function MarketingKanbanCard({
  task,
  onExpand,
  accentColor,
  sortableId,
  bucketId,
  onStartDateAutoFilled,
  readOnly = false,
  buckets,
  allBuckets,
  onMove,
  onChangeStatus,
  onClone,
  onDelete,
  onToggleArchive,
  highlighted = false,
  users,
  area = 'marketing',
  labelsById,
  overlay = false,
}: {
  task: PMTask
  onExpand: () => void
  accentColor?: string
  sortableId: string
  /** Bucket ao qual esta tarefa pertence — passado ao useSortable.data para cross-column DnD. */
  bucketId: string
  onStartDateAutoFilled?: (task: PMTask, date: Date) => void
  /** Viewer não pode reordenar (drag) nem mudar status de checklist inline. */
  readOnly?: boolean
  /** Colunas de destino disponíveis para mover a tarefa (exclui a coluna atual). */
  buckets?: { id: string; name: string }[]
  /** Todas as colunas disponíveis para clonar (inclui a coluna atual). */
  allBuckets?: { id: string; name: string }[]
  /** Chamado quando o usuário seleciona uma coluna de destino no menu "Mover para". */
  onMove?: (targetBucketId: string) => void
  /** Chamado quando o usuário confirma a clonagem para uma coluna de destino. */
  onClone?: (targetBucketId: string) => void
  /** Chamado quando o usuário solicita exclusão da tarefa. */
  onDelete?: () => void
  /** Chamado quando o usuário alterna arquivado/desarquivado. Ausente = item não aparece no menu (Marketing/Administrativo, sem UI de arquivamento por card ainda pedida). */
  onToggleArchive?: () => void
  /**
   * Chamado quando o usuário escolhe outro status no seletor do card.
   * Ausente = o seletor não aparece.
   */
  onChangeStatus?: (next: PMTask['status']) => void
  /** Tarefa alvo de um link "Minhas Tarefas" — recebe pulso visual temporário. */
  highlighted?: boolean
  /** Usuários do workspace, para resolver foto de perfil dos responsáveis. Sem essa lista, cai no fallback de iniciais. */
  users?: UserRecord[]
  /** Área dona da tarefa — usada só para o audit log do clique de status no card. Default 'marketing' preserva o comportamento existente. */
  area?: 'marketing' | 'administrativo' | 'pedagogia'
  /** Dicionário de etiquetas do projeto — `undefined`/vazio em Marketing/Administrativo hoje, então `LabelChips` não renderiza nada lá. */
  labelsById?: Map<string, PMOfficeLabel>
  /**
   * `true` quando este card é a cópia flutuante renderizada pelo `DragOverlay`
   * O overlay já aplica rotação/sombra/opacidade no
   * wrapper — aqui só evitamos repetir esses efeitos, que dobrariam a
   * inclinação e escureceriam a sombra.
   */
  overlay?: boolean
}) {
  const resolvedLabelsById = labelsById ?? new Map<string, PMOfficeLabel>()
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  // Menu de 3 pontos (⋯)
  const [cardMenuOpen, setCardMenuOpen] = useState(false)
  const [cardMenuMode, setCardMenuMode] = useState<null | 'move' | 'clone' | 'status'>(null)
  const cardMenuBtnRef = useRef<HTMLButtonElement>(null)
  const cardMenuPopRef = useRef<HTMLDivElement>(null)
  const [cardMenuPos, setCardMenuPos] = useState({ top: 0, left: 0 })
  // Estado otimista local do checklist para refletir mudanças imediatamente
  const [localChecklist, setLocalChecklist] = useState<ChecklistItem[]>(task.checklist ?? [])
  // Popover de perfil ao clicar num avatar do card — guarda o
  // índice em `assigneesNames` e o elemento clicado, que serve de âncora.
  const [profilePopover, setProfilePopover] = useState<{ index: number; anchor: HTMLElement } | null>(null)

  // Fecha este popover quando QUALQUER outro card abre o seu — sem isso dava
  // para deixar vários abertos ao mesmo tempo pelo quadro.
  useEffect(() => {
    if (!profilePopover) return
    function onOtherOpened(e: Event) {
      if ((e as CustomEvent<string>).detail !== task.id) setProfilePopover(null)
    }
    document.addEventListener(PROFILE_POPOVER_EVENT, onOtherOpened)
    return () => document.removeEventListener(PROFILE_POPOVER_EVENT, onOtherOpened)
  }, [profilePopover, task.id])

  // `disabled` no overlay: o card flutuante não participa da ordenação (quem
  // o posiciona é o `DragOverlay`). Hook não pode ser condicional, então
  // desabilita-se em vez de não chamar. Sem isso o overlay se registraria
  // como um segundo item sortable com o MESMO id do original.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { type: 'task', bucketId },
    disabled: overlay,
  })

  // Sincroniza checklist local quando os dados da tarefa mudam
  useEffect(() => {
    setLocalChecklist(task.checklist ?? [])
  }, [task.checklist])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!openDropdownId) return
    function onOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-checklist-dropdown]')) return
      setOpenDropdownId(null)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [openDropdownId])

  // Fecha menu ⋯ ao clicar fora
  useEffect(() => {
    if (!cardMenuOpen) return
    function onOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-card-menu]')) return
      setCardMenuOpen(false)
      setCardMenuMode(null)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [cardMenuOpen])

  // Posiciona o dropdown do menu ⋯ via portal
  useLayoutEffect(() => {
    if (!cardMenuOpen || !cardMenuPopRef.current || !cardMenuBtnRef.current) return
    const popRect = cardMenuPopRef.current.getBoundingClientRect()
    const btnRect = cardMenuBtnRef.current.getBoundingClientRect()
    const GAP = 4
    let top = btnRect.bottom + GAP
    let left = btnRect.right - popRect.width
    if (top + popRect.height + 8 > window.innerHeight) {
      top = Math.max(8, btnRect.top - popRect.height - GAP)
    }
    if (left < 8) left = 8
    if (left + popRect.width + 8 > window.innerWidth) {
      left = Math.max(8, window.innerWidth - popRect.width - 8)
    }
    setCardMenuPos({ top, left })
  }, [cardMenuOpen, cardMenuMode])

  const dueDate = toDate(task.dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isOverdue = dueDate !== null && dueDate < today && task.status !== 'done'
  const names = task.assigneesNames ?? []
  const hasChecklist = (task.checklistTotal ?? 0) > 0
  // Card em estilo compacto, exclusivo da área Pedagogia. As demais áreas
  // continuam com o card padrão.
  const isPedagogia = area === 'pedagogia'

  // Calcula contadores a partir do estado local otimista
  const checkDone = localChecklist.filter((i) => resolveStatus(i) === 'finalizado').length
  const checkTotal = localChecklist.length > 0 ? localChecklist.length : (task.checklistTotal ?? 0)
  const checkComplete = checkDone === checkTotal && checkTotal > 0

  async function handleStatusChange(itemId: string, status: ChecklistStatus) {
    if (!task.projectId || !task.bucketId) return
    // Atualização otimista imediata
    setLocalChecklist((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status, isChecked: status === 'finalizado' } : i)),
    )
    const previousItem = localChecklist.find((i) => i.id === itemId)
    const result = await updateChecklistItemStatus(
      task.projectId,
      task.bucketId,
      task,
      itemId,
      status,
    ).catch(() => ({ autoFilledStartDate: false, filledDate: undefined }))
    // Mudar status pelo card (sem abrir o modal) tambem e acao humana.
    logPmAction(
      'pm_checklist.item_status',
      {
        id: itemId,
        type: 'pm_checklist_item',
        description: `${previousItem?.title ?? itemId} (em: ${task.title ?? task.id})`,
      },
      {
        area,
        projectId: task.projectId,
        projectName: '',
        bucketId: task.bucketId,
        changes: [{ field: 'status', before: previousItem?.status ?? null, after: status }],
      },
    )
    if (result.autoFilledStartDate && result.filledDate) {
      onStartDateAutoFilled?.(task, result.filledDate)
    }
  }

  const mainMenuBtnStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    width: '100%',
    textAlign: 'left',
    fontSize: 12.5,
    fontWeight: 500,
    color: 'var(--eh-text-2)',
    background: 'transparent',
    padding: '7px 10px',
    borderRadius: 5,
    border: 'none',
    cursor: 'pointer',
  }

  const subMenuBtnStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--eh-text-2)',
    background: 'transparent',
    padding: '5px 8px',
    borderRadius: 5,
    border: 'none',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  const cardStyle: CSSProperties = {
    background: 'var(--eh-surface)',
    border: isPedagogia ? 'none' : '1px solid var(--eh-border)',
    borderRadius: isPedagogia ? 8 : 10,
    // O padding fica no wrapper, e não dividido em "outer padding:0 + inner
    // wrapper": o resultado em PIXELS é idêntico nos dois arranjos, e dividir
    // exigiria reestruturar todo o JSX interno (label bar, checklist, footer,
    // menu ⋯) — risco real de regressão num componente com portais e
    // drag-and-drop, por um ganho puramente arquitetural.
    // Pedagogia: card com mais respiro interno — ~12px laterais e ~10px
    // verticais. O '8px 10px' anterior deixava o conteúdo apertado demais.
    padding: isPedagogia ? '10px 12px' : '10px 12px 9px',
    marginBottom: isPedagogia ? 8 : 8,
    // Sombra dupla (rgba(30,31,33,.25) 0 1px 1px 0, rgba(30,31,33,.31) 0 0
    // 1px 0) em vez do borderLeft colorido, já que a cor da coluna é indicada pelo
    // cabeçalho, então o card fica mais limpo/compacto sem a faixa lateral.
    // Sombra: no overlay quem aplica é o wrapper do DragOverlay (senão
    // dobraria). Em repouso, a sombra dupla definida acima.
    boxShadow: overlay
      ? 'none'
      : isPedagogia
        ? '0 1px 1px 0 rgba(30,31,33,0.25), 0 0 1px 0 rgba(30,31,33,0.31)'
        : '0 1px 2px rgba(0,0,0,0.04)',
    position: 'relative',
    cursor: 'pointer',
    // Transform: no overlay é o dnd-kit quem posiciona o wrapper — aplicar
    // aqui de novo deslocaria o card duas vezes.
    transform: overlay ? undefined : CSS.Transform.toString(transform),
    ...(isDragging ? { zIndex: 999 } : {}),
    // Combina a transition de drag do dnd-kit com o fade-out do destaque —
    // sem isso, o `background-color` teria transição implícita "none" e o
    // corte no fim do highlight ficaria abrupto.
    transition: transition ? `${transition}, ${HIGHLIGHT_FADE_OUT_TRANSITION}` : HIGHLIGHT_FADE_OUT_TRANSITION,
    // Opacidade sozinha NÃO indica "arquivada" de forma perceptível pra baixa
    // visão — ela acompanha o chip "Arquivada" abaixo, que carrega a mesma
    // informação em texto.
    // Na Pedagogia, tarefa concluída (`status: 'done'`) NÃO esmaece: ali
    // "concluída" é o registro de trabalho principal da tela, não algo a
    // apagar. Só esmaece quando de fato arquivada.
    // Com o DragOverlay, quem se vê "na mão" é a cópia flutuante — este
    // elemento é o lugar de ORIGEM, e vira um vazio discreto marcando onde o
    // card cairá. As áreas sem overlay mantêm o comportamento anterior.
    opacity: isDragging ? (isPedagogia ? 0.35 : 0.4) : task.archived ? 0.6 : 1,
    ...(!isPedagogia && accentColor ? { borderLeft: `3px solid ${accentColor}59` } : {}),
    // NÃO reintroduzir `content-visibility: auto` + `containIntrinsicSize`
    // aqui. Parecem um ganho barato de performance numa coluna com centenas de
    // cards, mas quebram o drag: o dnd-kit mede `getBoundingClientRect()` dos
    // itens sortable, e um elemento com `content-visibility: auto` fora da
    // viewport reporta altura ZERO até intersectá-la — o que corrompe o
    // cálculo de posição do `closestCenter`. Na prática isso produziu arraste
    // cheio de saltos, e foi revertido.
    //
    // Se a performance da coluna longa voltar a incomodar, o caminho é
    // virtualização de verdade (react-window/virtua), não um hack de CSS que
    // mente sobre a altura dos elementos para a biblioteca de drag.
    ...(highlighted
      ? {
          animation: HIGHLIGHT_ANIMATION,
          // O card (diferente do SubtaskRow) tem `background` próprio
          // (`var(--eh-surface)`, não transparente) — o keyframe
          // precisa terminar nesse mesmo valor pra não saltar quando a
          // animação para (ver comentário do @keyframes em globals.css).
          '--eh-highlight-rest-color': 'var(--eh-surface)',
        }
      : {}),
  } as CSSProperties

  return (
    // `data-task-id` só no card REAL: a página do quadro usa esse atributo
    // para rolar até uma tarefa. Se o overlay também o carregasse,
    // haveria dois elementos com o mesmo id durante o arrasto.
    <div ref={setNodeRef} data-task-id={overlay ? undefined : task.id} style={cardStyle} onClick={overlay ? undefined : onExpand} {...attributes} {...(readOnly ? {} : listeners)}>
      {/* Etiquetas como barra sólida ACIMA do título,
          exclusiva da Pedagogia. As demais áreas mantêm o chip
          pastel abaixo do checklist (ver chamada de LabelChips mais abaixo). */}
      {isPedagogia && <LabelChips labelIds={task.labels} labelsById={resolvedLabelsById} variant="solid" />}
      {/* title row */}
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
        {/* Bolinha de status — some na Pedagogia, onde a cor da etiqueta já
            carrega a informação. As demais áreas mantêm o indicador. */}
        {!isPedagogia && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              marginTop: 5,
              flexShrink: 0,
              background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)',
            }}
          />
        )}
        <p
          style={{
            margin: 0,
            // Duas correções de tipografia que não são arbitrárias:
            //
            // 1. `lineHeight` era 14px — igual ao fontSize. Esse número só
            //    funciona em card de UMA linha, onde line-height não tem efeito
            //    visível. Em título de várias linhas (a maioria aqui) as linhas
            //    ficam coladas; ~20px de leading resolve.
            // 2. `fontWeight` 500 dependia de uma fonte que não é carregada.
            //    Na stack de fallback do Windows isso cai em Segoe UI, mais
            //    pesada no mesmo peso nominal — daí o texto parecer "mais
            //    grosso" que o pretendido. 400 aproxima melhor a densidade.
            //
            // As demais áreas mantêm os valores originais
            // (13/500/1.45/--eh-text-strong).
            fontSize: isPedagogia ? 14 : 13,
            fontFamily: isPedagogia
              ? 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif'
              : undefined,
            fontWeight: isPedagogia ? 400 : 500,
            lineHeight: isPedagogia ? '20px' : 1.45,
            flex: 1,
            color: isPedagogia ? 'var(--eh-pm-card-title-fg)' : 'var(--eh-text-strong)',
            wordBreak: 'break-word',
          }}
        >
          {task.title}
        </p>
        {/* Botão ⋯ — menu de opções do card (Mover para / Clonar / Excluir). */}
        {!readOnly && (onMove || onClone || onDelete || onToggleArchive) && (
          <div style={{ flexShrink: 0 }} data-card-menu="">
            <button
              ref={cardMenuBtnRef}
              onClick={(e) => {
                e.stopPropagation()
                setCardMenuOpen((v) => !v)
                setCardMenuMode(null)
              }}
              title="Opções da tarefa"
              aria-label="Opções da tarefa"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 4px',
                color: 'var(--eh-muted-2)',
                lineHeight: 1,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                marginTop: 1,
                fontSize: 15,
                letterSpacing: 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--eh-text-2)'
                e.currentTarget.style.background = 'var(--eh-bg)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--eh-muted-2)'
                e.currentTarget.style.background = 'none'
              }}
            >
              ⋯
            </button>
            {cardMenuOpen && createPortal(
              <div
                ref={cardMenuPopRef}
                data-card-menu=""
                style={{
                  position: 'fixed',
                  top: cardMenuPos.top,
                  left: cardMenuPos.left,
                  zIndex: 9999,
                  background: 'var(--eh-surface)',
                  border: '1px solid var(--eh-border)',
                  borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
                  padding: 4,
                  minWidth: 170,
                  maxWidth: 240,
                }}
              >
                {cardMenuMode === 'status' ? (
                  /* Seletor de status da tarefa */
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 2px' }}>
                      <button
                        data-card-menu=""
                        onClick={(e) => { e.stopPropagation(); setCardMenuMode(null) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eh-text-3)', fontSize: 12, padding: 0, lineHeight: 1 }}
                        aria-label="Voltar"
                      >←</button>
                      <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--eh-text-3)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Status
                      </p>
                    </div>
                    {CARD_STATUS_OPTIONS.map((opt) => {
                      const selecionado = task.status === opt.value
                      return (
                        <button
                          key={opt.value}
                          data-card-menu=""
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!selecionado) onChangeStatus?.(opt.value)
                            setCardMenuOpen(false)
                            setCardMenuMode(null)
                          }}
                          style={{
                            ...subMenuBtnStyle,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            ...(selecionado ? { color: 'var(--eh-text-strong)', fontWeight: 600 } : {}),
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              flexShrink: 0,
                              background: STATUS_DOT[opt.value] ?? 'var(--eh-muted-2)',
                            }}
                          />
                          {opt.label}
                          {/* Marca a opção vigente: o ponto colorido sozinho
                              diz qual é o status, não qual está selecionado. */}
                          {selecionado && (
                            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--eh-text-3)' }}>✓</span>
                          )}
                        </button>
                      )
                    })}
                  </>
                ) : cardMenuMode === 'move' ? (
                  /* Seletor de coluna de destino para mover */
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 2px' }}>
                      <button
                        data-card-menu=""
                        onClick={(e) => { e.stopPropagation(); setCardMenuMode(null) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eh-text-3)', fontSize: 12, padding: 0, lineHeight: 1 }}
                        aria-label="Voltar"
                      >←</button>
                      <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--eh-text-3)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Mover para
                      </p>
                    </div>
                    {(buckets ?? []).map((b) => (
                      <button
                        key={b.id}
                        data-card-menu=""
                        onClick={(e) => {
                          e.stopPropagation()
                          onMove?.(b.id)
                          setCardMenuOpen(false)
                          setCardMenuMode(null)
                        }}
                        style={subMenuBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)'; e.currentTarget.style.color = 'var(--eh-text-strong)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--eh-text-2)' }}
                      >
                        {b.name}
                      </button>
                    ))}
                  </>
                ) : cardMenuMode === 'clone' ? (
                  /* Seletor de coluna de destino para clonar */
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 2px' }}>
                      <button
                        data-card-menu=""
                        onClick={(e) => { e.stopPropagation(); setCardMenuMode(null) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eh-text-3)', fontSize: 12, padding: 0, lineHeight: 1 }}
                        aria-label="Voltar"
                      >←</button>
                      <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--eh-text-3)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Clonar para
                      </p>
                    </div>
                    {(allBuckets ?? buckets ?? []).length > 0 ? (
                      (allBuckets ?? buckets)!.map((b) => (
                        <button
                          key={b.id}
                          data-card-menu=""
                          onClick={(e) => {
                            e.stopPropagation()
                            onClone?.(b.id)
                            setCardMenuOpen(false)
                            setCardMenuMode(null)
                          }}
                          style={subMenuBtnStyle}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)'; e.currentTarget.style.color = 'var(--eh-text-strong)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--eh-text-2)' }}
                        >
                          {b.name}
                        </button>
                      ))
                    ) : (
                      <button
                        data-card-menu=""
                        onClick={(e) => {
                          e.stopPropagation()
                          onClone?.(bucketId)
                          setCardMenuOpen(false)
                          setCardMenuMode(null)
                        }}
                        style={subMenuBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        Esta coluna
                      </button>
                    )}
                  </>
                ) : (
                  /* Menu principal */
                  <>
                    {onChangeStatus && (
                      <button
                        data-card-menu=""
                        onClick={(e) => { e.stopPropagation(); setCardMenuMode('status') }}
                        style={mainMenuBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)'; e.currentTarget.style.color = 'var(--eh-text-strong)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--eh-text-2)' }}
                      >
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: '50%',
                            flexShrink: 0,
                            background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)',
                          }}
                        />
                        Status: {CARD_STATUS_LABEL[task.status] ?? task.status}
                      </button>
                    )}
                    {onChangeStatus && (onMove || onClone || onToggleArchive || onDelete) && (
                      <div style={{ height: 1, background: 'var(--eh-border)', margin: '4px 0' }} />
                    )}
                    {onMove && buckets && buckets.length > 0 && (
                      <button
                        data-card-menu=""
                        onClick={(e) => { e.stopPropagation(); setCardMenuMode('move') }}
                        style={mainMenuBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)'; e.currentTarget.style.color = 'var(--eh-text-strong)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--eh-text-2)' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M10 3l4 5-4 5M6 13l-4-5 4-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Mover para
                      </button>
                    )}
                    {onClone && (
                      <button
                        data-card-menu=""
                        onClick={(e) => { e.stopPropagation(); setCardMenuMode('clone') }}
                        style={mainMenuBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)'; e.currentTarget.style.color = 'var(--eh-text-strong)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--eh-text-2)' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Clonar
                      </button>
                    )}
                    {onToggleArchive && (onMove || onClone) && (
                      <div style={{ height: 1, background: 'var(--eh-border)', margin: '2px 6px' }} />
                    )}
                    {onToggleArchive && (
                      <button
                        data-card-menu=""
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleArchive()
                          setCardMenuOpen(false)
                        }}
                        style={mainMenuBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)'; e.currentTarget.style.color = 'var(--eh-text-strong)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--eh-text-2)' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="4" width="18" height="4" rx="1"/>
                          <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/>
                          <path d="M10 13h4"/>
                        </svg>
                        {task.archived ? 'Desarquivar' : 'Arquivar'}
                      </button>
                    )}
                    {onDelete && (onMove || onClone || onToggleArchive) && (
                      <div style={{ height: 1, background: 'var(--eh-border)', margin: '2px 6px' }} />
                    )}
                    {onDelete && (
                      <button
                        data-card-menu=""
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete()
                          setCardMenuOpen(false)
                        }}
                        style={{ ...mainMenuBtnStyle, color: 'var(--eh-danger)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-bg)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14H6L5 6"/>
                          <path d="M10 11v6"/>
                          <path d="M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                        Excluir Tarefa
                      </button>
                    )}
                  </>
                )}
              </div>,
              document.body,
            )}
          </div>
        )}
      </div>

      {/* Chip "Arquivada" — texto, não só opacidade, para ser perceptível
          independente de baixa visão. */}
      {task.archived && (
        <div style={{ marginTop: 6 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: 20,
              fontSize: 10.5,
              fontWeight: 600,
              lineHeight: 1.5,
              background: 'var(--eh-label-neutral-bg)',
              color: 'var(--eh-label-neutral-fg)',
            }}
          >
            Arquivada
          </span>
        </div>
      )}

      {/* etiquetas — ausente/undefined em Marketing/Administrativo hoje.
          Na Pedagogia a barra já foi renderizada no topo do card (variant="solid"),
          então este chip pastel não duplica lá. */}
      {!isPedagogia && <LabelChips labelIds={task.labels} labelsById={resolvedLabelsById} />}

      {/* checklist badge — stopPropagation apenas nos elementos interativos individuais */}
      {hasChecklist && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setChecklistOpen((v) => !v) }}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: checkComplete ? 'var(--eh-success-fg)' : 'var(--eh-text-3)',
              background: checkComplete ? '#dcfce7' : 'var(--eh-bg)',
              padding: '2px 8px',
              borderRadius: 20,
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            {checklistOpen ? '▼' : '▶'} ✓ {checkDone}/{checkTotal}
          </button>

          {checklistOpen && localChecklist.length > 0 && (
            <div
              style={{
                marginTop: 6,
                borderTop: '1px solid var(--eh-border)',
                paddingTop: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {localChecklist.map((item) => {
                const currentStatus = resolveStatus(item)
                const meta = CHECKLIST_STATUS_META[currentStatus]
                const isDropdownOpen = openDropdownId === item.id

                return (
                  <div
                    key={item.id}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 5, position: 'relative' }}
                    data-checklist-dropdown=""
                  >
                    {/* badge de status — abre dropdown */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!readOnly) setOpenDropdownId(isDropdownOpen ? null : item.id)
                      }}
                      disabled={readOnly}
                      title={readOnly ? 'Somente leitura — perfil Viewer' : undefined}
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 600,
                        color: meta.fg,
                        background: meta.bg,
                        padding: '2px 6px',
                        borderRadius: 20,
                        border: 'none',
                        cursor: readOnly ? 'default' : 'pointer',
                        lineHeight: 1.5,
                        whiteSpace: 'nowrap',
                        marginTop: 1,
                        opacity: readOnly ? 0.75 : 1,
                      }}
                    >
                      {meta.label}
                    </button>

                    <span
                      style={{
                        fontSize: 11,
                        color: currentStatus === 'finalizado' ? 'var(--eh-text-3)' : 'var(--eh-text-2)',
                        textDecoration: currentStatus === 'finalizado' ? 'line-through' : 'none',
                        lineHeight: 1.4,
                      }}
                    >
                      {item.title}
                    </span>

                    {/* dropdown de seleção de status */}
                    {isDropdownOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          zIndex: 50,
                          background: 'var(--eh-surface)',
                          border: '1px solid var(--eh-border)',
                          borderRadius: 8,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                          padding: '4px',
                          minWidth: 120,
                          marginTop: 2,
                        }}
                        data-checklist-dropdown=""
                      >
                        {STATUS_ORDER.map((s) => {
                          const m = CHECKLIST_STATUS_META[s]
                          const isActive = currentStatus === s
                          return (
                            <button
                              key={s}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleStatusChange(item.id, s)
                                setOpenDropdownId(null)
                              }}
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                fontSize: 11,
                                fontWeight: isActive ? 700 : 500,
                                color: m.fg,
                                background: isActive ? m.bg : 'transparent',
                                padding: '4px 8px',
                                borderRadius: 5,
                                border: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              {m.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* recurrence badge */}
      {task.recurrence && (
        <div style={{ marginTop: hasChecklist ? 4 : 8 }}>
          <span
            style={{
              fontSize: 10.5,
              color: '#7c3aed',
              background: '#ede9fe',
              padding: '2px 7px',
              borderRadius: 20,
              fontWeight: 600,
            }}
          >
            ↻{' '}
            {task.recurrence.pattern === 'daily'
              ? 'Diária'
              : task.recurrence.pattern === 'weekly'
                ? 'Semanal'
                : task.recurrence.pattern === 'monthly'
                  ? 'Mensal'
                  : task.recurrence.pattern === 'custom-days'
                    ? 'Dias da semana'
                    : 'Dias úteis'}
          </span>
        </div>
      )}

      {/* footer */}
      <div
        style={{
          marginTop: isPedagogia ? 8 : 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
          {/* status dot — era de prioridade (campo removido: "se alguém
              quiser destacar, faça pela etiqueta"); passou a refletir o
              status da tarefa, com as mesmas 4 cores do chip do modal e do
              submenu "⋯" deste card. */}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              flexShrink: 0,
              background: STATUS_DOT[task.status] ?? 'var(--eh-muted-2)',
            }}
            title={CARD_STATUS_LABEL[task.status] ?? task.status}
          />
          {dueDate && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: isOverdue ? 'var(--eh-danger)' : 'var(--eh-text-2)',
                background: isOverdue ? 'var(--eh-danger-hover)' : 'transparent',
                padding: isOverdue ? '1px 5px' : 0,
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              {fmtDate(dueDate)}
            </span>
          )}
          {/* Contador de anexos — usa `task.attachments`, que já vem carregado
              junto com a task, sem trabalho extra por card (uma coluna pode ter
              centenas). Restrito a `isPedagogia` porque a UI de upload/anexo só
              existe lá; as demais áreas nunca gravam `attachments`, e a
              condição garante isso por construção. */}
          {isPedagogia && (task.attachments?.length ?? 0) > 0 && (
            <span
              title={`${task.attachments!.length} anexo(s)`}
              aria-label={`${task.attachments!.length} anexo(s)`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--eh-text-3)',
                flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              {task.attachments!.length}
            </span>
          )}
          {/* Contador de comentários — usa `task.commentCount` (campo
              DESNORMALIZADO, incrementado/decrementado por
              `addTaskComment`/`deleteTaskComment` em commentsApi.ts), nunca
              carregando a thread por card: mesmo raciocínio do contador de
              anexos acima. Restrito a `isPedagogia` pelo mesmo motivo. */}
          {isPedagogia && (task.commentCount ?? 0) > 0 && (
            <span
              title={`${task.commentCount} comentário(s)`}
              aria-label={`${task.commentCount} comentário(s)`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--eh-text-3)',
                flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {task.commentCount}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {names.length > 0 && (
            // `stopPropagation` no pointerdown ALÉM do click: os listeners de
            // arrasto do dnd-kit ficam no container do card, então sem isso o
            // gesto de arrasto começaria a partir do avatar e engoliria o
            // clique que abre o popover de perfil.
            <div
              onClick={(e) => e.stopPropagation()}
              onPointerDown={overlay ? undefined : (e) => e.stopPropagation()}
              style={{ display: 'contents' }}
            >
              <AssigneeAvatars
                names={names}
                photoURLs={users ? names.map((name) => findPhotoByName(name, users)) : undefined}
                max={3}
                size={isPedagogia ? 24 : 22}
                // No clone do `DragOverlay` os avatares seguem decorativos: o
                // popover pertence ao card real, não à cópia que acompanha o
                // cursor durante o arrasto.
                onAvatarClick={
                  overlay
                    ? undefined
                    : (index, anchor) => {
                        document.dispatchEvent(
                          new CustomEvent(PROFILE_POPOVER_EVENT, { detail: task.id }),
                        )
                        setProfilePopover((prev) => (prev?.index === index ? null : { index, anchor }))
                      }
                }
              />
            </div>
          )}
        </div>
        {profilePopover && names[profilePopover.index] && (
          <UserProfilePopover
            anchorRef={{ current: profilePopover.anchor }}
            open
            onClose={() => setProfilePopover(null)}
            name={names[profilePopover.index]}
            email={users ? findEmailByName(names[profilePopover.index], users) : undefined}
            photoURL={users ? findPhotoByName(names[profilePopover.index], users) : undefined}
          />
        )}
      </div>
    </div>
  )
})
