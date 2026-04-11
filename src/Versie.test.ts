import { describe, test, expect } from 'vitest'
import { Versie } from './Versie'
import { JsonValue, Storage, StorageCheckout } from './Storage'
import { Bookmark } from './Bookmarks'
import { BlobHash, Commit, CommitHash } from './Commit'

/** Simple in-memory Storage implementation for testing */
class MemoryStorage implements Storage<undefined> {
  private readonly bookmarks = new Map<string, JsonValue>()
  private readonly commits = new Map<string, JsonValue>()
  private readonly commitData = new Map<string, string>()

  getCommit(id: CommitHash): Promise<JsonValue | null> {
    return Promise.resolve(this.commits.get(id.toHex()) ?? null)
  }

  getCommitData(hash: BlobHash): Promise<string | null> {
    return Promise.resolve(this.commitData.get(hash.toHex()) ?? null)
  }

  getCheckout(hash: CommitHash): Promise<StorageCheckout | null> {
    const commit = this.commits.get(hash.toHex())
    if (commit === undefined) return Promise.resolve(null)
    const commitJson = commit as { blob?: string }
    const blobHex =
      typeof commitJson.blob === 'string' ? commitJson.blob : undefined
    const data =
      blobHex !== undefined ? this.commitData.get(blobHex) : undefined
    if (data === undefined) return Promise.resolve(null)
    return Promise.resolve({ commit, data })
  }

  setBookmark(bookmark: Bookmark): Promise<void> {
    this.bookmarks.set(bookmark.name, bookmark.toJson())
    return Promise.resolve()
  }

  setCommit(commit: Commit<undefined>, data: string): Promise<void> {
    this.commits.set(commit.hash.toHex(), commit.toJson())
    this.commitData.set(commit.blob.toHex(), data)
    return Promise.resolve()
  }

  removeBookmark(name: string): Promise<void> {
    this.bookmarks.delete(name)
    return Promise.resolve()
  }

  getAllBookmarks(): Promise<JsonValue[]> {
    return Promise.resolve([...this.bookmarks.values()])
  }

  getAllCommits(): Promise<JsonValue[]> {
    return Promise.resolve([...this.commits.values()])
  }
}

const parseMetadata = (_raw: unknown): undefined => undefined

describe('Versie', () => {
  test('after a commit, storage has one commit, one bookmark, and commit data', async () => {
    const storage = new MemoryStorage()
    const vcsResult = await Versie.create(storage, parseMetadata)
    if (!vcsResult.ok) throw vcsResult.error
    const vcs = vcsResult.value

    const commitResult = await vcs.commit('const x = 1', undefined)
    if (!commitResult.ok) throw commitResult.error
    const commit = commitResult.value
    if (commit === null) throw new Error('No commit made')
    await vcs.addBookmark(new Bookmark('main', commit.hash, new Date()))

    const allCommits = await storage.getAllCommits()
    expect(allCommits).toHaveLength(1)

    const allBookmarks = await storage.getAllBookmarks()
    expect(allBookmarks).toHaveLength(1)

    const checkoutResult = await storage.getCheckout(commit.hash)
    expect(checkoutResult).not.toBeNull()
  })

  test('all commits are stored when multiple commits are made', async () => {
    const storage = new MemoryStorage()
    const vcsResult = await Versie.create(storage, parseMetadata)
    if (!vcsResult.ok) throw vcsResult.error
    const vcs = vcsResult.value

    await vcs.commit('const a = 1', undefined)
    await vcs.commit('const b = 2', undefined)
    await vcs.commit('const c = 3', undefined)

    const allCommitsResult = await vcs.getAllCommits()
    if (!allCommitsResult.ok) throw allCommitsResult.error
    expect(allCommitsResult.value).toHaveLength(3)
  })

  test('code committed is retrievable via checkout using a fresh Versie instance', async () => {
    const code = 'const answer = 42'
    const storage = new MemoryStorage()

    const vcs1Result = await Versie.create(storage, parseMetadata)
    if (!vcs1Result.ok) throw vcs1Result.error
    const commitResult = await vcs1Result.value.commit(code, undefined)
    if (!commitResult.ok) throw commitResult.error
    const commit = commitResult.value
    if (commit === null) throw new Error('No commit made')

    await vcs1Result.value.addBookmark(
      new Bookmark('main', commit.hash, new Date()),
    )

    // Create a fresh Versie from the same storage (simulates re-opening)
    const vcs2Result = await Versie.create(storage, parseMetadata)
    if (!vcs2Result.ok) throw vcs2Result.error
    const vcs2 = vcs2Result.value

    const bookmarks = vcs2.getAllBookmarks()
    expect(bookmarks).toHaveLength(1)

    const bookmark = bookmarks[0]
    if (bookmark === undefined) throw new Error('Expected one bookmark')

    const checkoutResult = await vcs2.checkout(bookmark.commit)
    if (!checkoutResult.ok) throw checkoutResult.error
    expect(checkoutResult.value.data).toBe(code)
  })

  test('committing identical content is a no-op', async () => {
    const storage = new MemoryStorage()
    const vcsResult = await Versie.create(storage, parseMetadata)
    if (!vcsResult.ok) throw vcsResult.error
    const vcs = vcsResult.value

    await vcs.commit('const x = 1', undefined)
    const secondCommitResult = await vcs.commit('const x = 1', undefined)
    if (!secondCommitResult.ok) throw secondCommitResult.error
    expect(secondCommitResult.value).toBeNull()
  })

  test('checkout of a non-existent commit hash returns an error', async () => {
    const storage = new MemoryStorage()
    const vcsResult = await Versie.create(storage, parseMetadata)
    if (!vcsResult.ok) throw vcsResult.error
    const vcs = vcsResult.value

    const commitResult = await vcs.commit('const x = 1', undefined)
    if (!commitResult.ok) throw commitResult.error
    const commit = commitResult.value
    if (commit === null) throw new Error('No commit made')

    // Use the blob hash as a commit hash — it won't be found in the commits map
    const bogusHash = commit.blob as unknown as CommitHash
    const checkoutResult = await vcs.checkout(bogusHash)
    expect(checkoutResult.ok).toBe(false)
  })
})
