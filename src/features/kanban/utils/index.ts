// Utilitários compartilhados do módulo PM Office
import type { PMTask } from '../types/pmOffice'

// ─── Data ─────────────────────────────────────────────────────────────────────

export function toDate(ts: unknown): Date | null {
  if (!ts) return null
  const secs = (ts as { seconds: number }).seconds
  return typeof secs === 'number' ? new Date(secs * 1000) : null
}

// ─── Avatares ─────────────────────────────────────────────────────────────────

export const AVATAR_PALETTE = [
  'var(--eh-danger)', '#2563eb', '#7c3aed', '#0891b2',
  'var(--eh-success-fg)', '#db2777', 'var(--eh-warn-fg)', '#0d9488',
]

export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

// ─── Status (projeto/bucket) ──────────────────────────────────────────────────

export type PmStatusKey = 'done' | 'in_progress' | 'todo' | 'revisao'

export const PM_STATUS_CFG: Record<PmStatusKey, { label: string; bg: string; fg: string; dot: string; bar: string }> = {
  done:        { label: 'Concluído',    bg: 'color-mix(in srgb, #22a35a 14%, transparent)',                fg: 'var(--eh-success-fg)', dot: '#22a35a',            bar: '#22a35a' },
  in_progress: { label: 'Em andamento', bg: 'color-mix(in srgb, #3b82f6 15%, transparent)',                fg: '#3b82f6',              dot: '#3b82f6',            bar: '#3b82f6' },
  todo:        { label: 'Não iniciado', bg: 'var(--eh-surface-2)',                                         fg: 'var(--eh-text-2)',     dot: 'var(--eh-muted-2)',  bar: 'var(--eh-muted-2)' },
  revisao:     { label: 'Em revisão',   bg: 'color-mix(in srgb, var(--eh-warn-val) 14%, transparent)',     fg: 'var(--eh-warn-fg)',    dot: 'var(--eh-warn-val)', bar: 'var(--eh-warn-val)' },
}

export function derivePmStatus(pct: number): PmStatusKey {
  if (pct >= 100) return 'done'
  if (pct > 0) return 'in_progress'
  return 'todo'
}

// ─── Acessibilidade (Áudio Descrição + Libras + Site) ────────────────────────

export function computeAccessibilityStatus(
  subtasks: PMTask[],
): { status: 'todo' | 'in_progress' | 'done'; label: string } | null {
  const ad = subtasks.find(s => s.title === 'Áudio Descrição')
  const libras = subtasks.find(s => s.title === 'Libras')
  const site = subtasks.find(s => s.title === 'Site')
  if (!ad || !libras) return null
  const adDone = ad.status === 'done'
  const librasDone = libras.status === 'done'
  const siteDone = site?.status === 'done'
  if (!adDone && !librasDone) {
    if (ad.status === 'in_progress' || libras.status === 'in_progress') return { status: 'in_progress', label: 'Em andamento' }
    return { status: 'todo', label: 'Aguardando' }
  }
  if (adDone && !librasDone) return { status: 'in_progress', label: 'AD API | Falta Libras' }
  if (!adDone && librasDone) return { status: 'in_progress', label: 'Libras API | Falta AD' }
  if (siteDone) return { status: 'done', label: 'Disponível API | SITE' }
  return { status: 'in_progress', label: 'Disponível API' }
}
