import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PMOfficeLabel } from '../types/pmOffice'
import { COLOR_KEY_LABEL_PT, CREATABLE_LABEL_COLORS, labelSolidColorTokens, normalizeLabelColorKey, type KnownColorKey } from '../utils/labelColors'
import { useMediaQuery } from '@/hooks/useMediaQuery'

/**
 * Popover de seleção/edição de etiquetas (ELO-3182) — ancorado no botão `+`
 * ao lado de "Etiquetas" no modal de detalhe, área Pedagogia. Marcar/
 * desmarcar associa/desassocia a etiqueta na tarefa (grava via
 * `onToggleLabel`, que por sua vez chama `setPMTaskLabel`); "Criar uma nova
 * etiqueta" e o lápis (renomear) usam o CRUD que já existe em
 * `marketingPlannerApi.ts` (`createPMOfficeLabel`/`updatePMOfficeLabel`) —
 * só faltava a associação em si, que é o que este componente resolve.
 *
 * Acessibilidade (mesmo padrão de `PlannerBucketTree.tsx`/
 * `LabelFilterDropdown.tsx`, já aprovado pelo gate ux-ui-reviewer):
 * `role="dialog"` + `aria-label`, `aria-haspopup`/`aria-expanded` no botão
 * que abre, Escape fecha e devolve foco ao botão, `createPortal` pro body
 * (o modal pai tem `overflow-hidden`, cortaria o popover).
 *
 * Fora de escopo por decisão do Marcos: "Mostrar mais etiquetas"
 * (paginação — sem volume que justifique) e "Habilitar modo daltonismo"
 * (o nosso já mostra nome sempre, decisão do gate de UX na ELO-3182).
 */
