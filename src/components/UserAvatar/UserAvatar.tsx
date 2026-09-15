import { useState } from 'react'

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
}

export interface UserAvatarProps {
  name: string
  photoURL?: string
  size: number
  /** Cor de fundo do fallback de iniciais. Default: neutro (`--eh-surface-2`/`--eh-text-2`). */
  bg?: string
  fg?: string
}

/**
 * Avatar de usuário: foto de perfil quando existir, senão iniciais.
 * Extraído de `features/users/pages/UsersPage.tsx` (ELO-2166) — lá o
 * fallback de iniciais é colorido por perfil de acesso (`RoleDef`); aqui a
 * cor é neutra por padrão porque este componente é usado em contextos
 * (ex.: mural de avatares do Dashboard) que não devem expor role.
 */
export function UserAvatar({ name, photoURL, size, bg = 'var(--eh-surface-2)', fg = 'var(--eh-text-2)' }: UserAvatarProps) {
  const [broken, setBroken] = useState(false)
  const showPhoto = !!photoURL && !broken

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.34,
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: '.03em',
        overflow: 'hidden',
      }}
    >
      {showPhoto ? (
        <img
          src={photoURL}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initials(name)
      )}
    </div>
  )
}
