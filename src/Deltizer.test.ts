import { describe, test, expect, beforeEach } from 'vitest'
import { Deltizer, DeltizedBlob, LRUBlobCache } from './Deltizer'
import { Sha256Hash } from './Sha256Hash'
import { BlobHash } from './Commit'
import { DeltizingError } from './VersieError'

const asDeltizedBlob = (value: Uint8Array): DeltizedBlob => {
  return value as DeltizedBlob
}

describe('Deltizer', () => {
  let blobStore: Map<string, DeltizedBlob>
  let deltizer: Deltizer

  const createHash = async (str: string): Promise<BlobHash> => {
    return (await Sha256Hash.fromString(str)) as BlobHash
  }

  /** Construct blob data and store it in the in-memory map */
  const storeBlob = async (
    hash: BlobHash,
    content: string,
    base?: BlobHash,
  ): Promise<void> => {
    const data = await deltizer.construct(content, base)
    blobStore.set(hash.toBase64(), data.data)
  }

  /** Build a delta payload that only points to a base hash (no ops), useful for cycle tests */
  const makeBaseOnlyDelta = async (base: BlobHash): Promise<DeltizedBlob> => {
    const delta = new Uint8Array(32)
    delta.set(base, 0)
    const compressed = await Deltizer.compressBytes(delta)
    const out = new Uint8Array(1 + compressed.length)
    out[0] = 0x01
    out.set(compressed, 1)
    return asDeltizedBlob(out)
  }

  beforeEach(() => {
    blobStore = new Map()
    deltizer = new Deltizer((hash) => {
      return Promise.resolve(blobStore.get(hash.toBase64()) ?? null)
    })
  })

  describe('Basic Blob Storage', () => {
    test('should store and retrieve a blob', async () => {
      const hash = await createHash('test-hash-1')
      const content = 'Hello, World!'

      await storeBlob(hash, content)
      const retrieved = await deltizer.reconstruct(hash)

      expect(retrieved).toBe(content)
    })

    test('should throw for non-existent blob', async () => {
      const hash = await createHash('non-existent')

      expect(await deltizer.reconstruct(hash)).toBe(null)
    })

    test('should store and retrieve large blobs', async () => {
      const hash = await createHash('large-blob')
      const content = 'x'.repeat(100000) // 100KB of data

      await storeBlob(hash, content)
      const retrieved = await deltizer.reconstruct(hash)

      expect(retrieved).toBe(content)
    })

    test('should handle special characters in blobs', async () => {
      const hash = await createHash('special-chars')
      const content = 'Hello 👋 \n\t\r Special chars: 你好 🎉'

      await storeBlob(hash, content)
      const retrieved = await deltizer.reconstruct(hash)

      expect(retrieved).toBe(content)
    })

    test('should store empty string', async () => {
      const hash = await createHash('empty')
      const content = ''

      await storeBlob(hash, content)
      const retrieved = await deltizer.reconstruct(hash)

      expect(retrieved).toBe(content)
    })
  })

  describe('Delta Storage', () => {
    test('should store and retrieve delta-based blob', async () => {
      const baseHash = await createHash('base-1')
      const deltaHash = await createHash('delta-1')
      const baseContent = 'The quick brown fox jumps over the lazy dog'
      const deltaContent = 'The quick brown fox jumps over the lazy cat'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = await deltizer.reconstruct(deltaHash)
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle multiple deltas in a chain', async () => {
      const hash1 = await createHash('chain-1')
      const hash2 = await createHash('chain-2')
      const hash3 = await createHash('chain-3')

      const content1 = 'Line 1\nLine 2\nLine 3'
      const content2 = 'Line 1\nLine 2 modified\nLine 3'
      const content3 = 'Line 1\nLine 2 modified\nLine 3\nLine 4'

      await storeBlob(hash1, content1)
      await storeBlob(hash2, content2, hash1)
      await storeBlob(hash3, content3, hash2)

      const retrieved = await deltizer.reconstruct(hash3)
      expect(retrieved).toBe(content3)
    })

    test('should handle insertions in delta', async () => {
      const baseHash = await createHash('insert-base')
      const deltaHash = await createHash('insert-delta')
      const baseContent = 'Hello World'
      const deltaContent = 'Hello Beautiful World'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = await deltizer.reconstruct(deltaHash)
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle deletions in delta', async () => {
      const baseHash = await createHash('delete-base')
      const deltaHash = await createHash('delete-delta')
      const baseContent = 'Hello Beautiful World'
      const deltaContent = 'Hello World'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = await deltizer.reconstruct(deltaHash)
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle mixed operations in delta', async () => {
      const baseHash = await createHash('mixed-base')
      const deltaHash = await createHash('mixed-delta')
      const baseContent = 'function foo() {\n  console.log("hello");\n}'
      const deltaContent =
        'function bar() {\n  console.log("world");\n  return 42;\n}'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = await deltizer.reconstruct(deltaHash)
      expect(retrieved).toBe(deltaContent)
    })

    test('should store as blob when delta chain is too long', async () => {
      // Create a chain longer than MAX_DELTA_CHAIN_COUNT (50)
      const hashes: BlobHash[] = []
      for (let i = 0; i < 52; i++) {
        hashes.push(await createHash(`long-chain-${i}`))
      }

      await storeBlob(hashes[0]!, 'content-0')

      for (let i = 1; i < 51; i++) {
        await storeBlob(hashes[i]!, `content-${i}`, hashes[i - 1])
      }

      // The 51st item should be stored as a full blob, not a delta
      await storeBlob(hashes[51]!, 'content-51', hashes[50])

      const retrieved = await deltizer.reconstruct(hashes[51]!)
      expect(retrieved).toBe('content-51')
    })

    test('should throw if base is missing', async () => {
      const baseHash = await createHash('missing-base')

      // construct throws because base doesn't exist in the store
      await expect(
        deltizer.construct(
          `public class GenerateDummyCode {
	public static void main(String[] args) {
		String className = "Eben";
		String newLine = "\n";
		String tab = "\t";
		String classStart = "public class " + className + " {";
		String closeBracket = "}";
		String mainStart = "public static void main(String[] args) {";
		String dummyContent = "";`,
          baseHash,
        ),
      ).rejects.toThrow(DeltizingError)
    })
  })

  describe('Delta Chain Management', () => {
    test('should cache delta chain counts', async () => {
      const hash1 = await createHash('cache-1')
      const hash2 = await createHash('cache-2')
      const hash3 = await createHash('cache-3')

      await storeBlob(
        hash1,
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
      )
      await storeBlob(
        hash2,
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut Lasteore et dolore magna aliqua. minim veniam, quis nostrud Exter ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
        hash1,
      )
      await storeBlob(
        hash3,
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut Lasteore et dolore magna aliqua. minim veniam, quis nostrud Exter ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate Veasdf esse cillum dolore eu fugiat nulla pariatur. Jelsdfj sint occaecat cupidatat non Lasdf, sunt in culpa qui officia deserunt mollit anim id est laborum.',
        hash2,
      )

      // Access multiple times - should use cache
      await deltizer.reconstruct(hash3)
      await deltizer.reconstruct(hash3)
      await deltizer.reconstruct(hash3)

      expect(deltizer.cache.getDeltaChainCount(hash2)).toBe(1)
    })

    test('treats cached blob data and delta chain count as independent cache values', async () => {
      const hash = await createHash('cache-blob-and-count-are-independent')
      const content =
        'This hash can have a fully reconstructed blob in cache while still carrying a non-zero delta chain count.'

      deltizer.cache.setBlob(hash, (await deltizer.construct(content)).data)
      deltizer.cache.setDeltaChainCount(hash, 3)

      expect(await deltizer.reconstruct(hash)).toBe(content)
      expect(await deltizer.getDeltaCount(hash)).toBe(3)
    })
  })

  describe('Edge Cases', () => {
    test('should handle unicode characters in deltas', async () => {
      const baseHash = await createHash('unicode-base')
      const deltaHash = await createHash('unicode-delta')
      const baseContent = 'Hello 世界'
      const deltaContent = 'Hello 世界! 👋'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = await deltizer.reconstruct(deltaHash)
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle newlines and whitespace', async () => {
      const baseHash = await createHash('whitespace-base')
      const deltaHash = await createHash('whitespace-delta')
      const baseContent = 'Line 1\n\nLine 2\t\tLine 3'
      const deltaContent = 'Line 1\n\nLine 2 Modified\t\tLine 3'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = await deltizer.reconstruct(deltaHash)
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle complete replacement', async () => {
      const baseHash = await createHash('replace-base')
      const deltaHash = await createHash('replace-delta')
      const baseContent = 'This is the old content'
      const deltaContent = 'This is completely new content'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = await deltizer.reconstruct(deltaHash)
      expect(retrieved).toBe(deltaContent)
    })
  })

  describe('Compression', () => {
    test('should compress stored data', async () => {
      const hash = await createHash('compress-test')
      const content = 'a'.repeat(10000)

      await storeBlob(hash, content)
      const retrieved = await deltizer.reconstruct(hash)

      expect(retrieved).toBe(content)
    })
  })

  describe('reconstruct edge cases', () => {
    test('returns null for a missing hash', async () => {
      const hash = await createHash('rec-null')
      const result = await deltizer.reconstruct(hash)
      expect(result).toBeNull()
    })

    test('throws DeltizingError for unknown data type byte', async () => {
      const hash = await createHash('rec-bad-type')
      blobStore.set(hash.toBase64(), asDeltizedBlob(new Uint8Array([0xff])))
      await expect(deltizer.reconstruct(hash)).rejects.toThrow(DeltizingError)
    })

    test('throws DeltizingError when a cyclic delta chain is encountered', async () => {
      const h1 = await createHash('rec-cycle-1')
      const h2 = await createHash('rec-cycle-2')

      blobStore.set(h1.toBase64(), await makeBaseOnlyDelta(h2))
      blobStore.set(h2.toBase64(), await makeBaseOnlyDelta(h1))

      await expect(deltizer.reconstruct(h1)).rejects.toThrow(DeltizingError)
    })
  })

  describe('getDeltaCount', () => {
    test('returns 0 for a full blob', async () => {
      const hash = await createHash('gdc-full-blob')
      await storeBlob(hash, 'content that is stored as a full blob')
      expect(await deltizer.getDeltaCount(hash)).toBe(0)
    })

    test('returns 1 for a single-level delta', async () => {
      const baseHash = await createHash('gdc-base')
      const deltaHash = await createHash('gdc-delta')
      const baseContent =
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.'
      const deltaContent =
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incidunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.'
      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)
      expect(await deltizer.getDeltaCount(deltaHash)).toBe(1)
    })

    test('returns 2 for a two-level delta chain', async () => {
      const h1 = await createHash('gdc-chain-1')
      const h2 = await createHash('gdc-chain-2')
      const h3 = await createHash('gdc-chain-3')
      const c1 =
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.'
      const c2 =
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incidunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.'
      const c3 =
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incidunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco labori.'
      await storeBlob(h1, c1)
      await storeBlob(h2, c2, h1)
      await storeBlob(h3, c3, h2)
      expect(await deltizer.getDeltaCount(h3)).toBe(2)
    })

    test('populates cache after computing count', async () => {
      const hash = await createHash('gdc-cache-populate')
      await storeBlob(hash, 'some content')
      expect(deltizer.cache.getDeltaChainCount(hash)).toBeUndefined()
      await deltizer.getDeltaCount(hash)
      expect(deltizer.cache.getDeltaChainCount(hash)).toBe(0)
    })

    test('uses cached value on subsequent calls', async () => {
      const hash = await createHash('gdc-cache-hit')
      await storeBlob(hash, 'some content')
      await deltizer.getDeltaCount(hash)
      // Override cache to verify subsequent calls read from it
      deltizer.cache.setDeltaChainCount(hash, 99)
      const count = await deltizer.getDeltaCount(hash)
      expect(count).toBe(99)
    })

    test('throws DeltizingError when hash is not found', async () => {
      const hash = await createHash('gdc-missing')
      await expect(deltizer.getDeltaCount(hash)).rejects.toThrow(DeltizingError)
    })

    test('throws DeltizingError for unknown data type byte', async () => {
      const hash = await createHash('gdc-unknown-type')
      blobStore.set(
        hash.toBase64(),
        asDeltizedBlob(new Uint8Array([0x02, 0x00, 0x00, 0x00])),
      )
      await expect(deltizer.getDeltaCount(hash)).rejects.toThrow(DeltizingError)
    })

    test('throws DeltizingError for cyclic delta references', async () => {
      const h1 = await createHash('gdc-cycle-1')
      const h2 = await createHash('gdc-cycle-2')

      blobStore.set(h1.toBase64(), await makeBaseOnlyDelta(h2))
      blobStore.set(h2.toBase64(), await makeBaseOnlyDelta(h1))

      await expect(deltizer.getDeltaCount(h1)).rejects.toThrow(DeltizingError)
    })
  })

  describe('shouldStoreAsDelta', () => {
    test('returns false for strings shorter than 64 characters', async () => {
      const hash = await createHash('ssd-short')
      await storeBlob(hash, 'x'.repeat(200))
      const result = await deltizer.shouldStoreAsDelta('too short', hash)
      expect(result).toBe(false)
    })

    test('returns false when delta chain count exceeds max', async () => {
      const hash = await createHash('ssd-max-chain')
      await storeBlob(hash, 'x'.repeat(200))
      // Pre-populate cache to simulate a chain exceeding the 50-count max
      deltizer.cache.setDeltaChainCount(hash, 51)
      const result = await deltizer.shouldStoreAsDelta('x'.repeat(100), hash)
      expect(result).toBe(false)
    })

    test('returns false when base reconstructs to an empty string', async () => {
      const hash = await createHash('ssd-empty-base')
      await storeBlob(hash, '')
      const result = await deltizer.shouldStoreAsDelta('x'.repeat(100), hash)
      expect(result).toBe(false)
    })

    test('returns false when strings differ by more than 80% in length', async () => {
      const hash = await createHash('ssd-length-diff')
      const shortBase = 'short base content'
      await storeBlob(hash, shortBase)
      // Value is much longer than base: length diff exceeds 80% threshold
      const longValue = 'a'.repeat(500)
      const result = await deltizer.shouldStoreAsDelta(longValue, hash)
      expect(result).toBe(false)
    })

    test('returns the reconstructed base string for sufficiently similar content', async () => {
      const hash = await createHash('ssd-similar')
      const baseContent =
        'The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      await storeBlob(hash, baseContent)
      const similarContent =
        'The quick brown cat jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const result = await deltizer.shouldStoreAsDelta(similarContent, hash)
      expect(result).toEqual({ baseValue: baseContent, count: 0 })
    })

    test('throws DeltizingError when base hash is not in the store', async () => {
      const hash = await createHash('ssd-missing')
      await expect(
        deltizer.shouldStoreAsDelta('x'.repeat(100), hash),
      ).rejects.toThrow(DeltizingError)
    })
  })

  describe('construct output format', () => {
    test('produces type byte 0x00 (blob) when no base is given', async () => {
      const data = await deltizer.construct(
        'some value to store without a base',
      )
      expect(data.data[0]).toBe(0x00)
    })

    test('produces type byte 0x01 (delta) for sufficiently similar base content', async () => {
      const baseHash = await createHash('cof-delta-base')
      const baseContent =
        'The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const baseData = await deltizer.construct(baseContent)
      blobStore.set(baseHash.toBase64(), baseData.data)
      const similarContent =
        'The quick brown cat jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const data = await deltizer.construct(similarContent, baseHash)
      expect(data.data[0]).toBe(0x01)
    })

    test('produces type byte 0x00 (blob) when value is too short for a delta', async () => {
      const baseHash = await createHash('cof-short-value')
      const baseData = await deltizer.construct('base content')
      blobStore.set(baseHash.toBase64(), baseData.data)
      // 'short' is fewer than 64 chars — shouldStoreAsDelta returns false
      const data = await deltizer.construct('short', baseHash)
      expect(data.data[0]).toBe(0x00)
    })

    test('reconstruct round-trips constructed data correctly', async () => {
      const baseHash = await createHash('cof-roundtrip-base')
      const deltaHash = await createHash('cof-roundtrip-delta')
      const baseContent =
        'The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const deltaContent =
        'The quick brown cat jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const baseData = await deltizer.construct(baseContent)
      blobStore.set(baseHash.toBase64(), baseData.data)
      const deltaData = await deltizer.construct(deltaContent, baseHash)
      blobStore.set(deltaHash.toBase64(), deltaData.data)
      expect(await deltizer.reconstruct(deltaHash)).toBe(deltaContent)
    })
  })
})

