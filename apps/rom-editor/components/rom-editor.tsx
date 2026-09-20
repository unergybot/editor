'use client'

import { clearSceneHistory, nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { Editor, type SceneGraph } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { useCallback, useEffect, useRef, useState } from 'react'

for (const definition of builtinPlugin.nodes ?? []) {
  if (!nodeRegistry.has(definition.kind)) registerNode(definition)
}

export function snapshotScene(): SceneGraph {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return structuredClone({ nodes, rootNodeIds, collections, materials, installedPlugins })
}
export interface RomEditorProps {
  projectId: string
  onLoad: () => Promise<SceneGraph | null>
  onSave: (scene: SceneGraph) => Promise<void>
  onChange?: (scene: SceneGraph) => Promise<void>
  onHydrated?: () => void
  readOnly: boolean
}

export function RomEditor({
  projectId,
  onLoad,
  onSave,
  onChange,
  onHydrated,
  readOnly,
}: RomEditorProps) {
  const [status, setStatus] = useState('Loading')
  const [loaded, setLoaded] = useState(false)
  const hydrated = useRef(false)
  const loaderVisible = useRef(true)
  const requested = useRef<SceneGraph | null>(null)
  const emptyRestored = useRef(false)
  const latestChange = useRef<Promise<void>>(Promise.resolve())
  const generation = useRef(0)
  useEffect(() => {
    useScene.getState().setReadOnly(readOnly || !loaded)
    return () => useScene.getState().setReadOnly(true)
  }, [readOnly, loaded])
  const load = useCallback(async () => {
    hydrated.current = false
    loaderVisible.current = true
    requested.current = await onLoad()
    return requested.current
  }, [onLoad])
  const loaderChanged = useCallback(
    (visible: boolean) => {
      loaderVisible.current = visible
      if (visible || hydrated.current) return
      const state = useScene.getState()
      const graph = requested.current
      // Upstream treats an empty saved graph as a request for its default scene.
      if (
        graph &&
        !Object.keys(graph.nodes).length &&
        !graph.rootNodeIds.length &&
        !emptyRestored.current
      ) {
        emptyRestored.current = true
        state.setScene({}, [], {
          collections: graph.collections,
          materials: graph.materials,
          installedPlugins: [],
        } as Parameters<typeof state.setScene>[2])
        clearSceneHistory()
      }
      const completed = useScene.getState()
      if (!completed.hydrationId || completed.hydrationToken !== completed.hydrationId) return
      hydrated.current = true
      setLoaded(true)
      setStatus('Loaded')
      onHydrated?.()
    },
    [onHydrated],
  )
  useEffect(() => useScene.subscribe(() => loaderChanged(loaderVisible.current)), [loaderChanged])
  const save = useCallback(
    async (scene: SceneGraph) => {
      if (!hydrated.current || readOnly) throw new Error('Read-only session')
      const order = ++generation.current
      setStatus('Saving')
      try {
        await onSave(scene)
        if (order === generation.current) setStatus('Saved')
      } catch (error) {
        if (order === generation.current) setStatus('Save failed; changes remain in this tab')
        throw error
      }
    },
    [onSave, readOnly],
  )
  const requestSave = useCallback(() => {
    if (!hydrated.current || readOnly) return
    void save(snapshotScene()).catch(() => {})
  }, [readOnly, save])
  const dirty = useCallback(() => {
    if (!hydrated.current || readOnly) return
    const order = ++generation.current
    setStatus('Unsaved changes')
    if (onChange) {
      const pending = onChange(snapshotScene())
      latestChange.current = pending
      void pending.then(
        () => {
          if (order === generation.current) setStatus('Saved')
        },
        () => {
          if (order === generation.current) setStatus('Save failed; changes remain in this tab')
        },
      )
    }
  }, [onChange, readOnly])
  const automaticSave = useCallback(
    (scene: SceneGraph, options?: { keepalive?: boolean }) => {
      // The parent owns autosave; unloading must never create a second large write.
      if (options?.keepalive) return Promise.resolve()
      return onChange ? latestChange.current : save(scene)
    },
    [onChange, save],
  )
  return (
    <div style={{ height: '100%', position: 'relative', contain: 'layout', isolation: 'isolate' }}>
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: '40%',
          zIndex: 100,
          background: 'white',
          color: '#111',
          padding: 8,
        }}
      >
        <button disabled={!loaded || readOnly} onClick={requestSave} type="button">
          Save draft
        </button>
        <span role="status" style={{ marginLeft: 12 }}>
          {status}
        </span>
      </div>
      <Editor
        disablePostFx
        projectId={projectId}
        onLoad={load}
        onSave={automaticSave}
        guardAgainstSceneWipe
        onDirty={dirty}
        onLoaderChange={loaderChanged}
        onSaveShortcut={() => {
          requestSave()
          return true
        }}
      />
    </div>
  )
}
