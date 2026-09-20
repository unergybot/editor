import { expect, test } from 'bun:test'
import { parentOrigin } from './host-config'

test('accepts only a single exact origin with secure production transport', () => {
  expect(parentOrigin('https://rom.example', true)).toBe('https://rom.example')
  expect(parentOrigin('http://127.0.0.1:4179', false)).toBe('http://127.0.0.1:4179')
  for (const value of [
    '*',
    'https://rom.example/path',
    'https://a.example https://b.example',
    'https://user:pass@rom.example',
    'http://rom.example',
  ]) {
    expect(() => parentOrigin(value, true)).toThrow()
  }
})
