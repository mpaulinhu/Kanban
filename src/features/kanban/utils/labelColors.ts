/**
 * Paleta de cores das etiquetas do PM Office (ELO-3182) — pares de tokens
 * `var(--eh-label-*)` definidos em `styles/globals.css` (claro + `[data-theme="dark"]`).
 *
 * NUNCA usar hex cru vindo de uma fonte externa (ex.: `PMOfficeLabel.trelloColor`)
 * direto num chip — os hex originais do Trello reprovam contraste AA. Este
 * mapa traduz a cor de ORIGEM (semântica: "amarelo", "azul"...) para o par
 * de tokens correspondente; cor desconhecida cai no fallback neutro.
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
 * etiqueta (ELO-3182) como `aria-label` de cada amostra ("Verde", "Azul"...).
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
 * `"Sem nome #N (cor)"` ao criar uma etiqueta sem título, no MESMO padrão
 * gramatical de `scripts/firestore/import-trello-agenda-pedagogas.mjs`
 * (que já produziu "Sem nome #1 (amarela)"/"Sem nome #2 (laranja)" nas 601
 * tarefas importadas) — consistência entre o nome gerado pelo import e o
 * gerado pela UI, não duas convenções divergentes pro mesmo conceito.
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
 * As 8 cores disponíveis pra escolher ao criar/editar etiqueta — EXATAMENTE
 * as que têm par `--eh-label-*-solid-bg/-fg` medido em contraste AA nos dois
 * temas (ver `globals.css`). O Trello oferece 30 (6 tons × 5 matizes); nós
 * temos 8 porque só 8 passaram pelo gate de UX. Ampliar a paleta exige medir
 * contraste de cada par novo — não é uma escolha de UI isolada, por isso
 * fica como sugestão de follow-up, não implementado aqui sem pedido.
 */
export const CREATABLE_LABEL_COLORS: KnownColorKey[] = [...KNOWN_COLOR_KEYS]

/**
 * Normaliza uma cor de origem (ex.: `trelloColor` cru — `'pink_dark'`,
 * `'blue_dark'`, `'lime_light'`) para uma das chaves conhecidas acima.
 * Substring match de propósito: o Trello sufixa variação de tom
 * (`_dark`/`_light`) que não muda o TOM base disponível na nossa paleta.
 */
export function normalizeLabelColorKey(raw: string | null | undefined): KnownColorKey | null {
  if (!raw) return null
  const found = KNOWN_COLOR_KEYS.find((k) => raw.includes(k))
  return found ?? null
}

/**
 * Gera `"Sem nome #N (cor)"` pro título de uma etiqueta criada sem nome via
 * o seletor (ELO-3182) — mesmo padrão gramatical/contador do script de
 * import (`unnamedSeq`, GLOBAL entre todas as cores sem nome, não reiniciado
 * por cor). Função pura, testável isolada de Firestore: recebe a lista de
 * `displayName` JÁ existentes no projeto (etiquetas atuais) e devolve o
 * próximo número da sequência, olhando quantas já batem o padrão
 * `"Sem nome #"` (de qualquer cor).
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
 * Variante "solid" (ELO-3182, refinamento visual Pedagogia) — barra colorida
 * sólida no topo do card, estilo Trello, mais saturada que o chip pastel de
 * {@link labelColorTokens}. Exclusiva da área Pedagogia; Marketing/
 * Administrativo continuam usando `labelColorTokens`. Pares medidos ⩾4,5:1
 * — ver comentário em `globals.css` junto de `--eh-label-*-solid-*`.
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
): { id: string; displayName: string; trelloColor: string | null | undefined } | null {
  let label = labelsById.get(labelId)
  if (!label) return null
  // Fusão é indireção simples (não permitimos cadeia — mergedInto sempre
  // aponta pro alvo final na criação da fusão).
  if (label.mergedInto) {
    const target = labelsById.get(label.mergedInto)
    if (target) label = target
  }
  return { id: label.id, displayName: label.displayName, trelloColor: label.trelloColor }
}
