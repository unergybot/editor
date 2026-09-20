interface Readiness<T> {
  enter: () => () => void
  ready: () => boolean
  capture: () => T
  signal: AbortSignal
  deadlineMs?: number
}
export async function waitForNormalizationReady<T>(options: Readiness<T>): Promise<T> {
  const restore = options.enter()
  const end = performance.now() + (options.deadlineMs ?? 30_000)
  try {
    while (true) {
      if (options.signal.aborted) throw new Error('DISPOSED')
      if (performance.now() >= end) throw new Error('GEOMETRY_NOT_READY')
      if (options.ready()) return options.capture()
      await new Promise<void>((resolve) => setTimeout(resolve, 16))
    }
  } finally {
    restore()
  }
}

import type { SceneGraph } from '@pascal-app/editor'
import { Matrix4, type Object3D } from 'three'
import type { DraftDocuments } from './authoring-protocol'
import { sha256 } from './authoring-protocol'
import type { NormalizationSnapshot } from './normalization-types'

export async function captureNormalizationSnapshot(
  expected: { sourceSha256: string; sidecarSha256: string },
  signal: AbortSignal,
  readDocuments: () => DraftDocuments,
): Promise<NormalizationSnapshot> {
  const core = await import('@pascal-app/core')
  const viewer = await import('@pascal-app/viewer')
  const documents = readDocuments()
  const hashes = await Promise.all([sha256(documents.source), sha256(documents.sidecar)])
  if (hashes[0] !== expected.sourceSha256 || hashes[1] !== expected.sidecarSha256)
    throw new Error('SNAPSHOT_CHANGED')
  const graph = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(documents.source),
  ) as SceneGraph
  const sidecar: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(documents.sidecar),
  )
  const sourceNodes = core.useScene.getState().nodes
  const required = Object.values(sourceNodes).filter((node) =>
    ['site', 'building', 'level', 'wall', 'slab', 'block', 'door'].includes(node.type),
  )
  let captured: NormalizationSnapshot
  const release = core.acquireSceneReadOnlyLease()
  const previousMode = viewer.useViewer.getState().levelMode
  try {
    captured = await waitForNormalizationReady({
      signal,
      enter: () => {
        viewer.useViewer.getState().setLevelMode('stacked')
        return () => viewer.useViewer.getState().setLevelMode(previousMode)
      },
      ready: () => {
        const state = core.useScene.getState()
        if (state.nodes !== sourceNodes) throw new Error('SNAPSHOT_CHANGED')
        if (
          core.useLiveTransforms.getState().transforms.size ||
          core.useLiveNodeOverrides.getState().overrides.size ||
          viewer.getPendingWallRebuildCount()
        )
          return false
        const elevations = core.getLevelElevations(sourceNodes)
        for (const node of required) {
          const root = core.sceneRegistry.nodes.get(node.id)
          if (!root || state.dirtyNodes.has(node.id)) return false
          if (
            node.type === 'building' &&
            (node.position.some(
              (value, index) => Math.abs(root.position.toArray()[index]! - value) > 1e-7,
            ) ||
              node.rotation.some(
                (value, index) => Math.abs(Number(root.rotation.toArray()[index]) - value) > 1e-7,
              ))
          )
            return false
          if (
            node.type === 'level' &&
            Math.abs(root.position.y - (elevations.get(node.id)?.baseY ?? 0)) > 1e-7
          )
            return false
          if (node.type === 'wall') {
            const base = core.getWallBaseElevationForNodes(node, sourceNodes)
            if (
              Math.abs(root.position.y - base) > 1e-7 ||
              Math.abs(root.position.x - node.start[0]) > 1e-7 ||
              Math.abs(root.position.z - node.start[1]) > 1e-7 ||
              Math.abs(
                root.rotation.y +
                  Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0]),
              ) > 1e-7
            )
              return false
            const mesh = root as typeof root & { geometry?: { userData?: { built?: boolean } } }
            if (!mesh.geometry?.userData?.built) return false
          }
          if (node.type === 'block') {
            const position = core.getFloorStackedPosition({
              node,
              nodes: sourceNodes,
              position: node.position,
            })
            if (
              position.some(
                (value, index) => Math.abs(root.position.toArray()[index]! - value) > 1e-7,
              ) ||
              Math.abs(root.rotation.y - node.rotation) > 1e-7
            )
              return false
          }
        }
        return true
      },
      capture: () => {
        const worldMatrices: NormalizationSnapshot['worldMatrices'] = {},
          placements: NormalizationSnapshot['placements'] = {}
        for (const node of required) {
          const root = core.sceneRegistry.nodes.get(node.id)!
          root.updateWorldMatrix(true, false)
          // Compose actual local matrices, replacing only the level animation's
          // translation with its settled target. No authored value is rounded.
          const chain: Object3D[] = []
          for (let ancestor: Object3D | null = root; ancestor; ancestor = ancestor.parent)
            chain.unshift(ancestor)
          const matrix = new Matrix4()
          for (const ancestor of chain) {
            const local = ancestor.matrix.clone()
            const level = required.find(
              (candidate) =>
                candidate.type === 'level' &&
                core.sceneRegistry.nodes.get(candidate.id) === ancestor,
            )
            if (level)
              local.elements[13] = core.getLevelElevations(sourceNodes).get(level.id)?.baseY ?? 0
            matrix.multiply(local)
          }
          worldMatrices[node.id] = [...matrix.elements]
          placements[node.id] =
            node.type === 'wall'
              ? {
                  baseElevation: core.getWallBaseElevationForNodes(node, sourceNodes),
                  height: core.getWallEffectiveHeightForNodes(node, sourceNodes),
                }
              : { baseElevation: root.position.y }
        }
        return { ...expected, graph, sidecar, worldMatrices, placements }
      },
    })
    const after = readDocuments()
    const finalHashes = await Promise.all([sha256(after.source), sha256(after.sidecar)])
    if (signal.aborted) throw new Error('DISPOSED')
    if (finalHashes[0] !== expected.sourceSha256 || finalHashes[1] !== expected.sidecarSha256)
      throw new Error('SNAPSHOT_CHANGED')
    return captured
  } finally {
    release()
  }
}
