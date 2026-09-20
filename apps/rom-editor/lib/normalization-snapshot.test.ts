import { expect, test } from 'bun:test'
import { waitForNormalizationReady } from './normalization-snapshot'

test('readiness waits for actual pending work and restores presentation on failure', async () => {
  let pending = true,
    restored = false
  const controller = new AbortController()
  const result = waitForNormalizationReady({
    ready: () => !pending,
    capture: () => 'snapshot',
    enter: () => () => {
      restored = true
    },
    signal: controller.signal,
    deadlineMs: 100,
  })
  setTimeout(() => {
    pending = false
  }, 15)
  expect(await result).toBe('snapshot')
  expect(restored).toBe(true)
  restored = false
  await expect(
    waitForNormalizationReady({
      ready: () => false,
      capture: () => 'invalid',
      enter: () => () => {
        restored = true
      },
      signal: controller.signal,
      deadlineMs: 10,
    }),
  ).rejects.toThrow('GEOMETRY_NOT_READY')
  expect(restored).toBe(true)
})

test('aborting a pending capture restores presentation without producing a snapshot', async () => {
  const controller = new AbortController()
  let restored = false,
    captured = false
  const result = waitForNormalizationReady({
    ready: () => false,
    capture: () => {
      captured = true
    },
    enter: () => () => {
      restored = true
    },
    signal: controller.signal,
  })
  controller.abort()
  await expect(result).rejects.toThrow('DISPOSED')
  expect(restored).toBe(true)
  expect(captured).toBe(false)
})
