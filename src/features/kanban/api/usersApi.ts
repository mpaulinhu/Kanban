/**
 * Usuários em memória. `UserRecord` é copiado fielmente do CoreHub — os
 * componentes leem `name`, `email`, `photoURL`, `jobTitle`, `role` e `uid`.
 *
 * Os três tipos que o original importa de `@eloeditorial/shared-types`
 * (`Department`, `DepartmentRoles`, `ScreenRoleOverrides`) são declarados aqui
 * como aliases abertos: o pacote não existe neste app e nenhum componente
 * copiado inspeciona o conteúdo desses campos.
 */

// `seed.ts` importa daqui só o TIPO `UserRecord` — sem ciclo em runtime.
import { SEED_USERS } from './seed'

export type Department = string
export type DepartmentRoles = Record<string, string>
export type ScreenRoleOverrides = Record<string, string>

export interface UserRecord {
  uid: string
  name: string
  email: string
  role: string
  createdAt?: string
  photoURL?: string
  /** Função/cargo de exibição — mesmo campo lido em `ProfilePage` no original. */
  jobTitle?: string
  /** Departamento de lotação. `null` = sem departamento cadastrado. */
  department?: Department | null
  /** @deprecated substituído por {@link UserRecord.screenRoleOverrides} no original. */
  departmentRoles?: DepartmentRoles
  screenRoleOverrides?: ScreenRoleOverrides
  /** Ausente no dado de origem = ativo, mesmo fallback `!== false` do original. */
  isActive: boolean
}

async function listUsers(opts?: { includeInactive?: boolean }): Promise<UserRecord[]> {
  const all = SEED_USERS.map((u) => ({ ...u }))
  return opts?.includeInactive ? all : all.filter((u) => u.isActive)
}

function notSupported(operation: string): Promise<never> {
  return Promise.reject(new Error(`[usersApi] "${operation}" exige backend — indisponível na versão de demonstração.`))
}

async function createUser(_params: {
  name: string
  email: string
  password: string
  role: string
  department?: Department | null
  departmentRoles?: DepartmentRoles
  screenRoleOverrides?: ScreenRoleOverrides
}): Promise<{ uid: string }> {
  return notSupported('createUser')
}

async function updateRole(
  _userId: string,
  _role: string,
  _department?: Department | null,
  _jobTitle?: string,
): Promise<void> {
  return notSupported('updateRole')
}

async function deleteUser(_userId: string): Promise<void> {
  return notSupported('deleteUser')
}

async function setUserActive(_userId: string, _isActive: boolean): Promise<void> {
  return notSupported('setUserActive')
}

async function updateAccess(
  _userId: string,
  _screens: { grant: string[]; deny: string[] },
  _departmentRoles?: DepartmentRoles,
  _screenRoleOverrides?: ScreenRoleOverrides,
): Promise<void> {
  return notSupported('updateAccess')
}

export const usersApi = { listUsers, createUser, updateRole, deleteUser, setUserActive, updateAccess }
