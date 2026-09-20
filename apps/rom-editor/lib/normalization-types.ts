import type { SceneGraph } from '@pascal-app/editor'
export type Vec3 = [number, number, number]
export type PhysicalRole = 'STATIC_SOLID' | 'SUPPORT_SURFACE' | 'VISUAL_ONLY'
export interface NormalizationFinding {
  code: string
  sourceObjectId: string | null
  message: string
}
export interface StructurePart {
  partId: string
  role: 'STATIC_SOLID' | 'SUPPORT_SURFACE'
  center: Vec3
  size: Vec3
  yawRadians: number
}
export interface StructureObject {
  sourceObjectId: string
  parts: StructurePart[]
}
export interface NavigationMarker {
  id: string
  kind: 'ROBOT_SPAWN' | 'HOME' | 'TOUR_POINT'
  frame: 'ROM_SCENE'
  position: Vec3
  yawRadians: number
}
export interface RoboticsSidecar {
  schemaVersion: 'rom.robotics/v1alpha1'
  roles: Record<string, PhysicalRole>
  navigation: {
    supportSourceObjectId: string
    minimumXY: [number, number]
    maximumXY: [number, number]
    robotHeightM: number
    verticalMarginM: number
    footprintRadiusM: number
    horizontalMarginM: number
    markers: NavigationMarker[]
  }
}
export interface NormalizationSnapshot {
  graph: SceneGraph
  sidecar: unknown
  sourceSha256: string
  sidecarSha256: string
  worldMatrices: Record<string, number[]>
  placements: Record<string, { baseElevation: number; height?: number }>
}
export interface StructureGeometry {
  schemaVersion: 'rom.structure/v1alpha1'
  coordinateSystem: 'Z_UP_METRES'
  sourceDocumentSha256: string
  objects: StructureObject[]
  navigation: {
    minimumXY: [number, number]
    maximumXY: [number, number]
    supportPart: { sourceObjectId: string; partId: string }
    floorZ: number
    robotHeightM: number
    verticalMarginM: number
    footprintRadiusM: number
    horizontalMarginM: number
    anchors: Omit<NavigationMarker, 'frame'>[]
  } | null
}
export interface NormalizationResult {
  sourceSha256: string
  sidecarSha256: string
  structure: StructureGeometry
  sourceObjectIds: string[]
  findings: NormalizationFinding[]
}
