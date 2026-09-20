export function parentOrigin(value: string | undefined, production: boolean): string {
  if (!value) throw new Error('ROM_PARENT_ORIGIN is required')
  const url = new URL(value)
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      (production ||
        url.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new Error('ROM_PARENT_ORIGIN must be one exact trusted origin')
  }
  return url.origin
}
