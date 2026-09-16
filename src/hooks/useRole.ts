/**
 * Modelo de permissão aberto: neste app todo usuário edita.
 *
 * A superfície (`canWriteScreen`, `roleLevel`, ...) é a que os componentes já
 * consomem, então introduzir níveis de acesso depois é trocar este arquivo,
 * sem tocar nas telas.
 */
export function useRole() {
  return {
    role: 'admin' as const,
    roleLevel: 2,
    can: () => true,
    canViewScreen: () => true,
    canWriteScreen: () => true,
  }
}
