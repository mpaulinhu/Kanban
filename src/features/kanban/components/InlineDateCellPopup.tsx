import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type CaptionProps, DayPicker, useNavigation } from 'react-day-picker'
import { ptBR } from 'date-fns/locale'
import 'react-day-picker/dist/style.css'

// Altura/largura estimadas: toolbar (36px) + DayPicker com 6 semanas + padding.
// Valores fixos porque getBoundingClientRect no popRef retorna 0 antes do
// DayPicker concluir seu layout — não é possível medir antes do primeiro paint.
// São apenas o CHUTE INICIAL: logo após o paint, `calcPos` passa a usar a
// largura/altura reais medidas no popRef (ver ELO-2694).
const CALENDAR_H = 450
// ELO-2694: era 290, mas o calendário renderizado mede ~326px. A constante
// defasada fazia o clamp de borda calcular com a largura errada e não impedir o
// vazamento (medido: `right: 388` num viewport de 360 = 28px fora da tela).
const CALENDAR_W = 326
/** Respiro mínimo entre o popup e as bordas do viewport. */
const VIEWPORT_MARGIN = 8

// Retorna TODOS os ancestrais scrolláveis de um elemento. O evento scroll não
// borbulha, então ouvir capture no document é inconsistente para overflow
// containers (ex.: <main overflow-y-auto> do AppLayout). Registramos o listener
// diretamente em cada elemento scrollável para garantir o disparo.
//
// ELO-2694: antes esta função retornava só o PRIMEIRO ancestral com
// `overflow-y: auto|scroll` e parava ali. No planner de Realidade Virtual o
// primeiro é um <div> de ~1116px que NÃO rola (scrollHeight === clientHeight) —
// quem rola é o <main> acima dele. O listener ia parar no elemento errado e o
// reposicionamento da ELO-2182 nunca disparava, deixando o calendário "preso"
// num ponto solto da tela. Agora ignoramos containers que não rolam de fato e
// escutamos todos os que rolam, o que também cobre listas aninhadas.
function getScrollableAncestors(el: Element | null): Element[] {
  const out: Element[] = []
  let node = el?.parentElement ?? null
  while (node) {
    const ov = getComputedStyle(node).overflowY
    if ((ov === 'auto' || ov === 'scroll') && node.scrollHeight > node.clientHeight) {
      out.push(node)
    }
    node = node.parentElement
  }
  return out
}

function formatPtBR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function parsePtBR(str: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str.trim())
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  const d = new Date(year, month - 1, day)
  // Valida overflow de dia/mês (ex.: dia 32, mês 13)
  if (d.getDate() !== day || d.getMonth() !== month - 1 || d.getFullYear() !== year) return null
  return d
}

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]
const YEAR_START = 2015
const YEAR_END = 2035

const BTN_STYLE: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: '1px solid var(--eh-border)',
  background: 'var(--eh-surface-2)',
  color: 'var(--eh-text-2)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flexShrink: 0,
  lineHeight: 1,
  fontFamily: 'inherit',
}

const SELECT_STYLE: React.CSSProperties = {
  height: 26,
  borderRadius: 6,
  border: '1px solid var(--eh-border)',
  background: 'var(--eh-surface-2)',
  color: 'var(--eh-text)',
  fontSize: 12.5,
  paddingInline: 6,
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  flex: 1,
}

/** Caption customizado do DayPicker: ‹  [mês ▾]  [ano ▾]  › */
function CustomCaption({ displayMonth }: CaptionProps) {
  const { goToMonth, nextMonth, previousMonth } = useNavigation()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px' }}>
      <button
        type="button"
        disabled={!previousMonth}
        onClick={() => previousMonth && goToMonth(previousMonth)}
        aria-label="Mês anterior"
        style={BTN_STYLE}
      >
        ‹
      </button>
      <select
        value={displayMonth.getMonth()}
        onChange={e => goToMonth(new Date(displayMonth.getFullYear(), Number(e.target.value)))}
        style={SELECT_STYLE}
        aria-label="Mês"
      >
        {MONTHS_PT.map((m, i) => (
          <option key={m} value={i}>{m}</option>
        ))}
      </select>
      <select
        value={displayMonth.getFullYear()}
        onChange={e => goToMonth(new Date(Number(e.target.value), displayMonth.getMonth()))}
        style={{ ...SELECT_STYLE, flex: 'none', width: 64 }}
        aria-label="Ano"
      >
        {Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => YEAR_START + i).map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!nextMonth}
        onClick={() => nextMonth && goToMonth(nextMonth)}
        aria-label="Próximo mês"
        style={BTN_STYLE}
      >
        ›
      </button>
    </div>
  )
}

