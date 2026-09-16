import { useEffect, useRef, useState } from 'react'
import type { PMTaskAttachment } from '../types/pmOffice'
import type { PMTaskPatch } from '../api/pmOfficeApi'
import {
  ATTACHMENT_ACCEPT,
  AttachmentRejectedError,
  dedupeFileName,
  deleteTaskAttachmentFile,
  downloadTaskAttachment,
  uploadTaskAttachment,
  validateAttachmentFile,
} from '../api/attachmentsApi'
import { ConfirmDialog } from '@/components/ConfirmDialog'

/** Formata bytes em texto legível (ex.: "163 KB", "1.2 MB"). `null`/`0` cai em "—". */
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

type AttachmentKind = 'image' | 'sheet' | 'pdf' | 'generic'

function kindOf(attachment: PMTaskAttachment): AttachmentKind {
  const ext = extensionOf(attachment.fileName)
  const mime = attachment.mimeType ?? ''
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image'
  if (mime.includes('spreadsheet') || mime.includes('ms-excel') || ['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet'
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  return 'generic'
}

/**
 * Par de tokens fundo/texto por tipo de arquivo — reaproveita a paleta de
 * etiquetas da Pedagogia (ELO-3182, `--eh-label-*-bg/-fg`), já medida
 * ⩾4,5:1 nos dois temas (ver comentário em `globals.css`). Nenhum token novo
 * foi criado para este refino: os pares abaixo já existiam declarados no CSS
 * e ainda não tinham consumidor algum no app.
 */
const KIND_STYLE: Record<AttachmentKind, { bg: string; fg: string }> = {
  pdf: { bg: 'var(--eh-label-red-bg)', fg: 'var(--eh-label-red-fg)' },
  sheet: { bg: 'var(--eh-label-green-bg)', fg: 'var(--eh-label-green-fg)' },
  image: { bg: 'var(--eh-label-blue-bg)', fg: 'var(--eh-label-blue-fg)' },
  generic: { bg: 'var(--eh-label-neutral-bg)', fg: 'var(--eh-label-neutral-fg)' },
}

const GENERIC_ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

/**
 * Marca do tipo de arquivo dentro do bloco colorido (o "com o ícone/extensão
 * em cima" pedido na issue). PDF/planilha/imagem mostram a extensão em texto
 * — mais informativo que um ícone genérico de documento e mais parecido com
 * um "chip de tipo" (a diferença real entre um PDF e um DOCX importa aqui).
 * Extensão desconhecida cai no ícone de documento genérico.
 */
function KindMark({ kind, extension }: { kind: AttachmentKind; extension: string }) {
  if (kind === 'generic' && !extension) {
    return (
      <svg {...GENERIC_ICON_PROPS} aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    )
  }
  return (
    <span className="text-[11px] font-bold uppercase tracking-tight" aria-hidden="true">
      {extension || 'DOC'}
    </span>
  )
}

/**
 * Miniatura do anexo (refino visual estilo Trello, "deixar mais bonito"). Um
 * bloco de 44×44 colorido por tipo (PDF vermelho, planilha verde, imagem
 * azul, genérico neutro) substitui o antigo ícone monocromático de 18px.
 *
 * Para imagem, troca o bloco azul pela PRÓPRIA foto assim que ela entra (ou
 * quase entra) na viewport — mesmo padrão de lazy-load de
 * `features/adelo/components/PageImagePreview.tsx` (ELO-2903): sem isso,
 * abrir um card com várias fotos anexadas disparia um `getBlob()` autenticado
 * por imagem de uma vez só, só para desenhar a lista. `getBlob()` é
 * obrigatório aqui (nunca `getDownloadURL`, ver JSDoc do componente) — então
 * a miniatura de imagem paga o mesmo custo de segurança que abrir o anexo,
 * só que adiado até realmente aparecer na tela.
 */
function AttachmentThumb({ attachment }: { attachment: PMTaskAttachment }) {
  const kind = kindOf(attachment)
  const style = KIND_STYLE[kind]
  const extension = extensionOf(attachment.fileName)
  const [isVisible, setIsVisible] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (kind !== 'image' || isVisible) return
    const node = containerRef.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      // Ambiente sem suporte (ex.: alguns runners de teste) — não tenta
      // carregar a prévia; o bloco azul com o ícone segue sendo exibido.
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [kind, isVisible])

  useEffect(() => {
    if (!isVisible || !attachment.storagePath) return
    let cancelled = false
    downloadTaskAttachment(attachment.storagePath)
      .then((objectUrl) => { if (!cancelled) setPreviewUrl(objectUrl) })
      .catch(() => { /* falha silenciosa — mantém o bloco azul com o ícone */ })
    return () => { cancelled = true }
  }, [isVisible, attachment.storagePath])

  // Revoga a Object URL só quando o próprio componente desmonta (não a cada
  // re-render) — trocar de dependência para `[previewUrl]` revogaria a URL
  // ainda em uso pela <img> a cada patch de `attachments` vindo do pai.
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span
      ref={containerRef}
      className="flex items-center justify-center shrink-0 overflow-hidden"
      style={{ width: 44, height: 44, borderRadius: 8, background: style.bg, color: style.fg }}
    >
      {previewUrl ? (
        <img src={previewUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <KindMark kind={kind} extension={extension.toUpperCase()} />
      )}
    </span>
  )
}

/**
 * Lista de anexos + upload + exclusão do modal de tarefa da Pedagogia (ELO-3184
 * Fase 1). Os 240 anexos importados do Trello (e qualquer anexo novo enviado
 * pela UI) vivem em `pmoffice/pedagogia/tarefas/{taskId}/{fileName}`.
 *
 * Abrir um anexo NUNCA usa `getDownloadURL()` — o token é permanente e
 * não-autenticado, e os PDFs carregam dado pessoal de escola (endereço,
 * telefone, e-mail, INEP). Usa `getBlob()` (exige sessão autenticada válida
 * no momento) + `URL.createObjectURL`, ver `downloadTaskAttachment`.
 */
export function TaskAttachments({
  taskId,
  attachments,
  isEditable,
  onSaveField,
  openPickerSignal,
}: {
  taskId: string
  attachments: PMTaskAttachment[]
  /** Viewer (`!isEditable`) vê e abre anexos, mas não sobe nem exclui. */
  isEditable: boolean
  onSaveField: (patch: PMTaskPatch) => Promise<void>
  /**
   * Abre o seletor de arquivo do sistema quando este valor MUDA (não quando
   * é truthy — por isso é um contador incrementado a cada clique, não um
   * boolean: dois cliques seguidos no botão "Anexo" do pai precisam abrir o
   * seletor duas vezes, mesmo que o usuário cancele a primeira sem soltar
   * nenhum arquivo). `undefined`/sem mudança = não abre nada.
   */
  openPickerSignal?: number
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PMTaskAttachment | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleOpen(attachment: PMTaskAttachment) {
    if (!attachment.storagePath) return
    setOpenError(null)
    setOpeningId(attachment.id)
    try {
      const objectUrl = await downloadTaskAttachment(attachment.storagePath)
      window.open(objectUrl, '_blank', 'noopener,noreferrer')
      // Object URLs vivem até serem revogadas ou a aba fechar — revoga depois
      // de um tempo curto para não vazar memória caso o usuário abra vários
      // anexos na mesma sessão do modal, sem invalidar a aba recém-aberta
      // (que já carregou o blob no momento do open).
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err) {
      console.error('[TaskAttachments] falha ao abrir anexo', err)
      setOpenError(`Não foi possível abrir "${attachment.fileName}". Tente novamente.`)
    } finally {
      setOpeningId(null)
    }
  }

  function handlePickFiles() {
    fileInputRef.current?.click()
  }

  // Pílula "Anexo" do modo documento (PedagogiaDocumentBody) pede pra abrir
  // o seletor de arquivo direto, não só rolar até a seção — antes o clique
  // só levava até aqui e a pessoa precisava achar e clicar em "+ Anexar
  // arquivo" de novo, o que lia como "o botão não faz nada". `useEffect` com
  // guarda de primeiro render: sem ela, abriria o seletor sozinho assim que
  // o modal monta (openPickerSignal chega com seu valor inicial, não só nas
  // mudanças seguintes).
  // Guarda pelo VALOR com que o sinal nasceu, não por "é a primeira vez que
  // o efeito roda" — em dev, o StrictMode desmonta e remonta o componente de
  // propósito na montagem inicial, rodando este efeito duas vezes com o
  // MESMO valor de `openPickerSignal` (0 na primeira chamada real de
  // useState). Uma guarda de "primeira execução" (`useRef(true)` zerado no
  // próprio efeito) é consumida na 1ª chamada e falha silenciosamente na 2ª,
  // abrindo o seletor de arquivo sozinho ao abrir a tarefa — bug real
  // encontrado pelo Marcos. Comparar contra o valor inicial é imune a
  // quantas vezes o efeito roda: só dispara quando o número realmente muda
  // (ou seja, quando o botão "Anexo" é clicado de verdade).
  const initialPickerSignal = useRef(openPickerSignal)
  useEffect(() => {
    if (openPickerSignal === initialPickerSignal.current) return
    if (!isEditable) return
    handlePickFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPickerSignal])

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    setUploadError(null)

    // Validação síncrona ANTES de subir qualquer arquivo — falha rápida sem
    // round-trip ao Storage, e evita upload parcial de um lote onde o
    // primeiro arquivo é ok e o segundo estoura o teto.
    for (const file of files) {
      try {
        validateAttachmentFile(file)
      } catch (err) {
        setUploadError(err instanceof AttachmentRejectedError ? err.message : 'Arquivo inválido.')
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }

    setUploading(true)
    setUploadProgress(0)
    const controller = new AbortController()
    uploadAbortRef.current = controller

    try {
      // Sequencial (não Promise.all): cada upload precisa ver os anexos já
      // existentes + os que acabaram de ser adicionados NESTE lote, para
      // `dedupeFileName` desambiguar corretamente dois arquivos de mesmo nome
      // selecionados juntos (ex.: dois "foto.jpg" no mesmo picker).
      let currentAttachments = attachments
      const newAttachments: typeof attachments = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const dedupedName = dedupeFileName(file.name, currentAttachments)
        const { attachment } = await uploadTaskAttachment(
          taskId,
          file,
          dedupedName,
          (pct) => setUploadProgress(Math.round((i * 100 + pct) / files.length)),
          controller.signal,
        )
        currentAttachments = [...currentAttachments, attachment]
        newAttachments.push(attachment)
      }
      await onSaveField({ attachments: [...attachments, ...newAttachments] })
    } catch (err) {
      const code = (err as { code?: unknown })?.code
      if (code === 'storage/canceled') {
        setUploadError('Envio cancelado.')
      } else {
        console.error('[TaskAttachments] falha ao enviar anexo', err)
        setUploadError('Não foi possível enviar o arquivo. Tente novamente.')
      }
    } finally {
      setUploading(false)
      setUploadProgress(0)
      uploadAbortRef.current = null
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleCancelUpload() {
    uploadAbortRef.current?.abort()
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // Ordem OBRIGATÓRIA: Storage primeiro, Firestore depois. Se a exclusão
      // do Storage falhar, a entrada em `attachments` NÃO é removida — senão
      // o arquivo fica órfão (invisível na UI, mas continua existindo e
      // pagando armazenamento, sem nenhuma referência que permita achá-lo de
      // novo). Ver `deleteTaskAttachmentEntry` (testado isoladamente).
      if (deleteTarget.storagePath) {
        await deleteTaskAttachmentFile(deleteTarget.storagePath)
      }
      const next = attachments.filter((a) => a.id !== deleteTarget.id)
      await onSaveField({ attachments: next })
      setDeleteTarget(null)
    } catch (err) {
      console.error('[TaskAttachments] falha ao excluir anexo', err)
      setDeleteError('Não foi possível excluir o anexo. Tente novamente.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <p className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--eh-pm-modal-text)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        Anexos
      </p>

      {attachments.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--eh-text-3)' }}>Nenhum anexo nesta tarefa.</p>
      )}

      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Lista de anexos da tarefa">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-1"
              style={{ background: 'var(--eh-pm-neutral-surface)', borderRadius: 10 }}
            >
              {/* Linha inteira clicável (<button>, não <div onClick> — o gate de
                  UX já reprovou <div> fazendo esse papel nesta tela). Cobre
                  miniatura + nome + tamanho; o botão de excluir logo abaixo é
                  IRMÃO deste, não filho — <button> dentro de <button> não é
                  válido em HTML. */}
              <button
                type="button"
                onClick={() => handleOpen(attachment)}
                disabled={openingId === attachment.id || !attachment.storagePath}
                title={attachment.storagePath ? `Abrir ${attachment.fileName}` : 'Ainda não disponível — pendente de importação do Trello'}
                aria-label={`Abrir anexo ${attachment.fileName}`}
                className="eh-attachment-row flex-1 min-w-0 flex items-center gap-2.5 text-left"
                style={{
                  background: 'none',
                  border: 'none',
                  borderRadius: 10,
                  padding: '6px 8px',
                  cursor: attachment.storagePath ? 'pointer' : 'not-allowed',
                }}
              >
                <AttachmentThumb attachment={attachment} />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span
                    className="text-sm font-medium truncate"
                    style={{ color: attachment.storagePath ? 'var(--eh-pm-modal-text)' : 'var(--eh-text-3)' }}
                  >
                    {openingId === attachment.id ? `Abrindo "${attachment.fileName}"…` : attachment.fileName}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--eh-text-3)' }}>
                    {attachment.storagePath ? formatFileSize(attachment.sizeBytes) : 'Pendente de importação'}
                  </span>
                </span>
              </button>
              {isEditable && (
                <button
                  type="button"
                  onClick={() => { setDeleteTarget(attachment); setDeleteError(null) }}
                  title={`Excluir ${attachment.fileName}`}
                  aria-label={`Excluir anexo ${attachment.fileName}`}
                  className="shrink-0 inline-flex items-center justify-center mr-1.5"
                  style={{ width: 28, height: 28, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eh-text-3)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--eh-danger)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--eh-text-3)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {openError && (
        <p role="alert" className="text-xs mt-1" style={{ color: 'var(--eh-danger)' }}>{openError}</p>
      )}

      {isEditable && (
        <div className="mt-2">
          <label htmlFor={`attachment-input-${taskId}`} className="sr-only">
            Selecionar arquivos para anexar à tarefa
          </label>
          <input
            id={`attachment-input-${taskId}`}
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            onChange={(e) => void handleFilesSelected(e.target.files)}
            style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
          />
          {uploading ? (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--eh-text-2)' }}>
              <span role="status" aria-live="polite">Enviando… {uploadProgress}%</span>
              <button
                type="button"
                onClick={handleCancelUpload}
                className="underline"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--eh-text-2)' }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePickFiles}
              className="inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--eh-primary)' }}
            >
              + Anexar arquivo
            </button>
          )}
          {uploadError && (
            <p role="alert" className="text-xs mt-1" style={{ color: 'var(--eh-danger)' }}>{uploadError}</p>
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Excluir anexo"
          message={`Tem certeza que deseja excluir "${deleteTarget.fileName}"? Esta ação não pode ser desfeita.`}
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