export function LabelPickerPopover({
  anchorRef,
  open,
  onClose,
  labels,
  selectedIds,
  onToggleLabel,
  onCreateLabel,
  onEditLabel,
}: {
  anchorRef: { current: HTMLElement | null }
  open: boolean
  onClose: () => void
  labels: PMOfficeLabel[]
  selectedIds: string[]
  onToggleLabel: (labelId: string, checked: boolean) => Promise<void>
  /** Cria uma etiqueta nova — `color` é a chave conhecida (`'green'`...) ou `null` (sem cor, mesmo fallback neutro do resto do app). */
  onCreateLabel: (name: string, color: KnownColorKey | null) => Promise<void>
  /** Edita nome E cor de uma etiqueta existente numa escrita só (reaproveita a mesma vista de criação — pedido do Marcos, "se sair barato"). */
  onEditLabel: (labelId: string, name: string, color: KnownColorKey | null) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  // `maxH`: altura máxima calculada a partir do espaço real disponível na
  // janela — sem isso o popover estourava a borda inferior e cortava a lista.
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null)
  // Vista "Criar Etiqueta" do Trello (ELO-3182) reaproveitada pra criar E
  // editar (mesmo formulário: nome + cor) — `editorTarget: null` = criando
  // nova, `editorTarget: labelId` = editando a etiqueta com esse id. Uma
  // segunda vista DENTRO do mesmo popover (não um popover novo), com `‹`
  // voltando pra lista — como no Trello.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTarget, setEditorTarget] = useState<string | null>(null)
  const [editorName, setEditorName] = useState('')
  const [editorColor, setEditorColor] = useState<KnownColorKey | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const editorNameRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  // Responsivo (ELO-3182): em telas estreitas (~390px) o popover ancorado no
  // botão + 320px fixos deixaria pouquíssima margem. Em vez disso, no
  // mobile ele vira um "modal" centralizado na tela (mesmo componente,
  // largura fluida `calc(100vw - 24px)`, posição fixa central) — mesmo
  // padrão de "popover vira modal no celular" já usado noutros pickers
  // deste app quando o espaço não fecha a conta.
  const isMobile = useMediaQuery('(max-width: 640px)')
  // 360 no desktop (não 320): os nomes reais deste quadro são longos
  // ("REUNIÃO ALINHAMENTO MUNICÍPIOS") e, com checkbox + lápis ocupando as
  // laterais, 320 espremia a barra a ponto de cortar o nome.
  const POPOVER_W = isMobile ? Math.min(360, window.innerWidth - 24) : 360

  // `recalcTick` força recalcular a posição quando a janela muda de tamanho ou
  // a página rola com o popover aberto — senão ele fica "solto" no lugar antigo
  // (é `position: fixed`, não acompanha o âncora sozinho).
  const [recalcTick, setRecalcTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const onChange = () => setRecalcTick((t) => t + 1)
    window.addEventListener('resize', onChange)
    // `capture: true` pega scroll de containers internos (o corpo do modal
    // rola), não só o da janela.
    window.addEventListener('scroll', onChange, true)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    if (isMobile) {
      // Centralizado na tela — sem depender do retângulo do botão, que pode
      // estar perto da borda e não deixar espaço pro popover de qualquer jeito.
      const alturaMobile = Math.min(420, window.innerHeight - 32)
      setPos({
        top: Math.max(16, (window.innerHeight - alturaMobile) / 2),
        left: (window.innerWidth - POPOVER_W) / 2,
        maxH: alturaMobile,
      })
      return
    }
    const btn = anchorRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const GAP = 6
    // Margem mínima até a borda da janela. O viewport do browser NÃO inclui a
    // barra de tarefas do sistema, mas encostar no limite deixa o popover
    // visualmente "colado" nela — daí a folga.
    const EDGE = 12

    // Alinhado à esquerda do botão, puxado pra dentro se estourar a direita —
    // mesma técnica de PlannerBucketTree.tsx.
    const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - POPOVER_W - GAP))

    // Posicionamento vertical: abrir pra baixo cegamente cortava a lista e o
    // botão "Criar uma nova etiqueta" quando o botão-âncora ficava na metade
    // de baixo da tela. Agora escolhe o lado com mais espaço e limita a altura
    // ao que realmente cabe (o `maxHeight` do elemento usa este valor).
    const espacoAbaixo = window.innerHeight - rect.bottom - GAP - EDGE
    const espacoAcima = rect.top - GAP - EDGE
    const abrirParaCima = espacoAbaixo < 260 && espacoAcima > espacoAbaixo

    const disponivel = Math.max(200, abrirParaCima ? espacoAcima : espacoAbaixo)
    const altura = Math.min(420, disponivel)
    const top = abrirParaCima ? rect.top - GAP - altura : rect.bottom + GAP

    setPos({ top, left, maxH: altura })
  }, [open, anchorRef, isMobile, POPOVER_W, recalcTick])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    setQuery('')
    setEditorOpen(false)
    setEditorTarget(null)
    setEditorName('')
    setEditorColor(null)
    setActionError(null)
  }, [open])

  // Foca o campo "Título" ao entrar na vista de criar/editar — mesmo padrão
  // de foco automático do restante do popover. Ao VOLTAR pra lista (`‹`),
  // o botão de voltar desmonta e o foco cairia em `document.body` sem
  // gerenciamento explícito — foca a busca (primeiro elemento focável da
  // lista) em vez de deixar o foco "se perder" fora do popover.
  useEffect(() => {
    // `searchRef.current` é `null` no primeiro render (antes de `open`
    // virar true e o popover montar) — `.focus()` em `null` via optional
    // chaining é um no-op seguro, não precisa de guarda extra de `open`.
    if (editorOpen) {
      editorNameRef.current?.focus()
    } else {
      searchRef.current?.focus()
    }
  }, [editorOpen])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onClose, anchorRef])

  function closeAndRestoreFocus() {
    onClose()
    anchorRef.current?.focus()
  }

  if (!open || !pos) return null

  const visibleLabels = labels
    .filter((l) => !l.mergedInto)
    .filter((l) => !query.trim() || l.displayName.toLowerCase().includes(query.trim().toLowerCase()))

  async function handleToggle(labelId: string, checked: boolean) {
    setPendingId(labelId)
    setActionError(null)
    try {
      await onToggleLabel(labelId, checked)
    } catch (err) {
      console.error('[LabelPickerPopover] falha ao (des)associar etiqueta', err)
      setActionError('Não foi possível salvar. Tente novamente.')
    } finally {
      setPendingId(null)
    }
  }

