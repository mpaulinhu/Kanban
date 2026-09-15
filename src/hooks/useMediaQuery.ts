import { useEffect, useState } from 'react'

/**
 * Hook simples de media query baseado em `matchMedia`, usado para alternar
 * inline styles entre desktop e mobile (o CoreHUB não usa CSS modules/Tailwind
 * nos componentes desta feature). SSR-safe: assume `false` no primeiro render
 * quando `window` não existe.
 *
 * @example const isMobile = useMediaQuery('(max-width: 640px)')
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
