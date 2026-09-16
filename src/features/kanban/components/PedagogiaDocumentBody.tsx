import { useEffect, useRef, useState } from 'react'
import type { ChecklistItem, PMOfficeLabel, PMTask, RecurrenceConfig } from '../types/pmOffice'
import type { UserRecord } from '../api/usersApi'
import type { PMTaskPatch } from '../api/pmOfficeApi'
import { applyTemplateToTaskChecklist, createPMOfficeLabel, setPMTaskLabel, updatePMOfficeLabel } from '../api/marketingPlannerApi'
import type { MarketingTaskTemplate } from '../types/pmOffice'
import { buildUnnamedLabelDisplayName, type KnownColorKey } from '../utils/labelColors'
import { UserAvatar } from '@/components/UserAvatar/UserAvatar'
import { InlineEditableText } from './InlineEditableText'
import { LabelChips } from './LabelChips'
import { LabelPickerPopover } from './LabelPickerPopover'
import { MemberProfilePopover } from './MemberProfilePopover'
import { ActionPill, ModalDatePicker, AssigneeSelect, dateToTs } from './TaskDetailModal'
import { RecurrenceControl } from './RecurrenceControl'
import { TaskAttachments } from './TaskAttachments'
import { ChecklistSection } from './ChecklistSection'
import { useMediaQuery } from '@/hooks/useMediaQuery'

type ChecklistStatus = NonNullable<ChecklistItem['status']>

/** Resolve a foto do usuário por nome exato (case-insensitive), só quando único. */
function findPhotoByName(name: string, users: UserRecord[]): string | undefined {
  const target = name.trim().toLowerCase()
  const matches = users.filter((u) => u.name.trim().toLowerCase() === target)
  return matches.length === 1 ? matches[0].photoURL : undefined
}

/** Resolve o e-mail do usuário por nome exato (case-insensitive), só quando único — mesma regra de `findPhotoByName`. */
function findEmailByName(name: string, users: UserRecord[]): string | undefined {
  const target = name.trim().toLowerCase()
  const matches = users.filter((u) => u.name.trim().toLowerCase() === target)
  return matches.length === 1 ? matches[0].email : undefined
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
]

/**
 * Corpo do modal em modo "documento" (ELO-3182) — exclusivo da área
 * Pedagogia, só quando `isEditable`. Substitui o formulário clássico
 * (rótulos "Título"/"Status"/"Prioridade", barra Cancelar/Salvar) por um
 * layout sem cara de formulário: texto que vira campo ao clicar, salva no
 * blur/Enter, sem botão Salvar — como o Trello real.
 *
 * Ordem (medida na captura real, confirmada pelo Marcos): chip → título →
 * PÍLULAS DE AÇÃO → Membros/Etiquetas → Descrição. O título e o chip ficam
 * no cabeçalho do modal (`TaskDetailModal.tsx`), fora deste componente —
 * aqui começa a partir das pílulas.
 *
 * Risco de "salvar no blur sem botão Salvar" (levantado explicitamente pelo
 * Marcos) — três garantias, todas em `InlineEditableText`/`saveField`:
 * (a) só grava se o valor mudou de fato (comparação trim() a trim());
 * (b) erro de gravação aparece pro usuário (banner vermelho inline, não só
 *     `console.error`) e o campo volta pra edição com o texto não perdido;
 * (c) fechar o modal (✕) não passa por aqui — cada campo já gravou (ou não
 *     mudou) no seu próprio blur, não existe estado "pendente" acumulado
 *     esperando um Salvar final que o fechamento poderia descartar.
 */