describe('LRUBlobCache', () => {
  test('returns undefined for unknown delta chain count', async () => {
    const cache = new LRUBlobCache()
    const hash = (await Sha256Hash.fromString('unknown-key')) as BlobHash
    expect(cache.getDeltaChainCount(hash)).toBeUndefined()
  })

  test('stores and retrieves a delta chain count', async () => {
    const cache = new LRUBlobCache()
    const hash = (await Sha256Hash.fromString('stored-key')) as BlobHash
    cache.setDeltaChainCount(hash, 7)
    expect(cache.getDeltaChainCount(hash)).toBe(7)
  })

  test('overwrites an existing delta chain count for the same key', async () => {
    const cache = new LRUBlobCache()
    const hash = (await Sha256Hash.fromString('overwrite-key')) as BlobHash
    cache.setDeltaChainCount(hash, 1)
    cache.setDeltaChainCount(hash, 10)
    expect(cache.getDeltaChainCount(hash)).toBe(10)
  })

  test('stores zero as a valid count', async () => {
    const cache = new LRUBlobCache()
    const hash = (await Sha256Hash.fromString('zero-key')) as BlobHash
    cache.setDeltaChainCount(hash, 0)
    expect(cache.getDeltaChainCount(hash)).toBe(0)
  })

  test('keeps separate entries for different keys', async () => {
    const cache = new LRUBlobCache()
    const hash1 = (await Sha256Hash.fromString('key-a')) as BlobHash
    const hash2 = (await Sha256Hash.fromString('key-b')) as BlobHash
    cache.setDeltaChainCount(hash1, 3)
    cache.setDeltaChainCount(hash2, 7)
    expect(cache.getDeltaChainCount(hash1)).toBe(3)
    expect(cache.getDeltaChainCount(hash2)).toBe(7)
  })

  test('evicts the least-recently-used entry when max size is exceeded', async () => {
    const cache = new LRUBlobCache({ max: 2 })
    const hash1 = (await Sha256Hash.fromString('lru-1')) as BlobHash
    const hash2 = (await Sha256Hash.fromString('lru-2')) as BlobHash
    const hash3 = (await Sha256Hash.fromString('lru-3')) as BlobHash
    cache.setDeltaChainCount(hash1, 1)
    cache.setDeltaChainCount(hash2, 2)
    // Adding hash3 should evict hash1 (the LRU entry)
    cache.setDeltaChainCount(hash3, 3)
    expect(cache.getDeltaChainCount(hash1)).toBeUndefined()
    expect(cache.getDeltaChainCount(hash2)).toBe(2)
    expect(cache.getDeltaChainCount(hash3)).toBe(3)
  })

  test('uses default max of 200 entries', async () => {
    const cache = new LRUBlobCache()
    const hashes: BlobHash[] = []
    for (let i = 0; i < 200; i++) {
      hashes.push((await Sha256Hash.fromString(`fill-${i}`)) as BlobHash)
      cache.setDeltaChainCount(hashes[i]!, i)
    }
    // All 200 entries should still be present
    expect(cache.getDeltaChainCount(hashes[0]!)).toBe(0)
    expect(cache.getDeltaChainCount(hashes[199]!)).toBe(199)
  })

  describe('getBlob / setBlob', () => {
    test('returns null for an unknown hash', async () => {
      const cache = new LRUBlobCache()
      const hash = (await Sha256Hash.fromString('blob-unknown')) as BlobHash
      expect(cache.getBlob(hash)).toBeNull()
    })

    test('stores and retrieves a blob', async () => {
      const cache = new LRUBlobCache()
      const hash = (await Sha256Hash.fromString('blob-stored')) as BlobHash
      const blob = asDeltizedBlob(new Uint8Array([1, 2, 3]))
      cache.setBlob(hash, blob)
      expect(cache.getBlob(hash)).toBe(blob)
    })

    test('overwrites an existing blob', async () => {
      const cache = new LRUBlobCache()
      const hash = (await Sha256Hash.fromString('blob-overwrite')) as BlobHash
      const first = asDeltizedBlob(new Uint8Array([1, 2, 3]))
      const second = asDeltizedBlob(new Uint8Array([4, 5, 6]))
      cache.setBlob(hash, first)
      cache.setBlob(hash, second)
      expect(cache.getBlob(hash)).toBe(second)
    })
  })

  describe('entry preservation', () => {
    test('setBlob preserves existing deltaChainCount', async () => {
      const cache = new LRUBlobCache()
      const hash = (await Sha256Hash.fromString('preserve-count')) as BlobHash
      cache.setDeltaChainCount(hash, 5)
      cache.setBlob(hash, asDeltizedBlob(new Uint8Array([9, 8, 7])))
      expect(cache.getDeltaChainCount(hash)).toBe(5)
    })

    test('setDeltaChainCount preserves existing blob', async () => {
      const cache = new LRUBlobCache()
      const hash = (await Sha256Hash.fromString('preserve-blob')) as BlobHash
      const blob = asDeltizedBlob(new Uint8Array([1, 2, 3]))
      cache.setBlob(hash, blob)
      cache.setDeltaChainCount(hash, 4)
      expect(cache.getBlob(hash)).toBe(blob)
    })
  })

  describe('size-based eviction', () => {
    test('evicts entries when maxSize is exceeded', async () => {
      // sizeCalculation: blob.length + 8 — a 10-byte blob costs 18 bytes
      // maxSize of 20 fits one entry (18 bytes) but not two (36 bytes)
      const cache = new LRUBlobCache({ max: 100, maxSize: 20 })
      const h1 = (await Sha256Hash.fromString('size-evict-1')) as BlobHash
      const h2 = (await Sha256Hash.fromString('size-evict-2')) as BlobHash
      cache.setBlob(h1, asDeltizedBlob(new Uint8Array(10)))
      cache.setBlob(h2, asDeltizedBlob(new Uint8Array(10)))
      expect(cache.getBlob(h1)).toBeNull()
      expect(cache.getBlob(h2)).not.toBeNull()
    })

    test('entries with only deltaChainCount have minimal size', async () => {
      // Size with no blob is 0 + 8 = 8 bytes; 3 such entries fit in maxSize=30
      const cache = new LRUBlobCache({ max: 100, maxSize: 30 })
      const h1 = (await Sha256Hash.fromString('min-size-1')) as BlobHash
      const h2 = (await Sha256Hash.fromString('min-size-2')) as BlobHash
      const h3 = (await Sha256Hash.fromString('min-size-3')) as BlobHash
      cache.setDeltaChainCount(h1, 1)
      cache.setDeltaChainCount(h2, 2)
      cache.setDeltaChainCount(h3, 3)
      expect(cache.getDeltaChainCount(h1)).toBe(1)
      expect(cache.getDeltaChainCount(h2)).toBe(2)
      expect(cache.getDeltaChainCount(h3)).toBe(3)
    })
  })
})
