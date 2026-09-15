import { UserProfilePopover } from '@/components/UserProfilePopover'

/**
 * Popover de perfil de um membro do card (ELO-3182/ELO-3183) — fino wrapper
 * sobre o `UserProfilePopover` compartilhado, com a ação "Remover do Cartão"
 * específica do contexto de tarefa (ausente quando o viewer não pode editar).
 */
export function MemberProfilePopover({
  anchorRef,
  open,
  onClose,
  name,
  email,
  photoURL,
  onRemove,
}: {
  anchorRef: { current: HTMLElement | null }
  open: boolean
  onClose: () => void
  name: string
  email?: string
  photoURL?: string
  /** Ausente = não mostra "Remover do Cartão" (ex.: viewer sem permissão de editar). */
  onRemove?: () => void
}) {
  return (
    <UserProfilePopover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      name={name}
      email={email}
      photoURL={photoURL}
      actions={onRemove ? [{ label: 'Remover do Cartão', onClick: onRemove }] : undefined}
    />
  )
}
