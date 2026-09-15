/**
 * Anexos sem Storage. A validação (allowlist de mimetype + teto de 20 MB) e a
 * desambiguação de nome são a lógica REAL copiada do CoreHub — só a gravação
 * do binário muda: o arquivo vira uma `data:` URL guardada no store, indexada
 * pelo mesmo `storagePath` convencional do original.
 */

import type { PMTaskAttachment } from '../types/pmOffice'
import { getState, mutate, newId } from './store'

/** Mesmo teto do original (20 MiB). */
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024

export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.txt,.csv,application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/plain,text/csv'

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'text/csv',
])

export class AttachmentRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentRejectedError'
  }
}

export function validateAttachmentFile(file: File): void {
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    const maxMb = Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))
    throw new AttachmentRejectedError(`"${file.name}" excede o tamanho máximo de ${maxMb} MB.`)
  }
  // `File.type` vazio (browser não reconheceu) passa de propósito — a rejeição
  // só é firme quando o browser REPORTOU um mimetype fora da allowlist.
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new AttachmentRejectedError(`"${file.name}" tem um tipo de arquivo não permitido (${file.type}).`)
  }
}

export function dedupeFileName(fileName: string, existing: PMTaskAttachment[]): string {
  const existingNames = new Set(existing.map((a) => a.fileName))
  if (!existingNames.has(fileName)) return fileName

  const dotIndex = fileName.lastIndexOf('.')
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : ''

  let n = 2
  let candidate = `${base} (${n})${ext}`
  while (existingNames.has(candidate)) {
    n += 1
    candidate = `${base} (${n})${ext}`
  }
  return candidate
}

export function buildAttachmentStoragePath(taskId: string, fileName: string): string {
  return `pmoffice/pedagogia/tarefas/${taskId}/${fileName}`
}

export interface UploadTaskAttachmentResult {
  attachment: PMTaskAttachment
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'))
    reader.readAsDataURL(file)
  })
}

/**
 * "Sobe" o arquivo: lê como `data:` URL e guarda no store sob o `storagePath`
 * convencional. Devolve o `PMTaskAttachment` pronto para o chamador acrescentar
 * ao array `attachments` — não persiste o metadado, igual ao original.
 *
 * `onProgress` é chamado em 0 e 100 (o `FileReader` não expõe progresso
 * confiável para arquivo local, e o upload é instantâneo aqui). `signal`
 * aborta antes da gravação, rejeitando com `{ code: 'storage/canceled' }` — o
 * código que o `TaskAttachments` já reconhece.
 */
export async function uploadTaskAttachment(
  taskId: string,
  file: File,
  fileName: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadTaskAttachmentResult> {
  if (signal?.aborted) throw canceledError()
  onProgress?.(0)

  const dataUrl = await readAsDataUrl(file)
  if (signal?.aborted) throw canceledError()

  const storagePath = buildAttachmentStoragePath(taskId, fileName)
  mutate((draft) => {
    draft.attachmentBlobs[storagePath] = { dataUrl, mimeType: file.type || null }
  })
  onProgress?.(100)

  return {
    attachment: {
      id: newId('att'),
      fileName,
      mimeType: file.type || null,
      sizeBytes: file.size,
      storagePath,
      pendingTrelloDownload: false,
    },
  }
}

function canceledError(): Error & { code: string } {
  return Object.assign(new Error('Envio cancelado.'), { code: 'storage/canceled' })
}

/**
 * Devolve uma Object URL local — o `TaskAttachments` a usa em `window.open` e
 * como `src` de `<img>`, e revoga depois. Object URL (e não a `data:` URL crua)
 * porque `window.open` de `data:` é bloqueado pelos navegadores.
 */
export async function downloadTaskAttachment(storagePath: string): Promise<string> {
  const stored = getState().attachmentBlobs[storagePath]
  if (!stored) throw Object.assign(new Error('Anexo não encontrado.'), { code: 'storage/object-not-found' })
  const response = await fetch(stored.dataUrl)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

/** Objeto já ausente é sucesso silencioso, igual ao original. */
export async function deleteTaskAttachmentFile(storagePath: string): Promise<void> {
  mutate((draft) => {
    delete draft.attachmentBlobs[storagePath]
  })
}
