import {
  cloneDocuments,
  type DraftDocuments,
  type Envelope,
  isAuthoringEnvelope,
  type Payloads,
  packet,
} from './authoring-protocol'

type Load = Extract<Payloads['LOAD'], { phase: 'DOCUMENT' }>
interface Options {
  parentOrigin: string
  parent: Pick<Window, 'postMessage'>
  load: (document: Load) => Promise<void>
  snapshot: () => DraftDocuments
  setReadOnly: (value: boolean) => void
  select: (sourceId: string) => void
  normalize?: (expected: Payloads['NORMALIZE'], signal: AbortSignal) => Promise<Uint8Array>
}
export function createHostSession(options: Options) {
  let nonce = '',
    helloId = '',
    disposed = false,
    loaded = false,
    normalizing = false,
    readOnly = true
  let port: MessagePort | undefined
  const normalizationAbort = new AbortController()
  const seen = new Set<string>()
  const pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  function send(message: Envelope) {
    if (!disposed) port?.postMessage(message)
  }
  function rejectPending(code: string) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(code))
    }
    pending.clear()
  }
  async function receive(event: MessageEvent) {
    if (disposed || !isAuthoringEnvelope(event.data) || event.data.sessionId !== nonce) return
    const message = event.data
    const awaiting = pending.get(message.requestId)
    if (awaiting) {
      if (message.type !== 'SAVED' && message.type !== 'SAVE_FAILED') return
      clearTimeout(awaiting.timer)
      pending.delete(message.requestId)
      if (message.type === 'SAVED') awaiting.resolve()
      else awaiting.reject(new Error(message.payload.code))
      return
    }
    if (seen.has(message.requestId) || seen.size >= 100_000) return
    seen.add(message.requestId)
    try {
      if (message.type === 'LOAD') {
        if (message.payload.phase === 'ACCESS') {
          readOnly = message.payload.readOnly
          options.setReadOnly(readOnly || normalizing)
          if (readOnly) rejectPending('DENIED')
        } else if (message.payload.phase === 'DOCUMENT' && !loaded) {
          // Keep edits locked until the store has finished hydrating the exact document.
          options.setReadOnly(true)
          await options.load(message.payload)
          if (disposed) return
          readOnly = message.payload.readOnly
          loaded = true
          options.setReadOnly(readOnly)
          send(packet(nonce, message.requestId, 'LOAD', { phase: 'ACK' }))
        }
      } else if (loaded && message.type === 'SAVE' && 'phase' in message.payload) {
        if (readOnly) throw new Error('DENIED')
        send(packet(nonce, message.requestId, 'SAVE', cloneDocuments(options.snapshot())))
      } else if (loaded && message.type === 'SELECT') options.select(message.payload.sourceId)
      else if (message.type === 'NORMALIZE') {
        if (!loaded || normalizing || !options.normalize) {
          send(packet(nonce, message.requestId, 'ERROR', { code: 'UNAVAILABLE' }))
          return
        }
        normalizing = true
        options.setReadOnly(true)
        try {
          const result = await options.normalize(message.payload, normalizationAbort.signal)
          send(packet(nonce, message.requestId, 'NORMALIZED', { ...message.payload, result }))
        } finally {
          normalizing = false
          if (!disposed) options.setReadOnly(readOnly)
        }
      }
    } catch {
      send(
        packet(nonce, message.requestId, 'ERROR', {
          code: readOnly && loaded ? 'DENIED' : 'INVALID',
        }),
      )
    }
  }
  function change(type: 'CHANGED' | 'SAVE'): Promise<void> {
    if (disposed || !loaded || readOnly || normalizing)
      return Promise.reject(new Error(disposed ? 'DISPOSED' : 'DENIED'))
    const id = crypto.randomUUID()
    let message: Envelope
    try {
      message = packet(nonce, id, type, cloneDocuments(options.snapshot()))
    } catch {
      return Promise.reject(new Error('INVALID'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('TIMEOUT'))
      }, 180_000)
      pending.set(id, { resolve, reject, timer })
      send(message)
    })
  }
  return {
    receiveBootstrap(event: MessageEvent) {
      if (
        disposed ||
        port ||
        event.origin !== options.parentOrigin ||
        event.source !== options.parent ||
        !isAuthoringEnvelope(event.data)
      )
        return
      const message = event.data
      if (message.type !== 'READY') return
      if (message.payload.phase === 'HELLO' && !event.ports.length) {
        nonce = message.sessionId
        helloId = message.requestId
        options.parent.postMessage(
          packet(nonce, helloId, 'READY', { phase: 'READY' }),
          options.parentOrigin,
        )
      } else if (
        message.payload.phase === 'CONNECT' &&
        message.sessionId === nonce &&
        message.requestId === helloId &&
        event.ports.length === 1
      ) {
        const transferred = event.ports[0]
        if (!transferred) return
        port = transferred
        transferred.onmessage = (event) => {
          void receive(event)
        }
        transferred.start()
        send(packet(nonce, helloId, 'READY', { phase: 'CONNECTED' }))
      }
    },
    changed: () => change('CHANGED'),
    save: () => change('SAVE'),
    dispose() {
      if (disposed) return
      disposed = true
      loaded = false
      normalizationAbort.abort()
      port?.close()
      rejectPending('DISPOSED')
      seen.clear()
      options.setReadOnly(true)
    },
  }
}
