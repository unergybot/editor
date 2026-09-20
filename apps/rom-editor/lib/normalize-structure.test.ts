import { expect, test } from 'bun:test'
import { Matrix4 } from 'three'
import { createTwoRoomFixture } from './fixture'
import { normalizeStructure, pascalToRom, rigidYawTransform } from './normalize-structure'

test('Y-up to Z-up is a proper rotation and rejects unsupported affine transforms', () => {
  expect(pascalToRom([2, 3, 4])).toEqual([2, -4, 3])
  expect(new Matrix4().makeRotationX(Math.PI / 2).determinant()).toBeCloseTo(1)
  expect(rigidYawTransform(new Matrix4().makeRotationY(0.4).elements).yaw).toBeCloseTo(0.4)
  for (const matrix of [
    new Matrix4().makeScale(2, 1, 1),
    new Matrix4().makeScale(-1, 1, 1),
    new Matrix4().makeRotationX(0.1),
    new Matrix4().makeShear(0.1, 0, 0, 0, 0, 0),
  ]) {
    expect(() => rigidYawTransform(matrix.elements)).toThrow('UNSUPPORTED_TRANSFORM')
  }
})

test('fixture opening is centered on the partition, in its wall-local frame', () => {
  const graph = createTwoRoomFixture()
  const door = graph.nodes.door_passage as { position: number[] }
  expect(door.position).toEqual([3, 1.1, 0])
})

test('incomplete robotics metadata produces source-linked findings instead of guessed physics', () => {
  const graph = createTwoRoomFixture()
  const result = normalizeStructure({
    graph,
    sidecar: {},
    sourceSha256: 'a'.repeat(64),
    sidecarSha256: 'b'.repeat(64),
    worldMatrices: {},
    placements: {},
  })
  expect(result.findings.some((item) => item.code === 'MISSING_NAVIGATION')).toBe(true)
  expect(
    result.findings.some(
      (item) => item.sourceObjectId === 'block_calibration' && item.code === 'UNREVIEWED_ROLE',
    ),
  ).toBe(true)
})

function supportedSnapshot() {
  const graph = createTwoRoomFixture()
  const worldMatrices: Record<string, number[]> = {},
    placements: Record<string, { baseElevation: number; height?: number }> = {}
  const roles: Record<string, string> = {}
  for (const [id, value] of Object.entries(graph.nodes)) {
    const node = value as {
      type: string
      position?: [number, number, number]
      start?: number[]
      end?: number[]
      height?: number
    }
    const matrix = new Matrix4()
    if (node.type === 'block') matrix.makeTranslation(...node.position!)
    if (node.type === 'wall') {
      matrix.makeRotationY(
        -Math.atan2(node.end![1]! - node.start![1]!, node.end![0]! - node.start![0]!),
      )
      matrix.setPosition(node.start![0]!, 0, node.start![1]!)
      placements[id] = { baseElevation: 0, height: node.height }
    }
    worldMatrices[id] = matrix.elements
    if (node.type === 'wall' || node.type === 'block') roles[id] = 'STATIC_SOLID'
    if (node.type === 'slab') roles[id] = 'SUPPORT_SURFACE'
  }
  return {
    graph,
    worldMatrices,
    placements,
    sourceSha256: 'a'.repeat(64),
    sidecarSha256: 'b'.repeat(64),
    sidecar: {
      schemaVersion: 'rom.robotics/v1alpha1',
      roles,
      navigation: {
        supportSourceObjectId: 'slab_floor',
        minimumXY: [0, -6],
        maximumXY: [10, 0],
        robotHeightM: 0.6,
        verticalMarginM: 0.1,
        footprintRadiusM: 0.35,
        horizontalMarginM: 0.1,
        markers: [
          { id: '1', kind: 'ROBOT_SPAWN', frame: 'ROM_SCENE', position: [2, -3, 0], yawRadians: 0 },
          { id: '2', kind: 'HOME', frame: 'ROM_SCENE', position: [2, -4, 0], yawRadians: 0 },
          { id: '3', kind: 'TOUR_POINT', frame: 'ROM_SCENE', position: [7, -3, 0], yawRadians: 0 },
        ],
      },
    },
  }
}

test('emits open doorway sections, downward slab thickness and stable component identities', () => {
  const result = normalizeStructure(supportedSnapshot())
  expect(result.findings).toEqual([])
  const partition = result.structure.objects.find(
    (object) => object.sourceObjectId === 'wall_partition',
  )!
  expect(partition.parts).toHaveLength(3)
  const lintel = partition.parts.find((part) => part.partId === 'door_passage-lintel')!
  expect(lintel.center[0]).toBeCloseTo(5)
  expect(lintel.center[1]).toBeCloseTo(-3)
  expect(lintel.center[2]).toBeCloseTo(2.6)
  expect(lintel.size[0]).toBeCloseTo(1.5)
  expect(lintel.size[2]).toBeCloseTo(0.8)
  const slab = result.structure.objects.find((object) => object.sourceObjectId === 'slab_floor')!
    .parts[0]!
  expect(slab.center).toEqual([5, -3, -0.1])
  expect(slab.size).toEqual([10, 6, 0.2])
  expect(
    result.structure.objects.find((object) => object.sourceObjectId === 'block_table_leg_0_0')!
      .parts[0]!.partId,
  ).toBe('body')
  expect(result.sourceObjectIds).toContain('block_table_top')
})

