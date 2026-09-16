import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { UserAvatar } from '@/components/UserAvatar/UserAvatar'
import { logPmAction } from '../api/auditLogApi'
import type { PmArea } from '../types/pmOffice'
import type { PMTaskComment } from '../types/pmOffice'
import { addTaskComment, canDeleteComment, canEditComment, deleteTaskComment, subscribeTaskComments, updateTaskComment } from '../api/commentsApi'

/**
 * Formata `createdAt`/`updatedAt` como "29 de jun. de 2026, 09:44".
 * `Timestamp` chega como `{ seconds, nanoseconds }` e pode ainda não estar
 * resolvido logo após a criação otimista do comentário — daí o `null`-check
 * antes de formatar.
 */
function formatCommentDate(ts: PMTaskComment['createdAt'] | undefined): string {
  const secs = (ts as unknown as { seconds?: number } | null | undefined)?.seconds
  if (typeof secs !== 'number') return 'agora'
  const date = new Date(secs * 1000)
  const formatted = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${formatted}, ${time}`
}

/**
 * Thread de comentários da tarefa — coluna direita do modal em
 * modo "documento" da Pedagogia (ver `TaskDetailModal.tsx`). Escopo desta
 * rodada: só Pedagogia renderiza este componente; o shape/API não têm nada
 * de específico da área (ver JSDoc de `commentsApi.ts`).
 *
 * Realtime só enquanto ESTE componente está montado (o modal aberto) — o
 * `useEffect` abaixo assina/desassina a cada troca de `taskId`, nunca um
 * listener persistente na visão de quadro.
 */
export function TaskComments({
  projectId,
  bucketId,
  taskId,
  area,
  projectName,
  taskTitle,
  /** Viewer (`!isEditable`, mesma prop do resto do modal) só lê — não escreve, edita nem exclui, mesmo sendo o próprio autor de um comentário antigo (perfil somente-leitura por design,). */
  isEditable,
}: {
  projectId: string
  bucketId: string
  taskId: string
  area: PmArea
  projectName: string
  taskTitle: string
  isEditable: boolean
}) {
  const { user } = useAuth()
  const [comments, setComments] = useState<PMTaskComment[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PMTaskComment | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeTaskComments(projectId, bucketId, taskId, (next) => {
      setComments(next)
      setLoading(false)
    })
    return unsub
  }, [projectId, bucketId, taskId])

  // Rola até o comentário mais recente quando a thread cresce — só depois do
  // carregamento inicial (`loading === false`), senão a abertura do modal já
  // rolaria uma thread longa antes do usuário ver o topo.
  useEffect(() => {
    if (!loading) threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [comments.length, loading])

  async function handlePost() {
    if (!user || !draft.trim()) return
    setPosting(true)
    setPostError(null)
    try {
      await addTaskComment(
        projectId,
        bucketId,
        taskId,
        { uid: user.uid, name: user.displayName ?? user.email ?? 'Usuário' },
        draft,
      )
      setDraft('')
      logPmAction(
        'pm_comment.create',
        { id: taskId, type: 'pm_comment', description: `Comentário em: ${taskTitle}` },
        { area, projectId, projectName, bucketId },
      )
    } catch (err) {
      console.error('[TaskComments] falha ao publicar comentário', err)
      setPostError('Não foi possível publicar o comentário. Tente novamente.')
    } finally {
      setPosting(false)
    }
  }

  function startEditing(comment: PMTaskComment) {
    setEditingId(comment.id)
    setEditDraft(comment.text)
    setEditError(null)
  }

  async function commitEdit(comment: PMTaskComment) {
    const trimmed = editDraft.trim()
    if (!trimmed || trimmed === comment.text.trim()) {
      setEditingId(null)
      return
    }
    setEditSaving(true)
    setEditError(null)
    try {
      await updateTaskComment(projectId, bucketId, taskId, comment.id, trimmed)
      setEditingId(null)
    } catch (err) {
      console.error('[TaskComments] falha ao editar comentário', err)
      setEditError('Não foi possível salvar a edição. Tente novamente.')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteTaskComment(projectId, bucketId, taskId, deleteTarget.id)
      logPmAction(
        'pm_comment.delete',
        { id: taskId, type: 'pm_comment', description: `Comentário em: ${taskTitle}` },
        { area, projectId, projectName, bucketId },
      )
      setDeleteTarget(null)
    } catch (err) {
      console.error('[TaskComments] falha ao excluir comentário', err)
      setDeleteError('Não foi possível excluir o comentário. Tente novamente.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        // Fundo da coluna direita, mesmo tom neutro usado nas
        // seções expansíveis (Datas/Membros) do modo documento.
        background: 'var(--eh-pm-neutral-surface)',
      }}
    >
      <div style={{ padding: '16px 16px 8px' }}>
        <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--eh-pm-modal-text)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Comentários{comments.length > 0 ? ` (${comments.length})` : ''}
        </p>
      </div>

      {/* Campo de novo comentário — topo, como pedido explicitamente na issue. */}
      {isEditable && (
        <div style={{ padding: '0 16px 12px' }}>
          <label htmlFor={`new-comment-${taskId}`} className="sr-only">
            Escrever um comentário
          </label>
          <textarea
            id={`new-comment-${taskId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void handlePost() }
            }}
            placeholder="Escrever um comentário..."
            rows={3}
            disabled={posting}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            style={{ background: 'var(--eh-surface)' }}
          />
          <div className="flex items-center justify-between mt-1.5">
            <span style={{ fontSize: 11, color: 'var(--eh-text-3)' }}>Ctrl+Enter para enviar</span>
            <button
              type="button"
              onClick={() => void handlePost()}
              disabled={posting || !draft.trim()}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {posting ? 'Enviando…' : 'Comentar'}
            </button>
          </div>
          {postError && (
            <p role="alert" className="text-xs mt-1" style={{ color: 'var(--eh-danger)' }}>{postError}</p>
          )}
        </div>
      )}

      {/* Thread — cronológica, mais antigo primeiro. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && (
          <p style={{ fontSize: 12, color: 'var(--eh-text-3)' }}>Carregando comentários…</p>
        )}
        {!loading && comments.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--eh-text-3)' }}>Nenhum comentário ainda.</p>
        )}
        {comments.map((comment) => {
          const canEdit = isEditable && canEditComment(comment, user?.uid)
          const canDelete = isEditable && canDeleteComment(comment, user?.uid, user?.roleLevel ?? 99)
          const isEditingThis = editingId === comment.id
          return (
            <div key={comment.id} style={{ display: 'flex', gap: 8 }}>
              <UserAvatar name={comment.authorName} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--eh-pm-modal-text)' }}>
                    {comment.authorName}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--eh-text-3)' }}>
                    {formatCommentDate(comment.createdAt)}
                    {comment.updatedAt ? ' (editado)' : ''}
                  </span>
                </div>
                {isEditingThis ? (
                  <div style={{ marginTop: 4 }}>
                    <label htmlFor={`edit-comment-${comment.id}`} className="sr-only">
                      Editar comentário
                    </label>
                    <textarea
                      id={`edit-comment-${comment.id}`}
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); setEditingId(null) }
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void commitEdit(comment) }
                      }}
                      rows={2}
                      disabled={editSaving}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                      style={{ background: 'var(--eh-surface)' }}
                    />
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => void commitEdit(comment)}
                        disabled={editSaving || !editDraft.trim()}
                        className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                      >
                        {editSaving ? 'Salvando…' : 'Salvar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={editSaving}
                        className="h-7 px-2.5 rounded-md border border-input text-xs"
                      >
                        Cancelar
                      </button>
                    </div>
                    {editError && (
                      <p role="alert" className="text-xs mt-1" style={{ color: 'var(--eh-danger)' }}>{editError}</p>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--eh-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 2 }}>
                    {comment.text}
                  </p>
                )}
                {!isEditingThis && (canEdit || canDelete) && (
                  <div className="flex items-center gap-3 mt-1">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => startEditing(comment)}
                        aria-label={`Editar comentário de ${comment.authorName}`}
                        style={{ fontSize: 11, fontWeight: 600, color: 'var(--eh-text-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        Editar
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => { setDeleteTarget(comment); setDeleteError(null) }}
                        aria-label={`Excluir comentário de ${comment.authorName}`}
                        style={{ fontSize: 11, fontWeight: 600, color: 'var(--eh-text-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={threadEndRef} />
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Excluir comentário"
          message="Tem certeza que deseja excluir este comentário? Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          confirmBusyLabel="Excluindo…"
          variant="danger"
          loading={deleting}
          error={deleteError}
          onCancel={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null) } }}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </div>
  )
}
