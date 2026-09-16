import { createContext, useContext, type ReactNode } from 'react'

/**
 * Este app não tem login: o provider expõe um usuário fixo de demonstração.
 *
 * Esse usuário é quem "assina" comentários e serve de dono para as regras de
 * edição/exclusão. Os campos são os que os componentes esperam de um usuário
 * autenticado, então plugar um login real depois é trocar só este arquivo.
 */
export interface AuthUser {
  uid: string
  email: string
  displayName: string
  photoURL?: string
  role: string
  roleLevel: number
}

export const DEMO_USER: AuthUser = {
  uid: 'demo-user',
  email: 'voce@exemplo.com.br',
  displayName: 'Você',
  role: 'admin',
  roleLevel: 2,
}

interface AuthContextValue {
  user: AuthUser | null
}

const AuthContext = createContext<AuthContextValue>({ user: DEMO_USER })

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={{ user: DEMO_USER }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
