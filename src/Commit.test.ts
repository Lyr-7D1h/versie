import { describe, test, expect } from 'vitest'
import { Sha256Hash } from './Sha256Hash'
import { BlobHash, Commit, CommitHash } from './Commit'
import { CommitMetadataInterface } from './Commit'
import { JsonValue } from './Storage'

const makeBlob = async (s: string): Promise<BlobHash> =>
  (await Sha256Hash.fromString(s)) as BlobHash

const makeParent = async (s: string): Promise<CommitHash> =>
  (await Sha256Hash.fromString(s)) as CommitHash

const date = new Date('2024-01-01T00:00:00.000Z')

class SimpleMeta implements CommitMetadataInterface<{ label: string }> {
  constructor(readonly label: string) {}
  toJson() {
    return { label: this.label }
  }
  compare(other: this) {
    return this.label === other.label
  }
}

class NestedMeta implements CommitMetadataInterface {
  constructor(readonly data: JsonValue) {}
  toJson(): JsonValue {
    return this.data
  }
  compare(other: this) {
    return JSON.stringify(this.data) === JSON.stringify(other.data)
  }
}

describe('Commit.hash', () => {
  test('is deterministic: same inputs produce the same hash', async () => {
    const blob = await makeBlob('blob-a')
    const h1 = await Commit.hash(blob, date.getTime(), undefined)
    const h2 = await Commit.hash(blob, date.getTime(), undefined)
    expect(h1.toHex()).toBe(h2.toHex())
  })

  test('different blob produces different hash', async () => {
    const blobA = await makeBlob('blob-a')
    const blobB = await makeBlob('blob-b')
    const h1 = await Commit.hash(blobA, date.getTime(), undefined)
    const h2 = await Commit.hash(blobB, date.getTime(), undefined)
    expect(h1.toHex()).not.toBe(h2.toHex())
  })

  test('different timestamp produces different hash', async () => {
    const blob = await makeBlob('blob-a')
    const h1 = await Commit.hash(
      blob,
      new Date('2024-01-01T00:00:00.000Z').getTime(),
      undefined,
    )
    const h2 = await Commit.hash(
      blob,
      new Date('2024-01-02T00:00:00.000Z').getTime(),
      undefined,
    )
    expect(h1.toHex()).not.toBe(h2.toHex())
  })

  test('with parent vs without parent produces different hash', async () => {
    const blob = await makeBlob('blob-a')
    const parent = await makeParent('parent-a')
    const h1 = await Commit.hash(blob, date.getTime(), undefined)
    const h2 = await Commit.hash(blob, date.getTime(), undefined, parent)
    expect(h1.toHex()).not.toBe(h2.toHex())
  })

  test('different parent produces different hash', async () => {
    const blob = await makeBlob('blob-a')
    const parentA = await makeParent('parent-a')
    const parentB = await makeParent('parent-b')
    const h1 = await Commit.hash(blob, date.getTime(), undefined, parentA)
    const h2 = await Commit.hash(blob, date.getTime(), undefined, parentB)
    expect(h1.toHex()).not.toBe(h2.toHex())
  })

  test('with metadata vs without metadata produces different hash', async () => {
    const blob = await makeBlob('blob-a')
    const h1 = await Commit.hash(blob, date.getTime(), undefined)
    const h2 = await Commit.hash(
      blob,
      date.getTime(),
      new SimpleMeta('foo').toJson(),
    )
    expect(h1.toHex()).not.toBe(h2.toHex())
  })

  test('different metadata values produce different hashes', async () => {
    const blob = await makeBlob('blob-a')
    const h1 = await Commit.hash(
      blob,
      date.getTime(),
      new SimpleMeta('foo').toJson(),
    )
    const h2 = await Commit.hash(
      blob,
      date.getTime(),
      new SimpleMeta('bar').toJson(),
    )
    expect(h1.toHex()).not.toBe(h2.toHex())
  })

  test('same metadata produces same hash', async () => {
    const blob = await makeBlob('blob-a')
    const h1 = await Commit.hash(
      blob,
      date.getTime(),
      new SimpleMeta('foo').toJson(),
    )
    const h2 = await Commit.hash(
      blob,
      date.getTime(),
      new SimpleMeta('foo').toJson(),
    )
    expect(h1.toHex()).toBe(h2.toHex())
  })

  test('nested metadata object is hashed correctly and consistently', async () => {
    const blob = await makeBlob('blob-a')
    const meta = new NestedMeta({ a: 1, b: [true, null, 'x'] })
    const h1 = await Commit.hash(blob, date.getTime(), meta.toJson())
    const h2 = await Commit.hash(blob, date.getTime(), meta.toJson())
    expect(h1.toHex()).toBe(h2.toHex())
  })

  test('all fields combined: full hash is consistent', async () => {
    const blob = await makeBlob('blob-a')
    const parent = await makeParent('parent-a')
    const meta = new SimpleMeta('versie')
    const h1 = await Commit.hash(blob, date.getTime(), meta.toJson(), parent)
    const h2 = await Commit.hash(blob, date.getTime(), meta.toJson(), parent)
    expect(h1.toHex()).toBe(h2.toHex())
  })

  test('result is a valid 32-byte SHA-256 hash (64 hex chars)', async () => {
    const blob = await makeBlob('blob-a')
    const h = await Commit.hash(blob, date.getTime(), undefined)
    expect(h.toHex()).toHaveLength(64)
    expect(h.byteLength).toBe(32)
  })
})

describe('Commit.create', () => {
  test('hash on created commit matches Commit.hash', async () => {
    const blob = await makeBlob('blob-a')
    const parent = await makeParent('parent-a')
    const meta = new SimpleMeta('test')
    const commit = await Commit.create(blob, date, meta, parent)
    const expected = await Commit.hash(
      blob,
      date.getTime(),
      meta.toJson(),
      parent,
    )
    expect(commit.hash.toHex()).toBe(expected.toHex())
  })

  test('commit stores all fields correctly', async () => {
    const blob = await makeBlob('blob-a')
    const parent = await makeParent('parent-a')
    const meta = new SimpleMeta('test')
    const commit = await Commit.create(blob, date, meta, parent)
    expect(commit.blob.toHex()).toBe(blob.toHex())
    expect(commit.parent!.toHex()).toBe(parent.toHex())
    expect(commit.createdOn).toEqual(date)
    expect(commit.metadata).toBe(meta)
  })

  test('root commit (no parent) has no parent field', async () => {
    const blob = await makeBlob('blob-a')
    const commit = await Commit.create(blob, date, undefined)
    expect(commit.parent).toBeUndefined()
  })
})
