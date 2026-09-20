export const PROTOCOL = 'rom.authoring/v1' as const
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
export const EDITOR_COMMIT = '73e578913c40419b3c637cb7f5f46a7b526c0057'
export interface DraftDocuments {
  source: Uint8Array
  sidecar: Uint8Array
}
export interface SavedDraft {
  version: string
  editorCommit: string
  sourceSha256: string
  sidecarSha256: string
}
export type FailureCode =
  | 'CONFLICT'
  | 'DENIED'
  | 'INVALID'
  | 'UNAVAILABLE'
  | 'DISPOSED'
  | 'TIMEOUT'
  | 'FAILED'
export type Payloads = {
  READY: { phase: 'HELLO' | 'READY' | 'CONNECT' | 'CONNECTED' }
  LOAD:
    | {
        phase: 'DOCUMENT'
        source: Uint8Array | null
        sidecar: Uint8Array
        readOnly: boolean
        editorCommit: string
      }
    | { phase: 'ACK' }
    | { phase: 'ACCESS'; readOnly: boolean }
  CHANGED: DraftDocuments
  SAVE: DraftDocuments | { phase: 'REQUEST' }
  SAVED: SavedDraft
  SAVE_FAILED: { code: FailureCode }
  NORMALIZE: { sourceSha256: string; sidecarSha256: string }
  NORMALIZED: { sourceSha256: string; sidecarSha256: string; result: Uint8Array }
  SELECT: { sourceId: string }
  ERROR: { code: FailureCode }
}
export type Envelope = {
  [K in keyof Payloads]: {
    protocol: typeof PROTOCOL
    sessionId: string
    requestId: string
    type: K
    payload: Payloads[K]
  }
}[keyof Payloads]
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, fields: string[]): boolean => {
  const keys = Object.keys(value)
  return keys.length === fields.length && keys.every((key) => fields.includes(key))
}
const text = (value: unknown, limit = 128): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= limit
const hash = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const bytes = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) &&
  Object.prototype.toString.call(value) === '[object Uint8Array]' &&
  value.byteLength > 0 &&
  value.byteLength <= MAX_DOCUMENT_BYTES &&
  value.byteOffset === 0 &&
  Object.prototype.toString.call(value.buffer) === '[object ArrayBuffer]' &&
  value.buffer.byteLength === value.byteLength
const documents = (value: Record<string, unknown>): boolean =>
  exact(value, ['source', 'sidecar']) && bytes(value.source) && bytes(value.sidecar)
const failure = (value: Record<string, unknown>): boolean =>
  exact(value, ['code']) &&
  typeof value.code === 'string' &&
  ['CONFLICT', 'DENIED', 'INVALID', 'UNAVAILABLE', 'DISPOSED', 'TIMEOUT', 'FAILED'].includes(
    value.code,
  )
export function isAuthoringEnvelope(value: unknown): value is Envelope {
  if (
    !object(value) ||
    !exact(value, ['protocol', 'sessionId', 'requestId', 'type', 'payload']) ||
    value.protocol !== PROTOCOL ||
    !text(value.sessionId) ||
    !text(value.requestId) ||
    !object(value.payload)
  )
    return false
  const p = value.payload
  switch (value.type) {
    case 'READY':
      return (
        exact(p, ['phase']) &&
        typeof p.phase === 'string' &&
        ['HELLO', 'READY', 'CONNECT', 'CONNECTED'].includes(p.phase)
      )
    case 'LOAD':
      if (p.phase === 'ACK') return exact(p, ['phase'])
      if (p.phase === 'ACCESS')
        return exact(p, ['phase', 'readOnly']) && typeof p.readOnly === 'boolean'
      return (
        p.phase === 'DOCUMENT' &&
        exact(p, ['phase', 'source', 'sidecar', 'readOnly', 'editorCommit']) &&
        (p.source === null || bytes(p.source)) &&
        bytes(p.sidecar) &&
        typeof p.readOnly === 'boolean' &&
        p.editorCommit === EDITOR_COMMIT
      )
    case 'CHANGED':
      return documents(p)
    case 'SAVE':
      return documents(p) || (exact(p, ['phase']) && p.phase === 'REQUEST')
    case 'SAVED':
      return (
        exact(p, ['version', 'editorCommit', 'sourceSha256', 'sidecarSha256']) &&
        typeof p.version === 'string' &&
        /^[1-9][0-9]{0,18}$/.test(p.version) &&
        BigInt(p.version) <= 9223372036854775807n &&
        p.editorCommit === EDITOR_COMMIT &&
        hash(p.sourceSha256) &&
        hash(p.sidecarSha256)
      )
    case 'SAVE_FAILED':
    case 'ERROR':
      return failure(p)
    case 'SELECT':
      return exact(p, ['sourceId']) && text(p.sourceId, 256)
    case 'NORMALIZE':
      return (
        exact(p, ['sourceSha256', 'sidecarSha256']) && hash(p.sourceSha256) && hash(p.sidecarSha256)
      )
    case 'NORMALIZED':
      return (
        exact(p, ['sourceSha256', 'sidecarSha256', 'result']) &&
        hash(p.sourceSha256) &&
        hash(p.sidecarSha256) &&
        bytes(p.result)
      )
    default:
      return false
  }
}
export function packet<K extends keyof Payloads>(
  sessionId: string,
  requestId: string,
  type: K,
  payload: Payloads[K],
): Envelope {
  const value = { protocol: PROTOCOL, sessionId, requestId, type, payload }
  if (!isAuthoringEnvelope(value)) throw new Error('INVALID')
  return value
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
export function cloneDocuments(value: DraftDocuments): DraftDocuments {
  return { source: value.source.slice(), sidecar: value.sidecar.slice() }
}