/**
 * Popup de calendário compartilhado entre todos os InlineDateCell do PM Office
 * (AudiovisualBucketPage, PlannerBucketTree) e o ModalDatePicker (TaskDetailModal).
 *
 * Inclui as 4 melhorias da ELO-2182:
 *   1. Scroll tracking — reposiciona acompanhando o botão âncora ao scrollar.
 *   2. Data inicial correta — abre no mês/ano da data existente ou no mês atual.
 *   3. Dia selecionado em evidência — destaca o dia da data existente no DayPicker.
 *   4. Input manual dd/mm/aaaa + selects de mês/ano no caption do calendário.
 *
 * ELO-2184:
 *   5. disabledBefore / disabledAfter — limites de range (início ≤ término).
 *
 * Montar apenas quando o popup deve estar visível; desmontar para fechar.
 */
export function InlineDateCellPopup({
  anchorRef,
  value,
  onChange,
  onClose,
  zIndex = 100,
  scrollContainer,
  disabledBefore,
  disabledAfter,
}: {
  /** Referência ao botão que abre o popup — usado para posicionar e para scroll tracking. */
  anchorRef: RefObject<HTMLButtonElement | null>
  value: Date | null
  onChange: (d: Date | null) => void
  onClose: () => void
  /** z-index do popup — padrão 100 (tabelas); use 200 dentro de modais. */
  zIndex?: number
  /**
   * Container scrollável que envolve o botão âncora. Quando fornecido, o listener de
   * scroll é registrado neste elemento diretamente em vez de chamar
   * getScrollableAncestor — útil dentro de modais onde o ancestral auto-detectado
   * pode ser o <main> da página, que não scrolla enquanto o modal está aberto.
   */
  scrollContainer?: HTMLElement | null
  /** ELO-2184: desabilita dias anteriores a esta data no DayPicker e valida o input. */
  disabledBefore?: Date
  /** ELO-2184: desabilita dias posteriores a esta data no DayPicker e valida o input. */
  disabledAfter?: Date
}) {
  const popRef = useRef<HTMLDivElement>(null)
  // Começa fora da tela para evitar flash antes do useLayoutEffect posicionar.
  const [pos, setPos] = useState({ top: -9999, left: 0 })

  // Mês exibido pelo DayPicker (controlado — onMonthChange atualiza ao usar os selects do CustomCaption).
  // Melhoria 2: inicia no mês da data existente ou no mês atual se o campo estiver vazio.
  const [displayMonth, setDisplayMonth] = useState<Date>(() => (value ? new Date(value) : new Date()))

  // Melhoria 4: input manual em formato dd/mm/aaaa, pré-populado com o valor atual.
  const [inputRaw, setInputRaw] = useState(() => (value ? formatPtBR(value) : ''))

  // Ref estável para onClose — evita re-cadastro de listeners a cada re-render do pai.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  const calcPos = useCallback((): { top: number; left: number } => {
    const el = anchorRef.current
    if (!el) return { top: -9999, left: 0 }
    const btnRect = el.getBoundingClientRect()
    const GAP = 4
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight

    // ELO-2694: usa as dimensões REAIS do popup assim que ele existe no DOM; as
    // constantes servem só para o primeiro cálculo, antes do primeiro paint.
    const popRect = popRef.current?.getBoundingClientRect()
    const w = Math.min(popRect?.width || CALENDAR_W, vw - VIEWPORT_MARGIN * 2)
    const h = popRect?.height || CALENDAR_H

    // Horizontal: alinha pela esquerda do botão e traz para dentro das bordas.
    // O clamp inferior (VIEWPORT_MARGIN) vem depois do superior para que, numa
    // tela mais estreita que o popup, sobre a borda esquerda visível.
    let left = btnRect.left
    if (left + w + VIEWPORT_MARGIN > vw) left = vw - w - VIEWPORT_MARGIN
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN

    // Vertical: abaixo do botão por padrão; acima se não couber.
    let top = btnRect.bottom + GAP
    if (top + h + VIEWPORT_MARGIN > vh) {
      top = btnRect.top - h - GAP
    }
    // ELO-2694: clampa nas DUAS pontas contra o viewport. Antes só havia o
    // limite inferior (`top >= 8`), o que deixava passar um `top` positivo porém
    // fora da tela: com a âncora fora da área visível (lista longa rolada),
    // `btnRect.top` valia 1617 numa janela de 740 e o popup ia parar em ~1413 —
    // um ponto que o usuário nunca vê. Encostar no limite da janela mantém o
    // calendário visível e o mais perto possível da tarefa clicada.
    const topMax = Math.max(VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN)
    if (top > topMax) top = topMax
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN

    return { top, left }
  }, [anchorRef])

  // Melhoria 1: posiciona antes do primeiro paint (sem flash).
  // ELO-2694: o primeiro cálculo usa as constantes (o popup ainda não tem
  // layout); o segundo, no rAF, já mede o elemento real e corrige a posição.
  useLayoutEffect(() => {
    setPos(calcPos())
    const raf = requestAnimationFrame(() => setPos(calcPos()))
    return () => cancelAnimationFrame(raf)
  }, [calcPos])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (anchorRef.current?.contains(e.target as Node)) return
      if (popRef.current?.contains(e.target as Node)) return
      onCloseRef.current()
    }
    function onDismiss() { onCloseRef.current() }
    // Melhoria 1 (scroll): reposiciona ao detectar scroll no ancestral scrollável
    // em vez de fechar — mantém o popup ancorado no botão de referência.
    function onScroll() { setPos(calcPos()) }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }

    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onDismiss, { passive: true })
    // Quando scrollContainer é fornecido explicitamente (ex.: container interno de um
    // modal), usa-o diretamente em vez de subir a árvore DOM — evita o caso em que
    // getScrollableAncestor para no <main> da página, que não scrolla enquanto o
    // modal está aberto.
    // ELO-2694: escuta TODOS os ancestrais que rolam de fato (antes era só o
    // primeiro com overflow:auto, que nesta tela nem rolava). `document` entra
    // sempre para cobrir a rolagem da própria página.
    const scrollTargets: EventTarget[] = scrollContainer !== undefined
      ? [scrollContainer, document].filter(Boolean) as EventTarget[]
      : [...getScrollableAncestors(anchorRef.current), document]
    for (const t of scrollTargets) {
      t.addEventListener('scroll', onScroll, { passive: true })
    }

    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onDismiss)
      for (const t of scrollTargets) t.removeEventListener('scroll', onScroll)
    }
  }, [anchorRef, calcPos, scrollContainer])

  // Melhoria 4: ao digitar uma data válida, navega o DayPicker para aquele mês.
  function handleInputChange(raw: string) {
    setInputRaw(raw)
    if (raw.length === 10) {
      const parsed = parsePtBR(raw)
      if (parsed) setDisplayMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    }
  }

  // Melhoria 4: Enter confirma a data digitada; Esc fecha sem alterar.
  // ELO-2184: rejeita silenciosamente datas fora do range disabledBefore/disabledAfter.
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const parsed = parsePtBR(inputRaw)
      if (parsed) {
        // Normaliza para meia-noite para comparação apenas por dia
        const d = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
        if (disabledBefore) {
          const limit = new Date(disabledBefore.getFullYear(), disabledBefore.getMonth(), disabledBefore.getDate())
          if (d < limit) return
        }
        if (disabledAfter) {
          const limit = new Date(disabledAfter.getFullYear(), disabledAfter.getMonth(), disabledAfter.getDate())
          if (d > limit) return
        }
        onChange(parsed)
        onClose()
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  const maxH = pos.top > 0 ? Math.max(200, window.innerHeight - pos.top - 8) : undefined

  return createPortal(
    <div
      ref={popRef}
      className="fixed bg-background border border-border rounded-lg shadow-lg p-2"
      style={{
        top: pos.top,
        left: pos.left,
        zIndex,
        maxHeight: maxH,
        // ELO-2694: impede que o calendário fique mais largo que a tela. Só age
        // abaixo de ~342px de viewport; acima disso o popup mantém o tamanho
        // natural e o desktop não muda. `overflow: auto` garante que o conteúdo
        // continue alcançável se ele precisar encolher.
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        overflow: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Melhoria 4: input dd/mm/aaaa — linha própria; navegação mês/ano fica no caption do DayPicker */}
      <div style={{ marginBottom: 6, padding: '0 2px' }}>
        <input
          type="text"
          placeholder="dd/mm/aaaa"
          value={inputRaw}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          maxLength={10}
          style={{
            width: '100%',
            height: 28,
            borderRadius: 6,
            border: '1px solid var(--eh-border-input)',
            background: 'var(--eh-bg)',
            color: 'var(--eh-text)',
            fontSize: 12.5,
            paddingInline: 8,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      {/* Melhorias 2 e 3: mês controlado (abre na data existente) e dia selecionado em evidência */}
      {/* ELO-2184: disabled limita range de datas selecionáveis */}
      <DayPicker
        mode="single"
        month={displayMonth}
        onMonthChange={setDisplayMonth}
        selected={value ?? undefined}
        onSelect={(d) => { onChange(d ?? null); onClose() }}
        locale={ptBR}
        components={{ Caption: CustomCaption }}
        disabled={[
          ...(disabledBefore ? [{ before: disabledBefore }] : []),
          ...(disabledAfter ? [{ after: disabledAfter }] : []),
        ]}
      />
    </div>,
    document.body,
  )
}
