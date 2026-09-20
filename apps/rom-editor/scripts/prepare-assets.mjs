import { cp } from 'node:fs/promises'

await cp(
  new URL('../../editor/public/icons/', import.meta.url),
  new URL('../public/icons/', import.meta.url),
  { recursive: true },
)