test('uses the resolved parent transform without losing the floor lift', () => {
  const snapshot = supportedSnapshot()
  const parent = new Matrix4().makeTranslation(20, 2, -7)
  for (const [id, matrix] of Object.entries(snapshot.worldMatrices))
    snapshot.worldMatrices[id] = parent.clone().multiply(new Matrix4().fromArray(matrix)).elements
  const calibration = normalizeStructure(snapshot).structure.objects.find(
    (object) => object.sourceObjectId === 'block_calibration',
  )!.parts[0]!
  expect(calibration.center).toEqual([22, 5, 2.5])
  expect(calibration.size).toEqual([1, 1, 1])
})

test('rejects a deformed box instead of silently using its bounding box', () => {
  const snapshot = supportedSnapshot()
  const block = snapshot.graph.nodes.block_calibration as {
    topology: { vertices: { position: number[] }[] }
  }
  block.topology.vertices[0]!.position[0] = -0.4
  const result = normalizeStructure(snapshot)
  expect(
    result.findings.some(
      (finding) =>
        finding.code === 'UNSUPPORTED_TOPOLOGY' && finding.sourceObjectId === 'block_calibration',
    ),
  ).toBe(true)
  expect(
    result.structure.objects.some((object) => object.sourceObjectId === 'block_calibration'),
  ).toBe(false)
})

test('unsupported physical nodes require an explicit visual-only choice', () => {
  const snapshot = supportedSnapshot()
  snapshot.graph.nodes.roof_test = { id: 'roof_test', type: 'roof' }
  snapshot.worldMatrices.roof_test = new Matrix4().elements
  snapshot.sidecar.roles.roof_test = 'STATIC_SOLID'
  expect(
    normalizeStructure(snapshot).findings.some((finding) => finding.sourceObjectId === 'roof_test'),
  ).toBe(true)
  snapshot.sidecar.roles.roof_test = 'VISUAL_ONLY'
  expect(normalizeStructure(snapshot).findings).toEqual([])
})

test('corner colliders cover the rendered orthogonal miter without corner gaps', () => {
  const result = normalizeStructure(supportedSnapshot())
  const south = result.structure.objects.find((object) => object.sourceObjectId === 'wall_south')!
  expect(south.parts[0]!.size[0]).toBeCloseTo(10.2)
  expect(south.parts[0]!.center[0]).toBeCloseTo(5)
})

test('unknown sidecar versions and terrain cannot silently become validated physics', () => {
  const snapshot = supportedSnapshot()
  snapshot.sidecar.schemaVersion = 'future'
  expect(normalizeStructure(snapshot).findings.some((f) => f.code === 'UNSUPPORTED_SIDECAR')).toBe(
    true,
  )
  snapshot.sidecar.schemaVersion = 'rom.robotics/v1alpha1'
  ;(snapshot.graph.nodes.site_rom as any).terrain = { enabled: true }
  expect(normalizeStructure(snapshot).findings.some((f) => f.sourceObjectId === 'site_rom')).toBe(
    true,
  )
})

test('navigation serialization excludes arbitrary metadata and requires all marker kinds', () => {
  const snapshot = supportedSnapshot()
  Object.assign(snapshot.sidecar.navigation.markers[0]!, { extra: 'not a compiler field' })
  expect(normalizeStructure(snapshot).structure.navigation!.anchors[0]).not.toHaveProperty('extra')
  snapshot.sidecar.navigation.markers = snapshot.sidecar.navigation.markers.filter(
    (m) => m.kind !== 'HOME',
  )
  expect(normalizeStructure(snapshot).findings.some((f) => f.code === 'INVALID_NAVIGATION')).toBe(
    true,
  )
})

test('rejects doorways outside the wall and overlapping openings', () => {
  const snapshot = supportedSnapshot()
  const door = snapshot.graph.nodes.door_passage as { position: number[] }
  door.position[0] = 0
  expect(normalizeStructure(snapshot).findings.some((f) => f.code === 'UNSUPPORTED_OPENING')).toBe(
    true,
  )
  door.position[0] = 3
  snapshot.graph.nodes.door_second = {
    ...(snapshot.graph.nodes.door_passage as object),
    id: 'door_second',
  }
  ;(snapshot.graph.nodes.wall_partition as { children: string[] }).children.push('door_second')
  expect(normalizeStructure(snapshot).findings.some((f) => f.code === 'OVERLAPPING_OPENINGS')).toBe(
    true,
  )
})

test('an oblique joined wall cannot use an oversized rectangular miter approximation', () => {
  const snapshot = supportedSnapshot()
  ;(snapshot.graph.nodes.wall_east as { end: number[] }).end = [9, 6]
  expect(
    normalizeStructure(snapshot).findings.some(
      (f) => f.code === 'UNSUPPORTED_WALL_JUNCTION' && f.sourceObjectId === 'wall_south',
    ),
  ).toBe(true)
})
