import { useState, type CSSProperties } from 'react'

const COLORS = [
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#dcfce7', text: 'var(--eh-success-fg)' },
  { bg: '#fef9c3', text: '#a16207' },
  { bg: '#fce7f3', text: '#be185d' },
  { bg: '#ede9fe', text: '#6d28d9' },
  { bg: '#ffedd5', text: 'var(--eh-danger)' },
]

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/** Um avatar — foto de perfil quando existir e carregar, senão iniciais coloridas. */
function Avatar({ name, photoURL, style }: { name: string; photoURL?: string; style: CSSProperties }) {
  const [broken, setBroken] = useState(false)
  const showPhoto = !!photoURL && !broken

  return (
    <span style={{ ...style, overflow: 'hidden' }} title={name}>
      {showPhoto ? (
        <img
          src={photoURL}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        getInitials(name)
      )}
    </span>
  )
}

export function AssigneeAvatars({
  names,
  photoURLs,
  max = 3,
  size = 24,
  onAvatarClick,
}: {
  names: string[]
  /** Foto de perfil por assignee, no mesmo índice de `names` (ELO-2661). Entrada ausente/undefined cai no fallback de iniciais. */
  photoURLs?: (string | undefined)[]
  max?: number
  size?: number
  /**
   * Torna cada avatar clicável (ELO-3183) — recebe o índice em `names` e o
   * próprio elemento, para o chamador ancorar um popover de perfil nele.
   * Ausente = avatares seguem decorativos, sem mudança de comportamento
   * (é o caso das duas visões da Grade do Marketing).
   */
  onAvatarClick?: (index: number, element: HTMLElement) => void
}) {
  if (!names || names.length === 0) return null

  const visible = names.slice(0, max)
  const overflow = names.length - max

  function avatarStyle(i: number): CSSProperties {
    const color = COLORS[i % COLORS.length]
    return {
      width: size,
      height: size,
      borderRadius: '50%',
      border: '2px solid var(--eh-surface)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: Math.floor(size * 0.38),
      fontWeight: 700,
      marginLeft: i > 0 ? -Math.floor(size * 0.28) : 0,
      position: 'relative',
      zIndex: visible.length - i,
      background: color.bg,
      color: color.text,
      userSelect: 'none',
      flexShrink: 0,
      cursor: 'default',
    }
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      {visible.map((name, i) =>
        onAvatarClick ? (
          <button
            key={i}
            type="button"
            onClick={(e) => onAvatarClick(i, e.currentTarget)}
            aria-label={`Ver perfil de ${name}`}
            aria-haspopup="dialog"
            style={{ ...avatarStyle(i), padding: 0, cursor: 'pointer', overflow: 'hidden' }}
            title={name}
          >
            {photoURLs?.[i] ? (
              <img
                src={photoURLs[i]}
                alt=""
                referrerPolicy="no-referrer"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              getInitials(name)
            )}
          </button>
        ) : (
          <Avatar key={i} name={name} photoURL={photoURLs?.[i]} style={avatarStyle(i)} />
        ),
      )}
      {overflow > 0 && (
        <span
          style={{
            ...avatarStyle(visible.length),
            background: 'var(--eh-border)',
            color: 'var(--eh-text-3)',
          }}
          title={names.slice(max).join(', ')}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}
