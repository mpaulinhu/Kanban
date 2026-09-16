import { useEffect, useRef, useState } from 'react'
import type { UserRecord } from '../api/usersApi'
import { updatePMProject } from '../api/pmOfficeApi'
import { onlyInternalUsers } from '@/lib/internalDomains'

interface TeamModalProps {
  open: boolean
  projectId: string | null
  users: UserRecord[]
  team: string[]
  onClose: () => void
  onSave: (newTeam: string[]) => void
}

export function TeamModal({ open, projectId, users, team, onClose, onSave }: TeamModalProps) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Reinicia seleção e busca quando o modal abre
  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelected(new Set(team))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0)
  }, [open])

  if (!open) return null

  const q = search.trim().toLowerCase()
  // `team` guarda uid, não nome — `selected` precisa usar a mesma chave, ou o
  // Set nunca casa com a lista de usuários (é o que fazia os chips mostrarem
  // o uid cru: a UI achava que ninguém da lista estava selecionado e caía no
  // valor bruto do array).
  const usersByUid = new Map(users.map((u) => [u.uid, u]))
  const notInTeam = onlyInternalUsers(users).filter((u) => !selected.has(u.uid))
  const filtered = q
    ? notInTeam.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      )
    : notInTeam

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function handleSave() {
    if (!projectId) return
    setSaving(true)
    try {
      const newTeam = Array.from(selected)
      await updatePMProject(projectId, { team: newTeam })
      onSave(newTeam)
      onClose()
    } catch (err) {
      console.error('[TeamModal] falhou ao salvar equipe:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.42)', backdropFilter: 'blur(3px)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--eh-surface)', borderRadius: 16,
          width: '100%', maxWidth: 420,
          boxShadow: '0 24px 64px rgba(15,23,42,0.2)',
          display: 'flex', flexDirection: 'column',
          maxHeight: '80vh',
        }}
      >
        {/* Cabeçalho */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--eh-border)',
            flexShrink: 0,
          }}
        >
          <p
            id="team-modal-title"
            style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--eh-text)' }}
          >
            Equipe do projeto
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            style={{
              width: 30, height: 30, borderRadius: 8, border: 'none',
              background: 'var(--eh-bg)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg
              viewBox="0 0 24 24" width="14" height="14"
              fill="none" stroke="var(--eh-text-2)" strokeWidth="2.3" strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Membros atuais */}
        <div style={{ padding: '12px 24px 12px', borderBottom: '1px solid var(--eh-border)', flexShrink: 0 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 600, color: 'var(--eh-text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Equipe atual {selected.size > 0 && `(${selected.size})`}
          </p>
          {selected.size === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--eh-text-2)' }}>Nenhum membro adicionado.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Array.from(selected).map((uid) => {
                // Membro salvo antes de existir na lista atual de usuários
                // (removido do seed, por exemplo) — mostra o uid em vez de
                // sumir silenciosamente, mas sem travar a remoção.
                const label = usersByUid.get(uid)?.name ?? uid
                return (
                  <span
                    key={uid}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: 12.5, borderRadius: 20,
                      padding: '3px 10px 3px 12px',
                      background: 'var(--eh-bar-track)', color: 'var(--eh-text)',
                    }}
                  >
                    {label}
                    <button
                      type="button"
                      aria-label={`Remover ${label}`}
                      onClick={() => toggle(uid)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--eh-text-2)', fontSize: 15, lineHeight: 1, padding: '0 1px',
                      }}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* Busca */}
        <div style={{ padding: '12px 24px 8px', flexShrink: 0 }}>
          <input
            ref={searchRef}
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px',
              border: '1px solid var(--eh-border)', borderRadius: 8,
              fontSize: 13.5, fontFamily: 'inherit',
              color: 'var(--eh-text)', background: 'var(--eh-bg)',
              outline: 'none',
            }}
          />
        </div>

        {/* Lista de usuários */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 8px' }}>
          {filtered.length === 0 ? (
            <p
              style={{
                textAlign: 'center', color: 'var(--eh-text-2)',
                fontSize: 13, padding: '20px 0',
              }}
            >
              Nenhum usuário encontrado.
            </p>
          ) : (
            filtered.map((u) => {
              const checked = selected.has(u.uid)
              return (
                <label
                  key={u.uid}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
                    background: checked ? 'var(--eh-bar-track)' : 'transparent',
                    marginBottom: 2,
                    transition: 'background .08s',
                  }}
                  onMouseEnter={(e) => {
                    if (!checked) e.currentTarget.style.background = 'var(--eh-bg)'
                  }}
                  onMouseLeave={(e) => {
                    if (!checked) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(u.uid)}
                    style={{
                      flexShrink: 0, accentColor: 'var(--eh-primary)',
                      width: 15, height: 15,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        margin: 0, fontSize: 13.5,
                        fontWeight: checked ? 600 : 400,
                        color: 'var(--eh-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {u.name}
                    </p>
                    <p
                      style={{
                        margin: 0, fontSize: 11.5, color: 'var(--eh-text-2)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {u.email}
                    </p>
                  </div>
                </label>
              )
            })
          )}
        </div>

        {/* Rodapé */}
        <div
          style={{
            display: 'flex', gap: 10, justifyContent: 'flex-end',
            padding: '12px 24px 20px',
            borderTop: '1px solid var(--eh-border)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
              color: 'var(--eh-text-2)', background: 'var(--eh-bg)',
              border: '1px solid var(--eh-border)', borderRadius: 9,
              padding: '9px 18px',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !projectId}
            style={{
              fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
              color: 'var(--eh-surface)',
              background: saving || !projectId ? 'var(--eh-muted-2)' : 'var(--eh-text-strong)',
              border: 'none', borderRadius: 9,
              padding: '9px 18px',
              cursor: saving || !projectId ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
