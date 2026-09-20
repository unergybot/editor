import { expect, test } from 'bun:test'
import { EDITOR_COMMIT, packet } from './authoring-protocol'
import { createHostSession } from './host-session'

const origin = 'http://localhost:4182'
const pause = () => new Promise((resolve) => setTimeout(resolve, 10))
test('bootstrap binds the exact parent and waits for hydration before acknowledging', async () => {
  const replies: unknown[] = []
  const parent = { postMessage: (message: unknown) => replies.push(message) }
  let hydrate!: () => void
  const host = createHostSession({
    parentOrigin: origin,
    parent: parent as unknown as Window,
    load: () =>
      new Promise<void>((resolve) => {
        hydrate = resolve
      }),
    snapshot: () => ({
      source: new TextEncoder().encode('{}'),
      sidecar: new TextEncoder().encode('{}'),
    }),
    setReadOnly: () => {},
    select: () => {},
  })
  const hello = packet('session', 'hello', 'READY', { phase: 'HELLO' })
  const event = (data: unknown, source = parent, from = origin, ports: MessagePort[] = []) =>
    ({ data, source, origin: from, ports }) as unknown as MessageEvent
  host.receiveBootstrap(event(hello, parent, 'https://wrong.example'))
  host.receiveBootstrap(event(hello, { postMessage: () => {} }))
  expect(replies).toHaveLength(0)
  host.receiveBootstrap(event(hello))
  expect(replies).toHaveLength(1)
  const channel = new MessageChannel()
  const received: any[] = []
  channel.port1.onmessage = (e) => received.push(e.data)
  host.receiveBootstrap(
    event(packet('session', 'hello', 'READY', { phase: 'CONNECT' }), parent, origin, [
      channel.port2,
    ]),
  )
  await pause()
  channel.port1.postMessage(
    packet('session', 'load', 'LOAD', {
      phase: 'DOCUMENT',
      source: null,
      sidecar: new TextEncoder().encode('{}'),
      editorCommit: EDITOR_COMMIT,
      readOnly: false,
    }),
  )
  await pause()
  expect(received.some((m) => m.type === 'LOAD')).toBe(false)
  hydrate()
  await pause()
  expect(received.some((m) => m.type === 'LOAD' && m.payload.phase === 'ACK')).toBe(true)
  const changed = host.changed()
  await pause()
  const message = received.find((m) => m.type === 'CHANGED')
  channel.port1.postMessage(packet('wrong', message.requestId, 'SAVE_FAILED', { code: 'FAILED' }))
  channel.port1.postMessage(
    packet('session', message.requestId, 'SAVE_FAILED', { code: 'CONFLICT' }),
  )
  await expect(changed).rejects.toThrow('CONFLICT')
  host.dispose()
  channel.port1.close()
})

import { isAuthoringEnvelope } from './authoring-protocol'
import examples from './authoring-protocol.examples.json'

test('matches the shared committed protocol examples', () => {
  for (const example of examples) expect(isAuthoringEnvelope(example.message)).toBe(example.valid)
})
