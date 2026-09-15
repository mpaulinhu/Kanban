import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Modo "ampliado" do quadro: esconde o cabeçalho do app para o Kanban ocupar
 * 100% da tela.
 *
 * Por que um Context e não a Fullscreen API do browser: a intenção é esconder
 * a NOSSA navegação, não a interface do navegador — `requestFullscreen()` sai
 * até a barra de abas do sistema, o que é mais do que se quer, e traz
 * problemas próprios (exige gesto do usuário, sai sozinho com Esc sem o React
 * saber). Um estado React resolve exatamente o pretendido, com controle total
 * sobre transição e reset.
 */
interface ImmersiveContextValue {
  immersive: boolean
  setImmersive: (value: boolean) => void
}

export const ImmersiveContext = createContext<ImmersiveContextValue>({
  immersive: false,
  setImmersive: () => {},
})

export const useImmersive = (): ImmersiveContextValue => useContext(ImmersiveContext)

export function ImmersiveProvider({ children }: { children: ReactNode }) {
  const [immersive, setImmersive] = useState(false)
  const value = useMemo(() => ({ immersive, setImmersive }), [immersive])
  return <ImmersiveContext.Provider value={value}>{children}</ImmersiveContext.Provider>
}

/**
 * Regra de reset do modo ampliado ao trocar de rota. Contrato deliberadamente
 * simples e sem exceção: QUALQUER troca de pathname reseta. Um "só reseta se
 * sair da área" pareceria mais preciso, mas deixaria o usuário numa tela sem
 * nenhuma navegação caso ela não tenha o botão de sair do modo ampliado.
 */
export function shouldResetImmersive(prevPathname: string, nextPathname: string): boolean {
  return prevPathname !== nextPathname
}
