/**
 * Paleta de cores das etiquetas — pares de tokens `var(--eh-label-*)`
 * definidos em `styles/globals.css` (claro + `[data-theme="dark"]`).
 *
 * NUNCA usar hex cru vindo de uma fonte externa (ex.: `PMOfficeLabel.colorKey`)
 * direto num chip: hex arbitrários reprovam contraste AA. Este mapa traduz a
 * cor de ORIGEM (semântica: "amarelo", "azul"...) para o par de tokens
 * correspondente; cor desconhecida cai no fallback neutro.
 */
const KNOWN_COLOR_KEYS = [
  'green',
  'blue',
  'yellow',
  'red',
  'purple',
  'pink',
  'lime',
  'orange',
] as const

export type KnownColorKey = (typeof KNOWN_COLOR_KEYS)[number]

/**
 * Nome em PT-BR de cada cor — usado no seletor de cor ao criar/editar
 * etiqueta como `aria-label` de cada amostra ("Verde", "Azul"...).
 * Cor nunca pode ser o único identificador (WCAG 2.2 AA 1.4.1), mesmo numa
 * grade de amostras de cor pura — o nome por extenso é o texto alternativo.
 */
export const COLOR_KEY_LABEL_PT: Record<KnownColorKey, string> = {
  green: 'Verde',
  blue: 'Azul',
  yellow: 'Amarelo',
  red: 'Vermelho',
  purple: 'Roxo',
  pink: 'Rosa',
  lime: 'Lima',
  orange: 'Laranja',
}

/**
 * Forma adjetiva feminina (concorda com "etiqueta") — usada só para compor
 * `"Sem nome #N (cor)"` ao criar uma etiqueta sem título, ex.: "Sem nome #1
 * (amarela)". Existe separada de {@link COLOR_KEY_LABEL_PT} porque lá o nome
 * é usado isolado ("Amarelo") e aqui precisa concordar em gênero.
 */
export const COLOR_KEY_LABEL_PT_FEMININE: Record<KnownColorKey, string> = {
  green: 'verde',
  blue: 'azul',
  yellow: 'amarela',
  red: 'vermelha',
  purple: 'roxa',
  pink: 'rosa',
  lime: 'lima',
  orange: 'laranja',
}

/**
 * As cores disponíveis pra escolher ao criar/editar etiqueta — EXATAMENTE as
 * que têm par `--eh-label-*-solid-bg/-fg` com contraste AA medido nos dois
 * temas (ver `globals.css`). Ampliar a paleta exige medir o contraste de cada
 * par novo nos dois temas; não é uma escolha de UI isolada.
 */
export const CREATABLE_LABEL_COLORS: KnownColorKey[] = [...KNOWN_COLOR_KEYS]

/**
 * Normaliza uma cor de origem (ex.: `colorKey` cru — `'pink_dark'`,
 * `'blue_dark'`, `'lime_light'`) para uma das chaves conhecidas acima.
 * Substring match de propósito: fontes externas costumam sufixar variação de
 * tom (`_dark`/`_light`) que não muda o TOM base disponível na paleta.
 */
export function normalizeLabelColorKey(raw: string | null | undefined): KnownColorKey | null {
  if (!raw) return null
  const found = KNOWN_COLOR_KEYS.find((k) => raw.includes(k))
  return found ?? null
}

/**
 * Gera `"Sem nome #N (cor)"` pro título de uma etiqueta criada sem nome via o
 * seletor. O contador é GLOBAL entre todas as cores sem nome, não reiniciado
 * por cor. Função pura: recebe a lista de `displayName` JÁ existentes no
 * projeto e devolve o próximo número da sequência, olhando quantas já batem o
 * padrão `"Sem nome #"` (de qualquer cor).
 *
 * Sem cor (`colorKey: null`) usa "sem cor" como sufixo, já que não há
 * adjetivo de cor pra compor.
 */
export function buildUnnamedLabelDisplayName(existingDisplayNames: string[], colorKey: KnownColorKey | null): string {
  const usedNumbers = existingDisplayNames
    .map((name) => /^Sem nome #(\d+)/.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
  const nextSeq = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1
  const colorSuffix = colorKey ? COLOR_KEY_LABEL_PT_FEMININE[colorKey] : 'sem cor'
  return `Sem nome #${nextSeq} (${colorSuffix})`
}

/** Par `{ bg, fg }` de tokens CSS para uma cor de origem — fallback neutro se desconhecida/ausente. */
export function labelColorTokens(raw: string | null | undefined): { bg: string; fg: string } {
  const key = normalizeLabelColorKey(raw)
  if (!key) return { bg: 'var(--eh-label-neutral-bg)', fg: 'var(--eh-label-neutral-fg)' }
  return { bg: `var(--eh-label-${key}-bg)`, fg: `var(--eh-label-${key}-fg)` }
}

/**
 * Variante "solid" — barra colorida sólida no topo do card, mais saturada que
 * o chip pastel de {@link labelColorTokens}. Usada só pela área Pedagogia; as
 * demais continuam com `labelColorTokens`. Pares medidos ⩾4,5:1 — ver
 * comentário em `globals.css` junto de `--eh-label-*-solid-*`.
 */
export function labelSolidColorTokens(raw: string | null | undefined): { bg: string; fg: string } {
  const key = normalizeLabelColorKey(raw)
  if (!key) return { bg: 'var(--eh-label-neutral-solid-bg)', fg: 'var(--eh-label-neutral-solid-fg)' }
  return { bg: `var(--eh-label-${key}-solid-bg)`, fg: `var(--eh-label-${key}-solid-fg)` }
}

/**
 * Rótulo SEMPRE exibível de uma etiqueta — nunca depende só da cor (WCAG 2.2
 * AA 1.4.1). Resolve fusão (`mergedInto`) para o nome do alvo quando presente.
 */
export function resolveLabelDisplay(
  labelId: string,
  labelsById: Map<string, import('../types/pmOffice').PMOfficeLabel>,
): { id: string; displayName: string; colorKey: string | null | undefined } | null {
  let label = labelsById.get(labelId)
  if (!label) return null
  // Fusão é indireção simples (não permitimos cadeia — mergedInto sempre
  // aponta pro alvo final na criação da fusão).
  if (label.mergedInto) {
    const target = labelsById.get(label.mergedInto)
    if (target) label = target
  }
  return { id: label.id, displayName: label.displayName, colorKey: label.colorKey }
}
