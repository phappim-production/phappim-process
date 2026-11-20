export function fakeR2() {
  const store = new Map()
  const puts = []
  const meta = (key, v) => ({ key, size: v.bytes.byteLength, httpMetadata: { contentType: v.type } })
  return {
    store, puts,
    async head(key) { const v = store.get(key); return v ? meta(key, v) : null },
    async get(key) {
      const v = store.get(key)
      return v ? { ...meta(key, v), body: new Blob([v.bytes]).stream() } : null
    },
    async put(key, bytes, opts) {
      puts.push(key)
      store.set(key, { bytes: new Uint8Array(bytes), type: opts?.httpMetadata?.contentType ?? '' })
      return meta(key, store.get(key))
    },
  }
}

export const MAGIC = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
}

export function fileBytes(type, size) {
  const bytes = new Uint8Array(size)
  bytes.set(MAGIC[type].slice(0, size))
  return bytes
}
