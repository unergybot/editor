import {
  BlockNode,
  calculateLevelMiters,
  DoorNode,
  getWallPlanFootprint,
  getWallThickness,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import type {
  NormalizationResult,
  NormalizationSnapshot,
  PhysicalRole,
  RoboticsSidecar,
  StructurePart,
  Vec3,
} from './normalization-types'

const EPS = 1e-8
export function pascalToRom(p: Vec3): Vec3 {
  return [p[0], -p[2], p[1]]
}
export function rigidYawTransform(matrix: number[]) {
  if (
    matrix.length !== 16 ||
    matrix.some((value) => !Number.isFinite(value)) ||
    Math.abs(matrix[3]!) > EPS ||
    Math.abs(matrix[7]!) > EPS ||
    Math.abs(matrix[11]!) > EPS ||
    Math.abs(matrix[15]! - 1) > EPS
  )
    throw new Error('UNSUPPORTED_TRANSFORM')
  const x = [matrix[0]!, matrix[1]!, matrix[2]!],
    y = [matrix[4]!, matrix[5]!, matrix[6]!],
    z = [matrix[8]!, matrix[9]!, matrix[10]!]
  const dot = (a: number[], b: number[]) =>
    a.reduce((sum, value, index) => sum + value * b[index]!, 0)
  const determinant =
    x[0]! * (y[1]! * z[2]! - y[2]! * z[1]!) -
    y[0]! * (x[1]! * z[2]! - x[2]! * z[1]!) +
    z[0]! * (x[1]! * y[2]! - x[2]! * y[1]!)
  if (
    [x, y, z].some((axis) => Math.abs(dot(axis, axis) - 1) > EPS) ||
    Math.abs(dot(x, y)) > EPS ||
    Math.abs(dot(x, z)) > EPS ||
    Math.abs(dot(y, z)) > EPS ||
    Math.abs(determinant - 1) > EPS ||
    Math.abs(y[0]!) > EPS ||
    Math.abs(y[1]! - 1) > EPS ||
    Math.abs(y[2]!) > EPS
  )
    throw new Error('UNSUPPORTED_TRANSFORM')
  return {
    yaw: Math.atan2(-matrix[2]!, matrix[0]!),
    point: (p: Vec3): Vec3 =>
      pascalToRom([
        matrix[0]! * p[0] + matrix[4]! * p[1] + matrix[8]! * p[2] + matrix[12]!,
        matrix[1]! * p[0] + matrix[5]! * p[1] + matrix[9]! * p[2] + matrix[13]!,
        matrix[2]! * p[0] + matrix[6]! * p[1] + matrix[10]! * p[2] + matrix[14]!,
      ]),
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown, low = -1_000_000, high = 1_000_000): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
function boxPart(
  partId: string,
  role: 'STATIC_SOLID' | 'SUPPORT_SURFACE',
  local: Vec3,
  size: Vec3,
  matrix: number[],
): StructurePart {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: compiler identities reject control characters
  if (!partId || partId.length > 128 || /[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u.test(partId))
    throw new Error('INVALID_PART_ID')
  if (size.some((value) => !finite(value, 0.001))) throw new Error('INVALID_DIMENSIONS')
  const transform = rigidYawTransform(matrix),
    center = transform.point(local)
  const dimensions: Vec3 = [size[0], size[2], size[1]]
  const c = Math.abs(Math.cos(transform.yaw)),
    s = Math.abs(Math.sin(transform.yaw))
  const extent = [
    (c * dimensions[0] + s * dimensions[1]) / 2,
    (s * dimensions[0] + c * dimensions[1]) / 2,
    dimensions[2] / 2,
  ]
  if (center.some((value, index) => !finite(value) || Math.abs(value) + extent[index]! > 1_000_000))
    throw new Error('INVALID_DIMENSIONS')
  return { partId, role, center, size: dimensions, yawRadians: transform.yaw }
}
function blockParts(raw: unknown, matrix: number[]): StructurePart[] {
  const node = BlockNode.parse(raw),
    topology = node.topology
  if (topology.vertices.length !== 8 || topology.edges.length !== 12 || topology.faces.length !== 6)
    throw new Error('UNSUPPORTED_TOPOLOGY')
  const minimum = [0, 1, 2].map((axis) =>
    Math.min(...topology.vertices.map((vertex) => vertex.position[axis]!)),
  )
  const maximum = [0, 1, 2].map((axis) =>
    Math.max(...topology.vertices.map((vertex) => vertex.position[axis]!)),
  )
  const corners = new Set<string>()
  for (const vertex of topology.vertices) {
    const mask = vertex.position.map((value, axis) =>
      Math.abs(value - minimum[axis]!) <= EPS
        ? 0
        : Math.abs(value - maximum[axis]!) <= EPS
          ? 1
          : -1,
    )
    if (mask.includes(-1)) throw new Error('UNSUPPORTED_TOPOLOGY')
    corners.add(mask.join(''))
  }
  if (corners.size !== 8) throw new Error('UNSUPPORTED_TOPOLOGY')
  const vertices = new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
  const planes = new Set<string>()
  for (const face of topology.faces) {
    if (face.vertexIds.length !== 4 || new Set(face.vertexIds).size !== 4)
      throw new Error('UNSUPPORTED_TOPOLOGY')
    const points = face.vertexIds.map((id) => vertices.get(id)!)
    const axis = [0, 1, 2].find((axis) =>
      points.every((point) => Math.abs(point[axis]! - points[0]![axis]!) <= EPS),
    )
    if (axis === undefined) throw new Error('UNSUPPORTED_TOPOLOGY')
    planes.add(`${axis}:${points[0]![axis]}`)
    for (let i = 0; i < 4; i++)
      if (
        [0, 1, 2].filter((a) => Math.abs(points[i]![a]! - points[(i + 1) % 4]![a]!) > EPS)
          .length !== 1
      )
        throw new Error('UNSUPPORTED_TOPOLOGY')
  }
  if (planes.size !== 6) throw new Error('UNSUPPORTED_TOPOLOGY')
  return [
    boxPart(
      'body',
      'STATIC_SOLID',
      minimum.map((value, axis) => (value + maximum[axis]!) / 2) as Vec3,
      maximum.map((value, axis) => value - minimum[axis]!) as Vec3,
      matrix,
    ),
  ]
}
export function normalizeStructure(snapshot: NormalizationSnapshot): NormalizationResult {
  const result: NormalizationResult = {
    sourceSha256: snapshot.sourceSha256,
    sidecarSha256: snapshot.sidecarSha256,
    sourceObjectIds: [],
    findings: [],
    structure: {
      schemaVersion: 'rom.structure/v1alpha1',
      coordinateSystem: 'Z_UP_METRES',
      sourceDocumentSha256: snapshot.sourceSha256,
      objects: [],
      navigation: null,
    },
  }
  const report = (code: string, id: string | null, message: string) =>
    result.findings.push({ code, sourceObjectId: id, message })
  const sidecar = record(snapshot.sidecar) ? snapshot.sidecar : {}
  if (sidecar.schemaVersion !== 'rom.robotics/v1alpha1')
    report('UNSUPPORTED_SIDECAR', null, 'Use the supported robotics metadata version.')
  const roles = record(sidecar.roles) ? sidecar.roles : {}
  const nodes = Object.values(snapshot.graph.nodes).filter(record)
  if (nodes.filter((node) => node.type === 'level').length !== 1)
    report('UNSUPPORTED_LEVELS', null, 'Exactly one level is supported.')
  for (const node of nodes) {
    const id = String(node.id),
      role = roles[id] as PhysicalRole | undefined
    if (node.type === 'site' && node.terrain && role !== 'VISUAL_ONLY')
      report('UNSUPPORTED_TERRAIN', id, 'Terrain must be explicitly visual-only in this profile.')
    if (['site', 'building', 'level'].includes(String(node.type))) continue
    if (role === 'VISUAL_ONLY') continue
    if (node.type === 'door' && node.openingKind === 'opening') continue
    if (!['STATIC_SOLID', 'SUPPORT_SURFACE'].includes(role ?? '')) {
      report('UNREVIEWED_ROLE', id, 'Review the physical role before building.')
      continue
    }
    try {
      const matrix = snapshot.worldMatrices[id]
      if (!matrix) throw new Error('MISSING_RENDERED_ROOT')
      rigidYawTransform(matrix)
      let parts: StructurePart[]
      if (node.type === 'block' && role === 'STATIC_SOLID') parts = blockParts(node, matrix)
      else if (node.type === 'slab' && role === 'SUPPORT_SURFACE') {
        const slab = SlabNode.parse(node)
        if (slab.holes.length || slab.recessed || slab.fillToTerrain || slab.polygon.length !== 4)
          throw new Error('UNSUPPORTED_SLAB')
        const xs = [...new Set(slab.polygon.map((p) => p[0]))],
          zs = [...new Set(slab.polygon.map((p) => p[1]))]
        if (
          xs.length !== 2 ||
          zs.length !== 2 ||
          new Set(slab.polygon.map((p) => p.join(','))).size !== 4
        )
          throw new Error('UNSUPPORTED_SLAB')
        for (let i = 0; i < 4; i++) {
          const a = slab.polygon[i]!,
            b = slab.polygon[(i + 1) % 4]!
          if (a[0] !== b[0] && a[1] !== b[1]) throw new Error('UNSUPPORTED_SLAB')
        }
        parts = [
          boxPart(
            'slab',
            role,
            [(xs[0]! + xs[1]!) / 2, slab.elevation - slab.thickness / 2, (zs[0]! + zs[1]!) / 2],
            [Math.abs(xs[1]! - xs[0]!), slab.thickness, Math.abs(zs[1]! - zs[0]!)],
            matrix,
          ),
        ]
      } else if (node.type === 'wall' && role === 'STATIC_SOLID') {
        const wall = WallNode.parse(node),
          length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
        const height = snapshot.placements[id]?.height
        if (
          !finite(height, 0.001) ||
          wall.curveOffset ||
          wall.fillToTerrain ||
          wall.skirting?.enabled ||
          wall.crown?.enabled ||
          wall.chairRail?.enabled
        )
          throw new Error('UNSUPPORTED_WALL')
        const siblings = nodes
          .filter((other) => other.type === 'wall' && other.parentId === wall.parentId)
          .map((other) => WallNode.parse(other))
        const miters = calculateLevelMiters(siblings)
        const direction = [
          (wall.end[0] - wall.start[0]) / length,
          (wall.end[1] - wall.start[1]) / length,
        ]
        for (const junction of miters.junctions.values()) {
          if (!junction.connectedWalls.some((entry) => entry.wall.id === wall.id)) continue
          for (const { wall: other } of junction.connectedWalls) {
            const otherLength = Math.hypot(
              other.end[0] - other.start[0],
              other.end[1] - other.start[1],
            )
            const dot =
              (direction[0]! * (other.end[0] - other.start[0]) +
                direction[1]! * (other.end[1] - other.start[1])) /
              otherLength
            const placement = snapshot.placements[other.id]
            if (
              other.curveOffset ||
              roles[other.id] !== 'STATIC_SOLID' ||
              !placement ||
              Math.abs(placement.height! - height) > EPS ||
              Math.abs(placement.baseElevation - snapshot.placements[id]!.baseElevation) > EPS ||
              (Math.abs(dot) > EPS && Math.abs(Math.abs(dot) - 1) > EPS)
            )
              throw new Error('UNSUPPORTED_WALL_JUNCTION')
          }
        }
        const footprint = getWallPlanFootprint(wall, miters).map(
          (point) =>
            (point.x - wall.start[0]) * direction[0]! + (point.y - wall.start[1]) * direction[1]!,
        )
        const wallStart = Math.min(...footprint),
          wallEnd = Math.max(...footprint)
        const openings = wall.children.map((child) => snapshot.graph.nodes[child]).filter(record)
        const cuts = openings
          .map((raw) => {
            if (raw.type !== 'door') throw new Error('UNSUPPORTED_OPENING')
            const opening = DoorNode.parse(raw)
            if (
              opening.openingShape !== 'rectangle' ||
              opening.openingKind !== 'opening' ||
              opening.rotation.some((value) => Math.abs(value) > EPS)
            )
              throw new Error('UNSUPPORTED_OPENING')
            const left = opening.position[0] - opening.width / 2,
              right = opening.position[0] + opening.width / 2
            const bottom = opening.position[1] - opening.height / 2,
              top = opening.position[1] + opening.height / 2
            if (left < 0 || right > length || Math.abs(bottom) > EPS || top > height || top <= 0)
              throw new Error('UNSUPPORTED_OPENING')
            return { id: opening.id, left, right, top }
          })
          .sort((a, b) => a.left - b.left)
        parts = []
        let start = wallStart
        let prior = 'start'
        for (const cut of cuts) {
          if (cut.left < start) throw new Error('OVERLAPPING_OPENINGS')
          if (cut.left > start)
            parts.push(
              boxPart(
                `${prior}-to-${cut.id}`,
                role,
                [(start + cut.left) / 2, height / 2, 0],
                [cut.left - start, height, getWallThickness(wall)],
                matrix,
              ),
            )
          if (cut.top < height)
            parts.push(
              boxPart(
                `${cut.id}-lintel`,
                role,
                [(cut.left + cut.right) / 2, (cut.top + height) / 2, 0],
                [cut.right - cut.left, height - cut.top, getWallThickness(wall)],
                matrix,
              ),
            )
          start = cut.right
          prior = cut.id
        }
        if (start < wallEnd)
          parts.push(
            boxPart(
              `${prior}-to-end`,
              role,
              [(start + wallEnd) / 2, height / 2, 0],
              [wallEnd - start, height, getWallThickness(wall)],
              matrix,
            ),
          )
      } else throw new Error('UNSUPPORTED_GEOMETRY')
      if (!parts.length) throw new Error('EMPTY_PHYSICAL_OBJECT')
      result.structure.objects.push({ sourceObjectId: id, parts })
    } catch (error) {
      report(
        error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_NODE',
        id,
        'This object is outside the supported structural subset.',
      )
    }
  }
  result.sourceObjectIds = result.structure.objects.map((object) => object.sourceObjectId).sort()
  if (!record(sidecar.navigation))
    report(
      'MISSING_NAVIGATION',
      null,
      'Define the navigation region and spawn, home and tour markers.',
    )
  else {
    // Navigation is checked against the compiler contract after geometry establishes the support plane.
    const navigation = sidecar.navigation as unknown as RoboticsSidecar['navigation']
    const support = result.structure.objects
      .find((object) => object.sourceObjectId === navigation.supportSourceObjectId)
      ?.parts.find((part) => part.role === 'SUPPORT_SURFACE')
    if (!support || Math.abs(support.yawRadians) > EPS)
      report(
        'INVALID_SUPPORT',
        navigation.supportSourceObjectId ?? null,
        'The navigation support must be an axis-aligned rectangular slab.',
      )
    else {
      const floorZ = support.center[2] + support.size[2] / 2
      const markers = navigation.markers
      const vector = (value: unknown, count: number) =>
        Array.isArray(value) && value.length === count && value.every((item) => finite(item))
      const valid =
        vector(navigation.minimumXY, 2) &&
        vector(navigation.maximumXY, 2) &&
        navigation.minimumXY.every(
          (value, axis) =>
            value < navigation.maximumXY[axis]! &&
            value >= support.center[axis]! - support.size[axis]! / 2,
        ) &&
        navigation.maximumXY.every(
          (value, axis) => value <= support.center[axis]! + support.size[axis]! / 2,
        ) &&
        finite(navigation.robotHeightM, 0.001, 5) &&
        finite(navigation.verticalMarginM, 0, 1) &&
        finite(navigation.footprintRadiusM, 0.2, 0.6) &&
        finite(navigation.horizontalMarginM, 0.05, 0.3) &&
        Array.isArray(markers) &&
        markers.length <= 256 &&
        markers.every(
          (marker) =>
            record(marker) &&
            typeof marker.id === 'string' &&
            /^[1-9][0-9]{0,18}$/.test(marker.id) &&
            BigInt(marker.id) <= 9223372036854775807n &&
            marker.frame === 'ROM_SCENE' &&
            ['ROBOT_SPAWN', 'HOME', 'TOUR_POINT'].includes(marker.kind) &&
            vector(marker.position, 3) &&
            Math.abs(marker.position[2] - floorZ) <= 1e-6 &&
            finite(marker.yawRadians),
        )
      if (
        !valid ||
        new Set(markers.map((marker) => marker.id)).size !== markers.length ||
        markers.filter((marker) => marker.kind === 'ROBOT_SPAWN').length !== 1 ||
        markers.filter((marker) => marker.kind === 'HOME').length !== 1 ||
        !markers.some((marker) => marker.kind === 'TOUR_POINT')
      )
        report(
          'INVALID_NAVIGATION',
          null,
          'Review the navigation bounds, dimensions and required markers.',
        )
      else
        result.structure.navigation = {
          minimumXY: navigation.minimumXY,
          maximumXY: navigation.maximumXY,
          supportPart: { sourceObjectId: navigation.supportSourceObjectId, partId: support.partId },
          floorZ,
          robotHeightM: navigation.robotHeightM,
          verticalMarginM: navigation.verticalMarginM,
          footprintRadiusM: navigation.footprintRadiusM,
          horizontalMarginM: navigation.horizontalMarginM,
          anchors: markers.map((marker) => ({
            id: marker.id,
            kind: marker.kind,
            position: [...marker.position],
            yawRadians: marker.yawRadians,
          })),
        }
    }
  }
  if (
    result.structure.objects.filter((object) =>
      object.parts.some((part) => part.role === 'SUPPORT_SURFACE'),
    ).length !== 1
  )
    report('INVALID_SUPPORT_COUNT', null, 'Exactly one support slab is required.')
  if (
    result.structure.objects.length > 1024 ||
    result.structure.objects.reduce((count, object) => count + object.parts.length, 0) > 10_000
  )
    report('STRUCTURE_LIMIT_EXCEEDED', null, 'The compiler object or part limit was exceeded.')
  return result
}