export function PedagogiaDocumentBody({
  task,
  users,
  labels,
  labelsById,
  startDate,
  dueDate,
  priority,
  recurrenceEnabled,
  recurrencePattern,
  recurrenceInterval,
  recurrenceDays,
  onDatesChange,
  onPriorityChange,
  onRecurrenceChange,
  assignees,
  assigneesNames,
  onAssigneesChange,
  observacoes,
  onSaveField,
  scrollContainer,
  isEditable,
  onToggleChecklistItem,
  onUpdateChecklistItemStatus,
  onAddChecklistItem,
  onRenameChecklistItem,
  onDeleteChecklistItem,
  bucketName,
}: {
  task: PMTask
  users: UserRecord[]
  labels: PMOfficeLabel[]
  labelsById: Map<string, PMOfficeLabel>
  startDate: Date | null
  dueDate: Date | null
  priority: string
  recurrenceEnabled: boolean
  recurrencePattern: RecurrenceConfig['pattern']
  recurrenceInterval: number
  recurrenceDays: number[]
  onDatesChange: (start: Date | null, due: Date | null) => void
  onPriorityChange: (priority: string) => void
  onRecurrenceChange: (enabled: boolean, pattern: RecurrenceConfig['pattern'], interval: number, days: number[]) => void
  assignees: string[]
  assigneesNames: string[]
  onAssigneesChange: (uids: string[], names: string[]) => void
  observacoes: string
  onSaveField: (patch: PMTaskPatch) => Promise<void>
  scrollContainer: HTMLElement | null
  /** ELO-3184: Viewer (`!isEditable`) vê e abre anexos, mas não sobe nem exclui. */
  isEditable: boolean
  /** Subtarefas (checklist) — ELO-3199. Mesmos callbacks já fiados na página do quadro para o modo formulário clássico; o modo documento não os tinha até aqui. */
  onToggleChecklistItem?: (itemId: string, checked: boolean) => Promise<void>
  onUpdateChecklistItemStatus?: (itemId: string, status: ChecklistStatus) => Promise<void>
  onAddChecklistItem?: (title: string) => Promise<void>
  onRenameChecklistItem?: (itemId: string, newTitle: string) => Promise<void>
  onDeleteChecklistItem?: (itemId: string) => Promise<void>
  /** ELO-3201: nome da coluna atual da tarefa — usado pra filtrar quais templates de checklist aparecem em "Aplicar template". */
  bucketName?: string
}) {
  const [showDates, setShowDates] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [labelPickerOpen, setLabelPickerOpen] = useState(false)
  const [showExtras, setShowExtras] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(null)
  const labelBtnRef = useRef<HTMLButtonElement>(null)
  // Popover de perfil ao clicar num avatar de membro (ELO-3182/ELO-3183) —
  // guarda o índice do avatar clicado (mesmo array `assignees`/`assigneesNames`,
  // não precisa duplicar dado) e sua própria ref de âncora para posicionar.
  const [profilePopoverIndex, setProfilePopoverIndex] = useState<number | null>(null)
  const memberBtnRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  // Anexos e Checklist são seções FIXAS (sempre visíveis, abaixo de
  // Descrição) — a pílula não alterna visibilidade como Datas/Membros, só
  // rola até lá (mesmo padrão do comentário de `ActionPill` em
  // TaskDetailModal.tsx: "Só para seções que JÁ existem no corpo (rola até
  // lá)"). Rolar sozinho não bastava (achado do Marcos: "deve aparecer para
  // adicionar o checklist e o anexo quando clicar nesses botões, se não eles
  // ficam apenas como visual") — quando a seção já está visível na tela
  // (comum em tarefa sem nada ainda), rolar não produz efeito perceptível
  // nenhum. Os contadores abaixo acionam a AÇÃO em si (focar o campo/abrir o
  // seletor de arquivo), não só a rolagem.
  const attachmentsRef = useRef<HTMLDivElement>(null)
  const checklistRef = useRef<HTMLDivElement>(null)
  const [openAttachmentPicker, setOpenAttachmentPicker] = useState(0)
  const [focusChecklistInput, setFocusChecklistInput] = useState(0)
  // Responsivo (ELO-3182): grids de 2 colunas (Datas, Membros/Etiquetas)
  // viram 1 coluna em ~390px — mesmo breakpoint do resto do PM Office.
  const isMobile = useMediaQuery('(max-width: 640px)')

  // Datas/Membros abertos por clique na pílula ficam visíveis até fechar de
  // novo — não são popovers com blur-fecha, porque os campos de dentro
  // (date picker, busca de usuário) já têm o próprio fechamento.
  useEffect(() => { setShowDates(false); setShowMembers(false) }, [task.id])

  const currentLabels = task.labels ?? []
  const attachments = task.attachments ?? []
  const checklist = task.checklist ?? []

  async function handleToggleLabel(labelId: string, checked: boolean) {
    setLabelError(null)
    try {
      const next = await setPMTaskLabel(task.projectId, task.bucketId, task.id, currentLabels, labelId, checked)
      await onSaveField({ labels: next })
    } catch (err) {
      console.error('[PedagogiaDocumentBody] falha ao (des)associar etiqueta', err)
      setLabelError('Não foi possível salvar a etiqueta. Tente novamente.')
      throw err
    }
  }

  async function handleCreateLabel(name: string, color: KnownColorKey | null) {
    // `order`: MAIOR order existente + 1, não `labels.length`. `length`
    // colide se algum label já foi excluído no meio (ex.: orders 0,1,3 após
    // apagar o de order 2 — `length` seria 3, MESMO order do que já existe).
    // Max+1 sempre cai depois de tudo, independente de buracos na sequência.
    const maxOrder = labels.reduce((max, l) => Math.max(max, l.order), -1)
    // Sem nome: mesmo padrão gramatical/contador do import
    // ("Sem nome #N (cor)", sequência GLOBAL) — ver buildUnnamedLabelDisplayName.
    const displayName = name || buildUnnamedLabelDisplayName(labels.map((l) => l.displayName), color)
    await createPMOfficeLabel(task.projectId, {
      name: null,
      displayName,
      trelloColor: color,
      order: maxOrder + 1,
    })
  }

  async function handleEditLabel(labelId: string, name: string, color: KnownColorKey | null) {
    const displayName = name || buildUnnamedLabelDisplayName(
      labels.filter((l) => l.id !== labelId).map((l) => l.displayName),
      color,
    )
    await updatePMOfficeLabel(task.projectId, labelId, {
      displayName,
      trelloColor: color,
    })
  }

  return (
    // ELO-3182 (refino, pedido do Marcos: "há mais respiro vertical entre as
    // seções [no Trello]... hoje está apertado") — era space-y-4 (16px);
    // space-y-6 (24px) dá mais ar entre pílulas → Membros/Etiquetas →
    // Descrição → Anexos, sem mudar a ORDEM nem remover nenhuma seção.
    <div className="space-y-6">
      {/* Pílulas de ação — Datas, Membros, Anexos e Checklist abrem o editor
          correspondente inline (mesma linha, sem popover separado). Checklist
          (ELO-3199) só aparece quando a tarefa já tem alguma subtarefa OU
          quem edita pode criar a primeira — uma pílula que abre uma seção
          vazia sem permissão de criar seria "controle sem função". "+
          Adicionar" genérico continua de fora. */}
      <div className="flex flex-wrap gap-2">
        <ActionPill
          label="Datas"
          onClick={() => setShowDates((v) => !v)}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          }
        />
        <ActionPill
          label="Membros"
          onClick={() => setShowMembers((v) => !v)}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
        />
        <ActionPill
          label={attachments.length > 0 ? `Anexo (${attachments.length})` : 'Anexo'}
          onClick={() => {
            attachmentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            if (isEditable) setOpenAttachmentPicker((n) => n + 1)
          }}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          }
        />
        {(checklist.length > 0 || (isEditable && onAddChecklistItem)) && (
          <ActionPill
            label={checklist.length > 0 ? `Checklist (${checklist.filter((i) => (i.status ?? (i.isChecked ? 'finalizado' : 'aguardando')) === 'finalizado').length}/${checklist.length})` : 'Checklist'}
            onClick={() => {
              checklistRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              if (isEditable) setFocusChecklistInput((n) => n + 1)
            }}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            }
          />
        )}
        {/* Prioridade e Repetir continuam existindo (decisão do Marcos: não
            remover) mas não aparecem soltos como campo de formulário no meio
            do documento — ficam atrás desta pílula "Mais opções". */}
        <ActionPill
          label="Mais opções"
          onClick={() => setShowExtras((v) => !v)}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
            </svg>
          }
        />
      </div>

      {showDates && (
        <div className={isMobile ? 'grid grid-cols-1 gap-4 p-3 rounded-md' : 'grid grid-cols-2 gap-4 p-3 rounded-md'} style={{ background: 'var(--eh-pm-neutral-surface)' }}>
          <ModalDatePicker label="Início" value={startDate} onChange={(d) => { onDatesChange(d, dueDate); void onSaveField({ startDate: dateToTs(d) }) }} scrollContainer={scrollContainer} disabledAfter={dueDate ?? undefined} />
          <ModalDatePicker label="Término" value={dueDate} onChange={(d) => { onDatesChange(startDate, d); void onSaveField({ dueDate: dateToTs(d) }) }} scrollContainer={scrollContainer} disabledBefore={startDate ?? undefined} />
        </div>
      )}

      {showMembers && (
        <div className="p-3 rounded-md" style={{ background: 'var(--eh-pm-neutral-surface)' }}>
          <AssigneeSelect
            users={users}
            assignees={assignees}
            assigneesNames={assigneesNames}
            onChange={(uids, names) => {
              onAssigneesChange(uids, names)
              void onSaveField({ assignees: uids, assigneesNames: names })
            }}
          />
        </div>
      )}

      {showExtras && (
        <div className="p-3 rounded-md space-y-3" style={{ background: 'var(--eh-pm-neutral-surface)' }}>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>Prioridade</label>
            <select
              value={priority}
              onChange={(e) => { onPriorityChange(e.target.value); void onSaveField({ priority: e.target.value }) }}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>Repetir esta tarefa</label>
            {/* Recorrência grava IMEDIATAMENTE a cada mudança — `onRecurrenceChange`
                (prop deste componente) já dispara `saveRecurrence` no
                `TaskDetailModal` pai a cada chamada, não só atualiza estado
                local. Precisa ser assim: sem barra Cancelar/Salvar no modo
                documento, não existe mais um momento "final" para gravar —
                achado ao implementar (a versão anterior deste comentário
                dizia "salva ao fechar o modal", que ficou falso assim que o
                rodapé foi removido; corrigido gravando no próprio onChange,
                ver `saveRecurrence` em TaskDetailModal.tsx). Grava até no
                input numérico de intervalo a cada tecla — mais escritas do
                que o ideal, mas nunca perde o valor. */}
            <RecurrenceControl
              enabled={recurrenceEnabled}
              onEnabledChange={(v) => onRecurrenceChange(v, recurrencePattern, recurrenceInterval, recurrenceDays)}
              pattern={recurrencePattern}
              onPatternChange={(v) => onRecurrenceChange(recurrenceEnabled, v, recurrenceInterval, recurrenceDays)}
              interval={recurrenceInterval}
              onIntervalChange={(v) => onRecurrenceChange(recurrenceEnabled, recurrencePattern, v, recurrenceDays)}
              days={recurrenceDays}
              onDaysChange={(v) => onRecurrenceChange(recurrenceEnabled, recurrencePattern, recurrenceInterval, v)}
            />
          </div>
        </div>
      )}

      {/* Membros/Etiquetas lado a lado — DEPOIS das pílulas de ação (ordem
          corrigida: a captura real do Trello mostra chip → título → pílulas
          → Membros/Etiquetas → Descrição; a versão anterior tinha essa
          seção ANTES das pílulas). */}
      <div className={isMobile ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-2 gap-4'}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
            Membros
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {assigneesNames.map((name, i) => (
              <button
                key={assignees[i] ?? `name-${i}`}
                ref={(el) => { memberBtnRefs.current[i] = el }}
                type="button"
                onClick={() => setProfilePopoverIndex((v) => (v === i ? null : i))}
                title={name}
                aria-label={`Ver perfil de ${name}`}
                aria-haspopup="dialog"
                aria-expanded={profilePopoverIndex === i}
                style={{ padding: 0, border: 'none', background: 'transparent', borderRadius: '50%', cursor: 'pointer', lineHeight: 0 }}
              >
                <UserAvatar name={name} photoURL={findPhotoByName(name, users)} size={32} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowMembers((v) => !v)}
              title="Adicionar ou remover membros"
              aria-label="Adicionar ou remover membros"
              aria-expanded={showMembers}
              className="inline-flex items-center justify-center transition-colors"
              style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--eh-pm-neutral-surface)', color: 'var(--eh-pm-modal-text)', border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 600 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-border)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--eh-pm-neutral-surface)' }}
            >
              +
            </button>
            {profilePopoverIndex !== null && assigneesNames[profilePopoverIndex] && (
              <MemberProfilePopover
                anchorRef={{ current: memberBtnRefs.current[profilePopoverIndex] ?? null }}
                open
                onClose={() => setProfilePopoverIndex(null)}
                name={assigneesNames[profilePopoverIndex]}
                email={findEmailByName(assigneesNames[profilePopoverIndex], users)}
                photoURL={findPhotoByName(assigneesNames[profilePopoverIndex], users)}
                onRemove={
                  isEditable
                    ? () => {
                        const i = profilePopoverIndex
                        onAssigneesChange(
                          assignees.filter((_, j) => j !== i),
                          assigneesNames.filter((_, j) => j !== i),
                        )
                      }
                    : undefined
                }
              />
            )}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
            Etiquetas
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* A própria etiqueta abre o seletor (pedido do Marcos: "ao clicar
                em cima dela, já abria, sem precisar clicar no +"). É também o
                comportamento do Trello. O `+` continua existindo para quando
                não há nenhuma etiqueta ainda — aí não haveria no que clicar. */}
            {currentLabels.length > 0 && (
              <button
                type="button"
                onClick={() => setLabelPickerOpen((v) => !v)}
                title="Editar etiquetas"
                aria-label="Editar etiquetas"
                aria-haspopup="dialog"
                aria-expanded={labelPickerOpen}
                className="inline-flex flex-wrap items-center gap-1.5"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
              >
                <LabelChips labelIds={currentLabels} labelsById={labelsById} variant="solid-pill" />
              </button>
            )}
            <button
              ref={labelBtnRef}
              type="button"
              onClick={() => setLabelPickerOpen((v) => !v)}
              title="Adicionar ou remover etiquetas"
              aria-label="Adicionar ou remover etiquetas"
              aria-haspopup="dialog"
              aria-expanded={labelPickerOpen}
              className="inline-flex items-center justify-center transition-colors"
              style={{ width: 24, height: 24, borderRadius: 4, background: 'var(--eh-pm-neutral-surface)', color: 'var(--eh-pm-modal-text)', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-border)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--eh-pm-neutral-surface)' }}
            >
              +
            </button>
          </div>
          {labelError && (
            <p role="alert" className="text-xs mt-1" style={{ color: 'var(--eh-danger)' }}>{labelError}</p>
          )}
          <LabelPickerPopover
            anchorRef={labelBtnRef}
            open={labelPickerOpen}
            onClose={() => setLabelPickerOpen(false)}
            labels={labels}
            selectedIds={currentLabels}
            onToggleLabel={handleToggleLabel}
            onCreateLabel={handleCreateLabel}
            onEditLabel={handleEditLabel}
          />
        </div>
      </div>

      {/* Descrição — modo documento: texto puro (ou placeholder) fora da
          edição, clicar abre textarea inline, blur/Ctrl+Enter salva.
          `maxWidth: 760` pelo mesmo motivo do título em TaskDetailModal.tsx:
          o modal ficou largo (1075px) a pedido do Marcos, mas um parágrafo
          esticando quase a largura toda vira difícil de ler — limitando só
          este bloco de texto, não o corpo inteiro (pílulas/Membros/
          Etiquetas continuam usando a largura completa). */}
      <div style={{ maxWidth: 760 }}>
        <p className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="14" y2="18" />
          </svg>
          Descrição
        </p>
        {/* ELO-3182 (refino, pedido do Marcos: "Descrição tem um bloquinho...
            o nosso é discreto demais, quase invisível até clicar"). `boxed`
            dá fundo+borda já em repouso (ver InlineEditableText.tsx).
            `minHeight` 72 (era 60) — medido em trello-3-modal.png: a caixa
            de Descrição do Trello mede ~90px de altura TOTAL na captura
            (bordas incluídas); 72px de MIOLO + padding do `boxed` (10px
            topo/base) fecha bem próximo desse total, dentro da faixa
            "60-80px" pedida. */}
        <InlineEditableText
          value={observacoes}
          onSave={(next) => onSaveField({ observacoes: next || null })}
          placeholder="Adicione uma descrição mais detalhada…"
          multiline
          ariaLabel="descrição da tarefa"
          fontSize={14}
          minHeight={72}
          boxed
        />
      </div>

      {/* Checklist (ELO-3199) — seção fixa abaixo de Descrição, mesmo padrão
          de Anexos (sempre visível quando há conteúdo ou permissão de criar;
          a pílula rola até aqui em vez de abrir/fechar). Estava faltando no
          modo documento: já existia no formulário clássico
          (`task.source === 'graph'`), que a Pedagogia nunca usa — dava pra
          VER o resumo no card, mas não mexer de dentro do modal. */}
      {(checklist.length > 0 || (isEditable && onAddChecklistItem)) && (
        <div ref={checklistRef}>
          <ChecklistSection
            items={checklist}
            isEditable={isEditable}
            onToggleItem={onToggleChecklistItem}
            onUpdateItemStatus={onUpdateChecklistItemStatus}
            onAddItem={onAddChecklistItem}
            onRenameItem={onRenameChecklistItem}
            onDeleteItem={onDeleteChecklistItem}
            focusInputSignal={focusChecklistInput}
            area="pedagogia"
            bucketName={bucketName}
            onApplyTemplate={
              bucketName
                ? (tpl: MarketingTaskTemplate) =>
                    applyTemplateToTaskChecklist(task.projectId, task.bucketId, task.id, tpl, checklist)
                : undefined
            }
          />
        </div>
      )}

      {/* Anexos (ELO-3184 Fase 1) — seção fixa abaixo de Descrição, sempre
          visível (diferente de Datas/Membros, que só aparecem ao clicar na
          pílula). A pílula "Anexo" rola até aqui em vez de abrir/fechar. */}
      <div ref={attachmentsRef}>
        <TaskAttachments
          taskId={task.id}
          attachments={attachments}
          isEditable={isEditable}
          onSaveField={onSaveField}
          openPickerSignal={openAttachmentPicker}
        />
      </div>
    </div>
  )
}
