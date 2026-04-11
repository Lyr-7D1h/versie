import { describe, test, expect, beforeEach } from 'vitest'
import { Deltizer, DeltizingError, LRUDeltaChainCountCache } from './Deltizer'
import { Sha256Hash } from './Sha256Hash'
import { BlobHash } from './Commit'

describe('Deltizer', () => {
  let blobStore: Map<string, Uint8Array>
  let deltizer: Deltizer

  const createHash = async (str: string): Promise<BlobHash> => {
    return (await Sha256Hash.create(str)) as BlobHash
  }

  /** Construct blob data and store it in the in-memory map */
  const storeBlob = async (
    hash: BlobHash,
    content: string,
    base?: BlobHash,
  ): Promise<void> => {
    const data = await deltizer.construct(content, base)
    blobStore.set(hash.toBase64(), data)
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

      expect(deltizer.deltaChainCountCache.get(hash2)).toBe(1)
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
      blobStore.set(hash.toBase64(), new Uint8Array([0xff]))
      await expect(deltizer.reconstruct(hash)).rejects.toThrow(DeltizingError)
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
      expect(deltizer.deltaChainCountCache.get(hash)).toBeUndefined()
      await deltizer.getDeltaCount(hash)
      expect(deltizer.deltaChainCountCache.get(hash)).toBe(0)
    })

    test('uses cached value on subsequent calls', async () => {
      const hash = await createHash('gdc-cache-hit')
      await storeBlob(hash, 'some content')
      await deltizer.getDeltaCount(hash)
      // Override cache to verify subsequent calls read from it
      deltizer.deltaChainCountCache.set(hash, 99)
      const count = await deltizer.getDeltaCount(hash)
      expect(count).toBe(99)
    })

    test('throws DeltizingError when hash is not found', async () => {
      const hash = await createHash('gdc-missing')
      await expect(deltizer.getDeltaCount(hash)).rejects.toThrow(DeltizingError)
    })

    test('throws DeltizingError for unknown data type byte', async () => {
      const hash = await createHash('gdc-unknown-type')
      blobStore.set(hash.toBase64(), new Uint8Array([0x02, 0x00, 0x00, 0x00]))
      await expect(deltizer.getDeltaCount(hash)).rejects.toThrow(DeltizingError)
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
      deltizer.deltaChainCountCache.set(hash, 51)
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
      expect(result).toBe(baseContent)
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
      expect(data[0]).toBe(0x00)
    })

    test('produces type byte 0x01 (delta) for sufficiently similar base content', async () => {
      const baseHash = await createHash('cof-delta-base')
      const baseContent =
        'The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const baseData = await deltizer.construct(baseContent)
      blobStore.set(baseHash.toBase64(), baseData)
      const similarContent =
        'The quick brown cat jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const data = await deltizer.construct(similarContent, baseHash)
      expect(data[0]).toBe(0x01)
    })

    test('produces type byte 0x00 (blob) when value is too short for a delta', async () => {
      const baseHash = await createHash('cof-short-value')
      const baseData = await deltizer.construct('base content')
      blobStore.set(baseHash.toBase64(), baseData)
      // 'short' is fewer than 64 chars — shouldStoreAsDelta returns false
      const data = await deltizer.construct('short', baseHash)
      expect(data[0]).toBe(0x00)
    })

    test('reconstruct round-trips constructed data correctly', async () => {
      const baseHash = await createHash('cof-roundtrip-base')
      const deltaHash = await createHash('cof-roundtrip-delta')
      const baseContent =
        'The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const deltaContent =
        'The quick brown cat jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.'
      const baseData = await deltizer.construct(baseContent)
      blobStore.set(baseHash.toBase64(), baseData)
      const deltaData = await deltizer.construct(deltaContent, baseHash)
      blobStore.set(deltaHash.toBase64(), deltaData)
      expect(await deltizer.reconstruct(deltaHash)).toBe(deltaContent)
    })
  })
})

describe('LRUDeltaChainCountCache', () => {
  test('returns undefined for unknown keys', async () => {
    const cache = new LRUDeltaChainCountCache()
    const hash = (await Sha256Hash.create('unknown-key')) as BlobHash
    expect(cache.get(hash)).toBeUndefined()
  })

  test('stores and retrieves a value', async () => {
    const cache = new LRUDeltaChainCountCache()
    const hash = (await Sha256Hash.create('stored-key')) as BlobHash
    cache.set(hash, 7)
    expect(cache.get(hash)).toBe(7)
  })

  test('overwrites an existing value for the same key', async () => {
    const cache = new LRUDeltaChainCountCache()
    const hash = (await Sha256Hash.create('overwrite-key')) as BlobHash
    cache.set(hash, 1)
    cache.set(hash, 10)
    expect(cache.get(hash)).toBe(10)
  })

  test('stores zero as a valid count', async () => {
    const cache = new LRUDeltaChainCountCache()
    const hash = (await Sha256Hash.create('zero-key')) as BlobHash
    cache.set(hash, 0)
    expect(cache.get(hash)).toBe(0)
  })

  test('keeps separate entries for different keys', async () => {
    const cache = new LRUDeltaChainCountCache()
    const hash1 = (await Sha256Hash.create('key-a')) as BlobHash
    const hash2 = (await Sha256Hash.create('key-b')) as BlobHash
    cache.set(hash1, 3)
    cache.set(hash2, 7)
    expect(cache.get(hash1)).toBe(3)
    expect(cache.get(hash2)).toBe(7)
  })

  test('evicts the least-recently-used entry when max size is exceeded', async () => {
    const cache = new LRUDeltaChainCountCache(2)
    const hash1 = (await Sha256Hash.create('lru-1')) as BlobHash
    const hash2 = (await Sha256Hash.create('lru-2')) as BlobHash
    const hash3 = (await Sha256Hash.create('lru-3')) as BlobHash
    cache.set(hash1, 1)
    cache.set(hash2, 2)
    // Adding hash3 should evict hash1 (the LRU entry)
    cache.set(hash3, 3)
    expect(cache.get(hash1)).toBeUndefined()
    expect(cache.get(hash2)).toBe(2)
    expect(cache.get(hash3)).toBe(3)
  })

  test('uses default max of 200 entries', async () => {
    const cache = new LRUDeltaChainCountCache()
    const hashes: BlobHash[] = []
    for (let i = 0; i < 200; i++) {
      hashes.push((await Sha256Hash.create(`fill-${i}`)) as BlobHash)
      cache.set(hashes[i]!, i)
    }
    // All 200 entries should still be present
    expect(cache.get(hashes[0]!)).toBe(0)
    expect(cache.get(hashes[199]!)).toBe(199)
  })
})
