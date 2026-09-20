'use client'

import { nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { Editor, type SceneGraph } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { useCallback, useEffect, useState } from 'react'

for (const definition of builtinPlugin.nodes ?? []) {
  if (!nodeRegistry.has(definition.kind)) registerNode(definition)
}

export interface RomEditorProps {
  projectId: string
  onLoad: () => Promise<SceneGraph | null>
  onSave: (scene: SceneGraph) => Promise<void>
  readOnly: boolean
}

export function RomEditor({ projectId, onLoad, onSave, readOnly }: RomEditorProps) {
  const [status, setStatus] = useState('Loading')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    useScene.getState().setReadOnly(readOnly)
    return () => useScene.getState().setReadOnly(false)
  }, [readOnly])
  const load = useCallback(async () => {
    const scene = await onLoad()
    setLoaded(true)
    setStatus('Loaded')
    return scene
  }, [onLoad])
  const save = useCallback(
    async (scene: SceneGraph) => {
      if (readOnly) throw new Error('Read-only session')
      setStatus('Saving')
      try {
        await onSave(scene)
        setStatus('Saved')
      } catch (error) {
        setStatus('Save failed; changes remain in this tab')
        throw error
      }
    },
    [onSave, readOnly],
  )
  const requestSave = useCallback(() => {
    if (!loaded || readOnly) return
    const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
    void save(
      structuredClone({ nodes, rootNodeIds, collections, materials, installedPlugins }),
    ).catch(() => {})
  }, [loaded, readOnly, save])
  return (
    <div style={{ height: '100%', position: 'relative' }}>
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
        onSave={save}
        guardAgainstSceneWipe
        onDirty={() => setStatus('Unsaved changes')}
        onSaveShortcut={() => {
          requestSave()
          return true
        }}
      />
    </div>
  )
}