/** Abre a vista de criação — nome vazio, sem cor selecionada. */
  function openCreateEditor() {
    setEditorTarget(null)
    setEditorName('')
    setEditorColor(null)
    setActionError(null)
    setEditorOpen(true)
  }

  /** Abre a vista de edição pré-preenchida com nome/cor atuais da etiqueta. */
  function openEditEditor(label: PMOfficeLabel) {
    setEditorTarget(label.id)
    setEditorName(label.displayName)
    setEditorColor(normalizeLabelColorKey(label.trelloColor))
    setActionError(null)
    setEditorOpen(true)
  }

  /** `‹` — volta da vista de criar/editar pra lista, sem gravar nada. */
  function closeEditor() {
    setEditorOpen(false)
    setEditorTarget(null)
  }

  /**
   * Salva a vista de criar/editar — chama `onCreateLabel` ou `onEditLabel`
   * conforme `editorTarget`. Nome vazio é permitido (etiqueta sem nome, igual
   * às importadas do Trello sem nome original) — só a AÇÃO de salvar precisa
   * de uma cor OU nome pra fazer sentido; ver `canSaveEditor` no render.
   */
  async function handleSaveEditor() {
    const name = editorName.trim()
    setPendingId(editorTarget ?? '__create__')
    setActionError(null)
    try {
      if (editorTarget) {
        await onEditLabel(editorTarget, name, editorColor)
      } else {
        await onCreateLabel(name, editorColor)
      }
      setEditorOpen(false)
      setEditorTarget(null)
    } catch (err) {
      console.error('[LabelPickerPopover] falha ao salvar etiqueta', err)
      setActionError(editorTarget ? 'Não foi possível salvar. Tente novamente.' : 'Não foi possível criar a etiqueta. Tente novamente.')
    } finally {
      setPendingId(null)
    }
  }

  return createPortal(
    <>
      {/* Backdrop só no mobile — reforça a leitura de "virou modal" quando
          centralizado na tela, e dá mais uma forma de fechar por toque fora. */}
      {isMobile && (
        <div
          className="fixed inset-0 z-[199]"
          style={{ background: 'rgba(15,23,42,0.35)' }}
          onClick={closeAndRestoreFocus}
          aria-hidden="true"
        />
      )}
      <div
        ref={popRef}
        role="dialog"
        aria-labelledby={titleId}
        className="fixed z-[200] flex flex-col"
        style={{
          top: pos.top,
          left: pos.left,
          width: POPOVER_W,
          maxHeight: pos.maxH,
          background: 'var(--eh-surface)',
          border: '1px solid var(--eh-border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); closeAndRestoreFocus() }
        }}
      >
      {editorOpen ? (
        /* Vista "Criar Etiqueta" do Trello (ELO-3182), reaproveitada pra
           editar — `‹` volta pra lista sem gravar nada. */
        <>
          <div className="flex items-center justify-center relative p-3" style={{ borderBottom: '1px solid var(--eh-border)' }}>
            <button
              type="button"
              onClick={closeEditor}
              aria-label="Voltar para a lista de etiquetas"
              className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--eh-text-2)', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <p className="text-sm font-semibold" style={{ color: 'var(--eh-text-strong)' }}>
              {editorTarget ? 'Editar Etiqueta' : 'Criar Etiqueta'}
            </p>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              aria-label="Fechar seletor de etiquetas"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--eh-text-2)', cursor: 'pointer' }}
            >
              <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="10" y1="2" x2="2" y2="10" /><line x1="2" y1="2" x2="10" y2="10" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Pré-visualização — barra grande refletindo nome + cor em tempo
                real, mesmo resolver (`labelSolidColorTokens`) do resto do app. */}
            <div className="p-3 rounded-md" style={{ background: 'var(--eh-pm-neutral-surface)' }}>
              <div
                style={{
                  height: 40,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 12px',
                  fontSize: 13,
                  fontWeight: 700,
                  ...labelSolidColorTokens(editorColor),
                }}
              >
                {editorName.trim() || null}
              </div>
            </div>
            <div>
              {/* ELO-3182 (correção de contraste): rótulos de campo aqui
                  usavam --eh-text-2 (4,88:1 sobre --eh-surface branco) —
                  trocados pra --eh-pm-modal-text (14,34:1), mesmo padrão do
                  restante do modal ("MEMBROS"/"ETIQUETAS" etc.). */}
              <label htmlFor="pm-label-title" className="block text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
                Título
              </label>
              <input
                ref={editorNameRef}
                id="pm-label-title"
                type="text"
                value={editorName}
                onChange={(e) => setEditorName(e.target.value)}
                placeholder="Nome da etiqueta"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>Selecionar uma cor</p>
              {/* Grade de 8 cores (não 30, como o Trello) — exatamente as que
                  têm par --eh-label-*-solid-bg/-fg medido em contraste AA nos
                  dois temas (ver labelColors.ts). 4 por linha, `<button>`
                  reais (não `<div onClick>` — o gate de UX já reprovou isso
                  antes) navegáveis por Tab, foco visível via outline nativo.
                  aria-label com o nome da cor por extenso: cor não pode ser o
                  único identificador (WCAG 2.2 AA 1.4.1), mesmo numa grade de
                  amostras de cor pura. */}
              <div className="grid grid-cols-4 gap-2">
                {CREATABLE_LABEL_COLORS.map((colorKey) => {
                  const { bg, fg } = labelSolidColorTokens(colorKey)
                  const selected = editorColor === colorKey
                  return (
                    <button
                      key={colorKey}
                      type="button"
                      onClick={() => setEditorColor(colorKey)}
                      aria-label={COLOR_KEY_LABEL_PT[colorKey]}
                      aria-pressed={selected}
                      style={{
                        height: 32,
                        borderRadius: 4,
                        background: bg,
                        border: selected ? '2px solid var(--eh-text-strong)' : '2px solid transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {selected && (
                        // Contorno na cor `fg` do PRÓPRIO par (não branco fixo):
                        // `fg` já é medido ⩾4,5:1 contra `bg` (mesmo par usado no
                        // texto da etiqueta) — branco puro contra amarelo/lima
                        // ficava ~1,5-2:1, abaixo do mínimo de contraste não-textual
                        // da WCAG 2.2 (1.4.11, 3:1) pra um elemento de estado
                        // essencial. `aria-pressed` já comunica a seleção pra
                        // tecnologia assistiva independente do ícone.
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
              {/* "Sem cor" como 9ª amostra explícita na grade, não um botão
                  "Remover cor" separado (decisão registrada: mais claro que
                  a ausência de cor é uma OPÇÃO na mesma grade, não uma ação
                  distinta — e `labelColorTokens`/`labelSolidColorTokens` já
                  caem no fallback neutro quando `trelloColor` é null, então
                  não precisa de um caminho de dado diferente). */}
              <button
                type="button"
                onClick={() => setEditorColor(null)}
                aria-label="Sem cor"
                aria-pressed={editorColor === null}
                className="w-full mt-2 flex items-center justify-center gap-2"
                style={{
                  height: 32,
                  borderRadius: 4,
                  background: 'var(--eh-pm-neutral-surface)',
                  border: editorColor === null ? '2px solid var(--eh-text-strong)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--eh-pm-modal-text)',
                }}
              >
                Sem cor
              </button>
            </div>
          </div>
          {actionError && (
            <p role="alert" className="px-3 text-xs" style={{ color: 'var(--eh-danger)' }}>{actionError}</p>
          )}
          <div className="p-3" style={{ borderTop: '1px solid var(--eh-border)' }}>
            {/* Decisão registrada: "Criar"/"Salvar" NÃO fica desabilitado sem
                cor escolhida. "Sem cor" é uma opção explícita e válida na
                própria grade (9ª amostra) — não é "ainda não escolheu", e o
                próprio Trello permite etiqueta sem cor. Bloquear aqui
                obrigaria escolher uma cor pra algo que nem o produto
                original exige. Só bloqueia durante o próprio salvamento
                (`pendingId`), pra evitar duplo-clique. */}
            <button
              type="button"
              onClick={() => void handleSaveEditor()}
              disabled={pendingId === (editorTarget ?? '__create__')}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {editorTarget ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-center relative p-3" style={{ borderBottom: '1px solid var(--eh-border)' }}>
            <p id={titleId} className="text-sm font-semibold" style={{ color: 'var(--eh-text-strong)' }}>Etiquetas</p>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              aria-label="Fechar seletor de etiquetas"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--eh-text-2)', cursor: 'pointer' }}
            >
              <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="10" y1="2" x2="2" y2="10" /><line x1="2" y1="2" x2="10" y2="10" />
              </svg>
            </button>
          </div>
          <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--eh-border)' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar etiquetas..."
              aria-label="Buscar etiquetas"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {visibleLabels.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: 'var(--eh-muted-2)' }}>Nenhuma etiqueta encontrada.</p>
            )}
            {visibleLabels.map((label) => {
              const { bg, fg } = labelSolidColorTokens(label.trelloColor)
              const checked = selectedIds.includes(label.id)
              return (
                <div key={label.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pendingId === label.id}
                    onChange={(e) => void handleToggle(label.id, e.target.checked)}
                    aria-label={`Etiqueta ${label.displayName}`}
                    style={{ width: 16, height: 16, flexShrink: 0 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 32,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '6px 12px',
                      borderRadius: 4,
                      fontSize: 13,
                      fontWeight: 700,
                      background: bg,
                      color: fg,
                      // O nome NUNCA pode ser cortado aqui: 3 etiquetas deste
                      // quadro são todas `pink_dark` ("ALINHAMENTO FORMAÇÃO",
                      // "REUNIÃO ALINHAMENTO MUNICÍPIOS", "REUNIÃO DE
                      // ALINHAMENTO") — truncar deixa as três com o mesmo
                      // prefixo visível E a mesma cor, tornando-as
                      // indistinguíveis justo na tela onde se escolhe qual usar.
                      // Quebra em várias linhas em vez de reticências.
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                      lineHeight: 1.3,
                    }}
                  >
                    {label.displayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEditEditor(label)}
                    aria-label={`Editar etiqueta ${label.displayName}`}
                    disabled={pendingId === label.id}
                    className="flex items-center justify-center shrink-0"
                    style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--eh-text-2)', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-pm-neutral-surface)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
          {actionError && (
            <p role="alert" className="px-3 text-xs" style={{ color: 'var(--eh-danger)' }}>{actionError}</p>
          )}
          <div className="p-3" style={{ borderTop: '1px solid var(--eh-border)' }}>
            <button
              type="button"
              onClick={openCreateEditor}
              className="w-full h-9 rounded-md text-sm text-left px-2"
              style={{ background: 'transparent', border: 'none', color: 'var(--eh-pm-modal-text)', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--eh-pm-neutral-surface)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              Criar uma nova etiqueta
            </button>
          </div>
        </>
      )}
      </div>
    </>,
    document.body,
  )
}
