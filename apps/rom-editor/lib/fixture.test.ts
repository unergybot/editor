import { expect, test } from 'bun:test'
import { createTwoRoomFixture } from './fixture'

test('two-room fixture preserves the doorway and calibration geometry on round trip', () => {
  const graph = createTwoRoomFixture()
  const restored = JSON.parse(JSON.stringify(graph))
  expect(restored.nodes.door_passage).toMatchObject({
    parentId: 'wall_partition',
    openingKind: 'opening',
    width: 1.5,
    height: 2.2,
  })
  expect(restored.nodes.wall_partition.children).toContain('door_passage')
  expect(restored.nodes.block_calibration.position).toEqual([2, 0, 2])
  expect(restored.nodes.slab_floor).toMatchObject({ elevation: 0, thickness: 0.2 })
  expect(restored.rootNodeIds).toEqual(['site_rom'])
  for (const node of Object.values(restored.nodes) as { id: string; parentId: string | null }[]) {
    if (node.parentId) expect(restored.nodes[node.parentId]).toBeDefined()
  }
})

test('editing one fresh fixture cannot mutate another', () => {
  const first = createTwoRoomFixture()
  const second = createTwoRoomFixture()
  first.nodes.block_calibration.name = 'Changed'
  expect(second.nodes.block_calibration.name).toBe('Calibration box')
})
