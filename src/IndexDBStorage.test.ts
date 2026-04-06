import { describe, test, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { IndexDBStorage } from './IndexDBStorage'
import { Commit } from './Commit'
import { Bookmark } from './Bookmarks'
import { Sha256Hash } from './Sha256Hash'
import type { BlobHash } from './Commit'

function freshIDB() {
  globalThis.indexedDB = new IDBFactory()
}

beforeEach(() => {
  freshIDB()
})

async function createFilledStorage() {
  const result = await IndexDBStorage.create<undefined>()
  if (!result.ok) throw result.error
  const { indexdb: storage } = result.value

  const source = 'console.log("hello")'
  const data = new TextEncoder().encode(source)
  const blobHash = (await Sha256Hash.create(source)) as BlobHash
  const createdOn = new Date(1_700_000_000_000)
  const commit = await Commit.create(blobHash, createdOn, undefined)
  const bookmark = new Bookmark('main', commit.hash, createdOn)

  await storage.setCommit(commit, data)
  await storage.setBookmark(bookmark)

  return { storage, commit, data, bookmark }
}

describe('IndexDBStorage commit and retrieve', () => {
  test('setCommit stores commit metadata retrievable by hash', async () => {
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: storage } = result.value

    const source = 'console.log("hello")'
    const data = new TextEncoder().encode(source)
    const blobHash = (await Sha256Hash.create(source)) as BlobHash
    const createdOn = new Date(1_700_000_000_000)
    const commit = await Commit.create(blobHash, createdOn, undefined)

    await storage.setCommit(commit, data)

    const retrieved = await storage.getCommit(commit.hash)
    expect(retrieved).not.toBeNull()
    expect(retrieved).toMatchObject({ blob: commit.blob.toHex() })
  })

  test('setCommit stores blob data retrievable by blob hash', async () => {
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: storage } = result.value

    const source = 'console.log("hello")'
    const data = new TextEncoder().encode(source)
    const blobHash = (await Sha256Hash.create(source)) as BlobHash
    const createdOn = new Date(1_700_000_000_000)
    const commit = await Commit.create(blobHash, createdOn, undefined)

    await storage.setCommit(commit, data)

    const retrieved = await storage.getCommitData(commit.blob)
    expect(retrieved).not.toBeNull()
    expect(new Uint8Array(retrieved!)).toEqual(data)
  })

  test('getCommit returns null for unknown hash', async () => {
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: storage } = result.value

    const unknownHash = (await Sha256Hash.create('nonexistent')) as BlobHash
    expect(
      await storage.getCommit(
        unknownHash as unknown as import('./Commit').CommitHash,
      ),
    ).toBeNull()
  })

  test('getCommitData returns null for unknown blob hash', async () => {
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: storage } = result.value

    const unknownHash = (await Sha256Hash.create('nonexistent')) as BlobHash
    expect(await storage.getCommitData(unknownHash)).toBeNull()
  })
})

describe('IndexDBStorage export', () => {
  test('exported object has the correct shape and counts', async () => {
    const { storage } = await createFilledStorage()
    const exported = await storage.export()

    expect(exported.version).toBe(1)
    expect(exported.commits).toHaveLength(1)
    expect(exported.blobs).toHaveLength(1)
    expect(exported.bookmarks).toHaveLength(1)
  })

  test('exported commit key is a base64 string without padding', async () => {
    const { storage, commit } = await createFilledStorage()
    const exported = await storage.export()

    const commitEntry = exported.commits[0]!
    expect(typeof commitEntry.key).toBe('string')
    // Should not have '=' padding
    expect(commitEntry.key).not.toContain('=')
    // Should round-trip to the original hash
    const roundTripped = Sha256Hash.fromBase64(commitEntry.key, true)
    expect(roundTripped).toEqual(commit.hash)
  })

  test('exported blob value is a base64-encoded string', async () => {
    const { storage } = await createFilledStorage()
    const exported = await storage.export()

    const blobEntry = exported.blobs[0]!
    expect(typeof blobEntry.value).toBe('string')
    // Decoding it should give back the original bytes
    const decoded = atob(blobEntry.value as string)
    const bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
    expect(bytes).toEqual(new TextEncoder().encode('console.log("hello")'))
  })

  test('exported bookmark key is the bookmark name', async () => {
    const { storage, bookmark } = await createFilledStorage()
    const exported = await storage.export()

    const bookmarkEntry = exported.bookmarks[0]!
    expect(bookmarkEntry.key).toBe(bookmark.name)
  })
})

describe('IndexDBStorage import', () => {
  test('throws on version mismatch', async () => {
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: storage } = result.value

    await expect(
      storage.import({
        version: 999,
        commits: [],
        blobs: [],
        bookmarks: [],
      }),
    ).rejects.toThrow('Import version mismatch')
  })

  test('imported commits are retrievable', async () => {
    const { storage: source, commit, data } = await createFilledStorage()
    const exported = await source.export()

    freshIDB()
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: target } = result.value

    await target.import(exported)

    const retrievedCommit = await target.getCommit(commit.hash)
    expect(retrievedCommit).not.toBeNull()
    expect(retrievedCommit).toMatchObject({ blob: commit.blob.toHex() })

    const retrievedData = await target.getCommitData(commit.blob)
    expect(new Uint8Array(retrievedData!)).toEqual(data)
  })

  test('imported bookmarks are retrievable', async () => {
    const { storage: source, bookmark } = await createFilledStorage()
    const exported = await source.export()

    freshIDB()
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: target } = result.value

    await target.import(exported)

    const retrievedBookmark = await target.getBookmark(bookmark.name)
    expect(retrievedBookmark).not.toBeNull()
    expect(retrievedBookmark).toMatchObject({ name: bookmark.name })
  })

  test('importing twice does not duplicate entries', async () => {
    const { storage: source, commit } = await createFilledStorage()
    const exported = await source.export()

    freshIDB()
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: target } = result.value

    await target.import(exported)
    await target.import(exported)

    expect(await target.getAllCommits()).toHaveLength(1)
    expect(await target.getCommitData(commit.blob)).not.toBeNull()
    expect(await target.getAllBookmarks()).toHaveLength(1)
  })
})

describe('IndexDBStorage round-trip', () => {
  test('all data survives an export → import cycle', async () => {
    const {
      storage: source,
      commit,
      data,
      bookmark,
    } = await createFilledStorage()
    const exported = await source.export()

    freshIDB()
    const result = await IndexDBStorage.create<undefined>()
    if (!result.ok) throw result.error
    const { indexdb: target } = result.value

    await target.import(exported)

    const allCommits = await target.getAllCommits()
    expect(allCommits).toHaveLength(1)

    const blobData = await target.getCommitData(commit.blob)
    expect(blobData).not.toBeNull()
    expect(new Uint8Array(blobData!)).toEqual(data)

    const allBookmarks = await target.getAllBookmarks()
    expect(allBookmarks).toHaveLength(1)
    expect(allBookmarks[0]).toMatchObject({
      name: bookmark.name,
      commit: commit.hash.toHex(),
    })
  })
})
