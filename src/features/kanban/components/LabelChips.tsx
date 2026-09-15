import type { PMOfficeLabel } from '../types/pmOffice'
import { labelColorTokens, labelSolidColorTokens, resolveLabelDisplay } from '../utils/labelColors'

/**
 * Chips de etiqueta de um card (ELO-3182). Cor via `var(--eh-label-*)` —
 * nunca hex do Trello. Nome sempre visível (WCAG 2.2 AA 1.4.1): a cor nunca
 * é o único portador de informação.
 *
 * Duas variantes estilo Trello (refinamento visual, exclusivo da área
 * Pedagogia), ambas com a MESMA paleta saturada (`labelSolidColorTokens`) —
 * confirmado por amostragem de pixel que o card e o modal do Trello real
 * usam a cor idêntica (`#4bce97` verde), só a forma muda:
 * - `variant="solid"`: barra curta (~40px), no topo do card — como no
 *   board real.
 * - `variant="solid-pill"`: pílula arredondada com o nome — como na seção
 *   Etiquetas do modal de detalhe (`trello-3-modal.png`).
 * Default `'chip'` preserva o visual pastel de Marketing/Administrativo
 * sem mudança.
 */
export function LabelChips({
  labelIds,
  labelsById,
  variant = 'chip',
}: {
  labelIds: string[] | undefined
  labelsById: Map<string, PMOfficeLabel>
  variant?: 'chip' | 'solid' | 'solid-pill'
}) {
  if (!labelIds || labelIds.length === 0) return null
  const resolved = labelIds
    .map((id) => resolveLabelDisplay(id, labelsById))
    .filter((l): l is NonNullable<typeof l> => l !== null)
  if (resolved.length === 0) return null

  if (variant === 'solid') {
    // marginBottom 8: medido na captura do Trello — a barra de etiqueta
    // respira mais do lado do título do que os 6px anteriores davam.
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {resolved.map((label) => {
          const { bg, fg } = labelSolidColorTokens(label.trelloColor)
          return (
            <span
              key={label.id}
              title={label.displayName}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minWidth: 40,
                maxWidth: 140,
                minHeight: 16,
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1.2,
                background: bg,
                color: fg,
                // `overflow: hidden` no container garante que NADA escape da
                // faixa colorida, mesmo que o filho calcule errado.
                overflow: 'hidden',
                boxSizing: 'border-box',
              }}
            >
              {/* O texto precisa de um elemento PRÓPRIO para truncar:
                  `text-overflow: ellipsis` não tem efeito num container
                  `inline-flex` (só se aplica a bloco), então antes o nome
                  longo VAZAVA para fora da cor de fundo em vez de virar
                  reticências — foi o que o Marcos viu em "ALINHAMENTO
                  FORMAÇÃO". `minWidth: 0` é o que permite o filho encolher
                  abaixo do próprio conteúdo dentro de um flex. */}
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label.displayName}
              </span>
            </span>
          )
        })}
      </div>
    )
  }

  if (variant === 'solid-pill') {
    // Altura ~32px medida na captura nova do modal (padding + line-height
    // somam ~32px com fontSize 14) — maior que a v1 (~24px), que tinha sido
    // medida antes da correção "não confie em getComputedStyle heurístico".
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {resolved.map((label) => {
          const { bg, fg } = labelSolidColorTokens(label.trelloColor)
          return (
            <span
              key={label.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 32,
                padding: '6px 14px',
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1.3,
                background: bg,
                color: fg,
                // Diferente da barra do card, aqui a pílula pode crescer — há
                // espaço no modal e o nome inteiro é útil. Só não pode
                // ultrapassar a largura disponível: quebra em mais linhas em
                // vez de estourar o container.
                maxWidth: '100%',
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
              }}
            >
              {label.displayName}
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {resolved.map((label) => {
        const { bg, fg } = labelColorTokens(label.trelloColor)
        return (
          <span
            key={label.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: 20,
              fontSize: 10.5,
              fontWeight: 600,
              lineHeight: 1.5,
              background: bg,
              color: fg,
            }}
          >
            {label.displayName}
          </span>
        )
      })}
    </div>
  )
}
