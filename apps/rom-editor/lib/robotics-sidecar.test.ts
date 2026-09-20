import { expect, test } from 'bun:test'
import { applyRoboticsEdit } from './robotics-sidecar'

test('markers retain explicit frames and never reuse deleted IDs', () => {
  const first = applyRoboticsEdit(
    {},
    { kind: 'marker', marker: { kind: 'ROBOT_SPAWN', position: [1, 2, 3], yawRadians: 0 } },
  )
  expect(first.navigation.markers[0]).toEqual({
    id: '1',
    kind: 'ROBOT_SPAWN',
    frame: 'ROM_SCENE',
    position: [1, 2, 3],
    yawRadians: 0,
  })
  const removed = applyRoboticsEdit(first, { kind: 'remove-marker', id: '1' })
  const next = applyRoboticsEdit(removed, {
    kind: 'marker',
    marker: { kind: 'HOME', position: [1, 2, 3], yawRadians: 0 },
  })
  expect(next.navigation.markers[0].id).toBe('2')
  const edited = applyRoboticsEdit(next, {
    kind: 'marker',
    id: '2',
    marker: { kind: 'HOME', position: [4, 2, 3], yawRadians: 0.5 },
  })
  expect(edited.navigation.markers[0].id).toBe('2')
  expect(edited.navigation.markers[0].position).toEqual([4, 2, 3])
})
test('metadata editing rejects nonfinite coordinates instead of JSON null coercion', () => {
  expect(() =>
    applyRoboticsEdit(
      {},
      { kind: 'marker', marker: { kind: 'HOME', position: [NaN, 0, 0], yawRadians: 0 } },
    ),
  ).toThrow('INVALID')
})

test('malformed stored marker metadata stays saveable but cannot crash the controls', async () => {
  const { editableRobotics } = await import('./robotics-sidecar')
  expect(
    editableRobotics({
      roles: { block_a: {} },
      navigation: { markers: [null, {}, { id: '1', position: null }] },
    }).navigation.markers,
  ).toEqual([])
})
