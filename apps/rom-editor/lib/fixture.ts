import {
  BlockNode,
  BuildingNode,
  createBoxBlockTopology,
  DoorNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'

export function createTwoRoomFixture(): SceneGraph {
  const site = SiteNode.parse({ id: 'site_rom', children: ['building_rom'] })
  const building = BuildingNode.parse({
    id: 'building_rom',
    parentId: site.id,
    children: ['level_rom'],
  })
  const level = LevelNode.parse({ id: 'level_rom', parentId: building.id, height: 3 })
  const floor = SlabNode.parse({
    id: 'slab_floor',
    parentId: level.id,
    name: 'Floor',
    polygon: [
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ],
    elevation: 0,
    thickness: 0.2,
  })
  const walls = [
    ['south', [0, 0], [10, 0]],
    ['east', [10, 0], [10, 6]],
    ['north', [10, 6], [0, 6]],
    ['west', [0, 6], [0, 0]],
    ['partition', [5, 0], [5, 6]],
  ].map(([name, start, end]) =>
    WallNode.parse({
      id: `wall_${name}`,
      name: `Wall ${name}`,
      parentId: level.id,
      start,
      end,
      height: 3,
      thickness: 0.2,
      supportSlabId: floor.id,
      children: name === 'partition' ? ['door_passage'] : [],
    }),
  )
  const door = DoorNode.parse({
    id: 'door_passage',
    name: 'Passage',
    parentId: 'wall_partition',
    openingKind: 'opening',
    openingShape: 'rectangle',
    position: [0, 1.1, 0],
    width: 1.5,
    height: 2.2,
  })
  const box = (id: string, name: string, position: number[], size: number[], group?: string) =>
    BlockNode.parse({
      id: `block_${id}`,
      name,
      parentId: level.id,
      position,
      supportSlabId: floor.id,
      topology: createBoxBlockTopology(size[0], size[1], size[2]),
      metadata: group ? { romGroup: group } : {},
    })
  const blocks = [
    box('calibration', 'Calibration box', [2, 0, 2], [1, 1, 1]),
    box('table_top', 'Table top', [8, 0.9, 2], [1.8, 0.1, 0.8], 'table'),
    ...[-0.7, 0.7].flatMap((x, i) =>
      [-0.3, 0.3].map((z, j) =>
        box(`table_leg_${i}_${j}`, 'Table leg', [8 + x, 0, 2 + z], [0.1, 0.9, 0.1], 'table'),
      ),
    ),
    ...[0, 1, 2].map((y, i) =>
      box(`rack_shelf_${i}`, 'Rack shelf', [8, y, 5], [2, 0.1, 0.6], 'rack'),
    ),
    ...[-0.9, 0.9].flatMap((x, i) =>
      [-0.2, 0.2].map((z, j) =>
        box(`rack_post_${i}_${j}`, 'Rack post', [8 + x, 0, 5 + z], [0.1, 2.1, 0.1], 'rack'),
      ),
    ),
  ]
  level.children = [floor.id, ...walls.map((wall) => wall.id), ...blocks.map((block) => block.id)]
  return {
    nodes: Object.fromEntries(
      [site, building, level, floor, ...walls, door, ...blocks].map((node) => [node.id, node]),
    ),
    rootNodeIds: [site.id],
    installedPlugins: [],
  }
}
