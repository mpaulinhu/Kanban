/**
 * No CoreHub este módulo restringe quem pode ser atribuído a uma tarefa aos
 * e-mails de domínios corporativos do grupo — havia contas externas na mesma
 * base de usuários.
 *
 * Neste app não existe essa distinção: a lista de usuários já é só a equipe,
 * então `onlyInternalUsers` devolve todos. A função permanece (em vez de ser
 * removida das chamadas) para que reintroduzir o filtro seja mexer só aqui.
 */
export function onlyInternalUsers<T extends { email?: string | null }>(users: T[]): T[] {
  return users
}

export function isInternalEmail(_email: string | null | undefined): boolean {
  return true
}

/**
 * Normaliza nome de pessoa para comparação: remove acentos, descarta `#`
 * (marcação manual que aparece em alguns nomes), colapsa espaços repetidos e
 * ignora caixa. Sem isso, "Andréa Bruno" e "Andrea Bruno" não casam.
 */
export function normalizePersonName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/#/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Conjunto de nomes normalizados, para filtrar listas que só têm o nome. */
export function buildKnownNameSet(users: { name?: string | null }[]): Set<string> {
  const set = new Set<string>()
  for (const u of users) {
    const n = normalizePersonName(u.name)
    if (n) set.add(n)
  }
  return set
}
