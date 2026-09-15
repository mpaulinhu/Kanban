import { createContext, useContext, type ReactNode } from 'react'

/**
 * Substitui o AuthProvider do CoreHub (~614 linhas: Microsoft OAuth com
 * tenant, whitelist de domínios, custom claims, listener em `userRoles`,
 * Cloud Function de provisionamento) por um usuário fixo de demonstração.
 *
 * Este app não tem login. O usuário abaixo é quem "assina" comentários e
 * serve de dono para as regras de edição/exclusão — os mesmos campos que os
 * componentes já liam do usuário autenticado.
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
