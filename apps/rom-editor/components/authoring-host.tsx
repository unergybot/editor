'use client'

import { nodeRegistry, useScene } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createTwoRoomFixture } from '../lib/fixture'
import { createHostSession } from '../lib/host-session'
import { RomEditor, snapshotScene } from './rom-editor'

function parseGraph(source: Uint8Array | null): SceneGraph {
  if (source === null) return createTwoRoomFixture()
  const graph = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source))
  if (
    !graph ||
    typeof graph !== 'object' ||
    !graph.nodes ||
    Array.isArray(graph.nodes) ||
    !Array.isArray(graph.rootNodeIds) ||
    Object.keys(graph.nodes).length > 10_000 ||
    (graph.installedPlugins &&
      (!Array.isArray(graph.installedPlugins) || graph.installedPlugins.length))
  )
    throw new Error('INVALID')
  for (const [id, value] of Object.entries(graph.nodes)) {
    const node = value as { id?: string; type?: string }
    if (
      !node ||
      node.id !== id ||
      !node.type ||
      !nodeRegistry.get(node.type)?.schema.safeParse(node).success
    )
      throw new Error('INVALID')
  }
  for (const id of graph.rootNodeIds)
    if (typeof id !== 'string' || !Object.hasOwn(graph.nodes, id)) throw new Error('INVALID')
  return graph
}

export function AuthoringHost({ parentOrigin }: { parentOrigin: string }) {
  const [graph, setGraph] = useState<SceneGraph | null>(null)
  const [readOnly, setReadOnly] = useState(true)
  const session = useRef<ReturnType<typeof createHostSession> | null>(null)
  const acknowledge = useRef<(() => void) | null>(null)
  const sidecar = useRef(new TextEncoder().encode('{}'))
  useEffect(() => {
    if (window.parent === window) return
    const host = createHostSession({
      parentOrigin,
      parent: window.parent,
      load: async (document) => {
        const parsed = parseGraph(document.source)
        useViewer.getState().setMetricNotation('meters')
        const metadata = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(document.sidecar),
        )
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
          throw new Error('INVALID')
        sidecar.current = new Uint8Array(document.sidecar)
        await new Promise<void>((resolve) => {
          acknowledge.current = resolve
          setGraph(parsed)
        })
      },
      snapshot: () => ({
        source: new TextEncoder().encode(JSON.stringify(snapshotScene())),
        sidecar: sidecar.current.slice(),
      }),
      setReadOnly: (value) => {
        useScene.getState().setReadOnly(value)
        setReadOnly(value)
      },
      select: (id) => {
        const nodes = useScene.getState().nodes
        if (!Object.hasOwn(nodes, id)) return
        let cursor: (typeof nodes)[keyof typeof nodes] | undefined = nodes[id as keyof typeof nodes]
        let buildingId: ReturnType<typeof useViewer.getState>['selection']['buildingId'] = null
        let levelId: ReturnType<typeof useViewer.getState>['selection']['levelId'] = null
        const visited = new Set<string>()
        while (cursor && !visited.has(cursor.id)) {
          visited.add(cursor.id)
          if (cursor.type === 'building') buildingId = cursor.id
          if (cursor.type === 'level') levelId = cursor.id
          cursor = cursor.parentId ? nodes[cursor.parentId as keyof typeof nodes] : undefined
        }
        useViewer.getState().setSelection({ buildingId, levelId, zoneId: null, selectedIds: [id] })
      },
    })
    session.current = host
    window.addEventListener('message', host.receiveBootstrap)
    return () => {
      window.removeEventListener('message', host.receiveBootstrap)
      host.dispose()
      session.current = null
      acknowledge.current = null
    }
  }, [parentOrigin])
  const load = useCallback(async () => graph, [graph])
  const save = useCallback(async () => {
    if (!session.current) throw new Error('DISPOSED')
    await session.current.save()
  }, [])
  const changed = useCallback(async () => {
    if (!session.current) throw new Error('DISPOSED')
    await session.current.changed()
  }, [])
  const hydrated = useCallback(() => {
    acknowledge.current?.()
    acknowledge.current = null
  }, [])
  if (!graph) return <main role="status">Waiting for Scene Composer…</main>
  return (
    <RomEditor
      projectId="rom-authoring"
      onLoad={load}
      onSave={save}
      onChange={changed}
      onHydrated={hydrated}
      readOnly={readOnly}
    />
  )
}
