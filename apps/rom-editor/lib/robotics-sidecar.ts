import type { NavigationMarker, PhysicalRole, RoboticsSidecar } from './normalization-types'
export interface EditableRobotics {
  schemaVersion: 'rom.robotics/v1alpha1'
  roles: Record<string, PhysicalRole>
  nextMarkerId: string
  navigation: Partial<Omit<RoboticsSidecar['navigation'], 'markers'>> & {
    markers: NavigationMarker[]
  }
}
export type RoboticsEdit =
  | { kind: 'role'; sourceId: string; role: PhysicalRole }
  | { kind: 'navigation'; navigation: Omit<RoboticsSidecar['navigation'], 'markers'> }
  | { kind: 'marker'; id?: string; marker: Omit<NavigationMarker, 'id' | 'frame'> }
  | { kind: 'remove-marker'; id: string }
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export function editableRobotics(value: unknown): EditableRobotics {
  const source = object(value) ? value : {},
    navigation = object(source.navigation) ? source.navigation : {}
  return {
    ...structuredClone(source),
    schemaVersion: 'rom.robotics/v1alpha1',
    roles: object(source.roles)
      ? (structuredClone(source.roles) as Record<string, PhysicalRole>)
      : {},
    nextMarkerId: typeof source.nextMarkerId === 'string' ? source.nextMarkerId : '1',
    navigation: {
      ...structuredClone(navigation),
      markers: Array.isArray(navigation.markers)
        ? (structuredClone(navigation.markers).filter(
            (marker: unknown) =>
              object(marker) &&
              typeof marker.id === 'string' &&
              ['ROBOT_SPAWN', 'HOME', 'TOUR_POINT'].includes(String(marker.kind)) &&
              marker.frame === 'ROM_SCENE' &&
              Array.isArray(marker.position) &&
              marker.position.length === 3 &&
              marker.position.every(
                (value) => typeof value === 'number' && Number.isFinite(value),
              ) &&
              typeof marker.yawRadians === 'number' &&
              Number.isFinite(marker.yawRadians),
          ) as NavigationMarker[])
        : [],
    },
  }
}
export function applyRoboticsEdit(value: unknown, edit: RoboticsEdit): EditableRobotics {
  const next = editableRobotics(value)
  if (
    object(value) &&
    object(value.navigation) &&
    Array.isArray(value.navigation.markers) &&
    value.navigation.markers.length !== next.navigation.markers.length
  )
    throw new Error('INVALID')
  const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1_000_000
  if (edit.kind === 'role') {
    if (!edit.sourceId || !['STATIC_SOLID', 'SUPPORT_SURFACE', 'VISUAL_ONLY'].includes(edit.role))
      throw new Error('INVALID')
    next.roles[edit.sourceId] = edit.role
  } else if (edit.kind === 'navigation') {
    const n = edit.navigation
    if (
      !n.supportSourceObjectId ||
      ![
        ...n.minimumXY,
        ...n.maximumXY,
        n.robotHeightM,
        n.verticalMarginM,
        n.footprintRadiusM,
        n.horizontalMarginM,
      ].every(finite)
    )
      throw new Error('INVALID')
    next.navigation = { ...structuredClone(n), markers: next.navigation.markers }
  } else if (edit.kind === 'remove-marker')
    next.navigation.markers = next.navigation.markers.filter((marker) => marker.id !== edit.id)
  else {
    if (
      !['ROBOT_SPAWN', 'HOME', 'TOUR_POINT'].includes(edit.marker.kind) ||
      edit.marker.position.length !== 3 ||
      ![...edit.marker.position, edit.marker.yawRadians].every(finite)
    )
      throw new Error('INVALID')
    let id = edit.id
    if (id && !next.navigation.markers.some((marker) => marker.id === id))
      throw new Error('INVALID')
    if (!id) {
      const previous = [next.nextMarkerId, ...next.navigation.markers.map((marker) => marker.id)]
      if (previous.some((item) => !/^[1-9][0-9]{0,18}$/.test(item))) throw new Error('INVALID')
      const candidate = next.navigation.markers.reduce(
        (max, marker) => (BigInt(marker.id) >= max ? BigInt(marker.id) + 1n : max),
        BigInt(next.nextMarkerId),
      )
      if (candidate >= 9223372036854775807n || next.navigation.markers.length >= 256)
        throw new Error('INVALID')
      id = String(candidate)
      next.nextMarkerId = String(candidate + 1n)
    }
    const marker: NavigationMarker = { ...structuredClone(edit.marker), id, frame: 'ROM_SCENE' }
    next.navigation.markers = [...next.navigation.markers.filter((item) => item.id !== id), marker]
  }
  return next
}
