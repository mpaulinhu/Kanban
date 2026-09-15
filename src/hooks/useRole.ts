/**
 * Substitui o RBAC do CoreHub (4 tabelas de permissão, ~665 linhas) por um
 * modelo aberto: neste app todo usuário edita.
 *
 * A superfície é a mesma que os componentes já consomem (`canWriteScreen`,
 * `roleLevel`, ...), então reintroduzir níveis depois é trocar este arquivo,
 * sem tocar nas telas.
 */
export function useRole() {
  return {
    role: 'admin' as const,
    roleLevel: 2,
    can: () => true,
    canViewScreen: () => true,
    canWriteScreen: () => true,
    canDownloadAcervo: () => true,
  }
}
