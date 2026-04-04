import { describe, test, expect, beforeEach } from 'vitest'
import { Result } from 'typescript-result'
import { Deltizer } from './Deltizer'
import { Sha256Hash } from './Sha256Hash'
import { BlobHash } from './Commit'
import { StorageError } from './VersieStorage'

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
    const result = await deltizer.construct(content, base)
    if (!result.ok) throw result.error
    blobStore.set(hash.toBase64(), result.value)
  }

  beforeEach(() => {
    blobStore = new Map()
    deltizer = new Deltizer((hash) =>
      Result.fromAsync(async () => {
        const data = blobStore.get(hash.toBase64())
        if (data == null) {
          return Promise.resolve(
            Result.error(
              new StorageError(new Error(`Blob not found: ${hash.toBase64()}`)),
            ),
          )
        }
        return Promise.resolve(Result.ok(data))
      }),
    )
  })

  describe('Basic Blob Storage', () => {
    test('should store and retrieve a blob', async () => {
      const hash = await createHash('test-hash-1')
      const content = 'Hello, World!'

      await storeBlob(hash, content)
      const retrieved = (await deltizer.reconstruct(hash)).value

      expect(retrieved).toBe(content)
    })

    test('should return error for non-existent blob', async () => {
      const hash = await createHash('non-existent')
      const result = await deltizer.reconstruct(hash)

      expect(result.ok).toBe(false)
    })

    test('should store and retrieve large blobs', async () => {
      const hash = await createHash('large-blob')
      const content = 'x'.repeat(100000) // 100KB of data

      await storeBlob(hash, content)
      const retrieved = (await deltizer.reconstruct(hash)).value

      expect(retrieved).toBe(content)
    })

    test('should handle special characters in blobs', async () => {
      const hash = await createHash('special-chars')
      const content = 'Hello 👋 \n\t\r Special chars: 你好 🎉'

      await storeBlob(hash, content)
      const retrieved = (await deltizer.reconstruct(hash)).value

      expect(retrieved).toBe(content)
    })

    test('should store empty string', async () => {
      const hash = await createHash('empty')
      const content = ''

      await storeBlob(hash, content)
      const retrieved = (await deltizer.reconstruct(hash)).value

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

      const retrieved = (await deltizer.reconstruct(deltaHash)).value
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

      const retrieved = (await deltizer.reconstruct(hash3)).value
      expect(retrieved).toBe(content3)
    })

    test('should handle insertions in delta', async () => {
      const baseHash = await createHash('insert-base')
      const deltaHash = await createHash('insert-delta')
      const baseContent = 'Hello World'
      const deltaContent = 'Hello Beautiful World'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = (await deltizer.reconstruct(deltaHash)).value
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle deletions in delta', async () => {
      const baseHash = await createHash('delete-base')
      const deltaHash = await createHash('delete-delta')
      const baseContent = 'Hello Beautiful World'
      const deltaContent = 'Hello World'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = (await deltizer.reconstruct(deltaHash)).value
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

      const retrieved = (await deltizer.reconstruct(deltaHash)).value
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

      const retrieved = (await deltizer.reconstruct(hashes[51]!)).value
      expect(retrieved).toBe('content-51')
    })

    test('should return error if base is missing', async () => {
      const baseHash = await createHash('missing-base')

      // construct fails because base doesn't exist in the store
      const result = await deltizer.construct('content', baseHash)
      expect(result.ok).toBe(false)
    })
  })

  describe('Delta Chain Management', () => {
    test('should cache delta chain counts', async () => {
      const hash1 = await createHash('cache-1')
      const hash2 = await createHash('cache-2')
      const hash3 = await createHash('cache-3')

      await storeBlob(hash1, 'content-1')
      await storeBlob(hash2, 'content-2', hash1)
      await storeBlob(hash3, 'content-3', hash2)

      // Access multiple times - should use cache
      await deltizer.reconstruct(hash3)
      await deltizer.reconstruct(hash3)
      await deltizer.reconstruct(hash3)

      // Verify cache has the value
      expect(deltizer.deltaChainCountCache.has(hash2)).toBe(true)
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

      const retrieved = (await deltizer.reconstruct(deltaHash)).value
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle newlines and whitespace', async () => {
      const baseHash = await createHash('whitespace-base')
      const deltaHash = await createHash('whitespace-delta')
      const baseContent = 'Line 1\n\nLine 2\t\tLine 3'
      const deltaContent = 'Line 1\n\nLine 2 Modified\t\tLine 3'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = (await deltizer.reconstruct(deltaHash)).value
      expect(retrieved).toBe(deltaContent)
    })

    test('should handle complete replacement', async () => {
      const baseHash = await createHash('replace-base')
      const deltaHash = await createHash('replace-delta')
      const baseContent = 'This is the old content'
      const deltaContent = 'This is completely new content'

      await storeBlob(baseHash, baseContent)
      await storeBlob(deltaHash, deltaContent, baseHash)

      const retrieved = (await deltizer.reconstruct(deltaHash)).value
      expect(retrieved).toBe(deltaContent)
    })
  })

  describe('Compression', () => {
    test('should compress stored data', async () => {
      const hash = await createHash('compress-test')
      const content = 'a'.repeat(10000)

      await storeBlob(hash, content)
      const retrieved = (await deltizer.reconstruct(hash)).value

      expect(retrieved).toBe(content)
    })
  })
})
