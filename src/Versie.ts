import { Commit, CommitHash, BlobHash, MetaData } from './Commit'
import {
  Bookmark,
  Bookmarks,
  BookmarkNotFoundError,
  BookmarkAlreadyExistsError,
} from './Bookmarks'
export { BookmarkAlreadyExistsError } from './Bookmarks'
import { Storage } from './Storage'
import { AsyncResult, Result } from 'typescript-result'
import {
  ParseError,
  StorageError,
  VersieStorage,
  VersieStorageError,
} from './VersieStorage'
import { Sha256Hash } from './Sha256Hash'
import { VersieError } from './VersieError'
import { DeltizingError } from './Deltizer'

export type Checkout<M extends MetaData> = {
  commit: Commit<M>
  data: string
}

export type HistoryItem<M extends MetaData> = {
  commit: Commit<M>
  bookmarks: Bookmark[]
}

export class CommitNotFoundError extends VersieError {
  readonly type = 'commit-not-found'

  constructor(hash: CommitHash) {
    super(`Commit '${hash.toHex()}' not found`)
  }
}

export class BlobNotFoundError extends VersieError {
  readonly type = 'blob-not-found'

  constructor(hash: BlobHash) {
    super(`Blob '${hash.toHex()}' not found`)
  }
}

// TODO: use https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system for storage
/** Version Control Software designed for web environments */
export class Versie<M extends MetaData> {
  static async create<M extends MetaData>(
    storage: Storage<M>,
    parseMetadata: (raw: unknown) => M,
  ) {
    const vcsStorage = new VersieStorage(storage, parseMetadata)
    const bookmarks = await Bookmarks.create(vcsStorage)
    if (!bookmarks.ok) return bookmarks

    return Result.ok(new Versie<M>(vcsStorage, bookmarks.value))
  }

  private _head: Commit<M> | null = null
  private constructor(
    private readonly storage: VersieStorage<M>,
    private readonly _bookmarks: Bookmarks<M>,
  ) {}

  get head() {
    return this._head
  }

  /** Set head to point to a commit */
  setHead(hash: CommitHash | null) {
    return Result.fromAsync(async () => {
      if (hash === null) {
        this._head = null
        return Result.ok()
      }
      const res = await this.getCommit(hash)
      if (!res.ok) return res
      if (res.value === null) return Result.error(new CommitNotFoundError(hash))
      this._head = res.value
      return Result.ok()
    })
  }

  /**
   * Add a bookmark
   *
   * returns null if already exists
   * */
  addBookmark(bookmark: Bookmark) {
    return this._bookmarks.add(bookmark)
  }

  setBookmarkCommit(name: string, commit: CommitHash) {
    return this._bookmarks.setCommit(name, commit)
  }

  bookmarkLookup(commit: CommitHash) {
    return this._bookmarks.bookmarkLookup(commit)
  }

  removeBookmark(name: string) {
    return this._bookmarks.remove(name)
  }

  renameBookmark(oldName: string, newName: string) {
    return this._bookmarks.rename(oldName, newName)
  }

  getAllBookmarks() {
    return this._bookmarks.getAllBookmarks()
  }

  getBookmark(name: string) {
    return this._bookmarks.getBookmark(name)
  }

  /**
   * Get history
   * @param n - How far to go back
   */
  history(
    n: number,
    start?: Commit<M>,
  ): AsyncResult<HistoryItem<M>[], ParseError | VersieStorageError> {
    return Result.fromAsync(async () => {
      /** PERF: Make more efficient by querying commits by same author around that time and caching those commits */
      let next: Commit<M> | null = start ?? this._head
      const history: HistoryItem<M>[] = []
      for (let i = 0; i < n; i++) {
        if (next === null) break
        const bookmarks = this._bookmarks.bookmarkLookup(next.hash) ?? []
        history.push({ commit: next, bookmarks })

        if (typeof next.parent === 'undefined') break
        const parentResult = await this.storage.getCommit(next.parent)
        if (!parentResult.ok) {
          return Result.error(parentResult.error)
        }
        if (parentResult.value === null) {
          break
        }
        next = parentResult.value
      }
      return Result.ok(history)
    })
  }

  getCommit(hash: CommitHash) {
    return this.storage.getCommit(hash)
  }

  /**
   * Get all commits from storage
   */
  getAllCommits() {
    return this.storage.getAllCommits()
  }

  /**
   * Create a new commit on current head and point head to this commit
   *
   * @returns null in case nothing changed
   * */
  commit(
    /** The value to be stored and comitted */
    data: string,
    /** Metadata related to this commit */
    metadata: M,
  ): AsyncResult<
    Commit<M> | null,
    | BookmarkNotFoundError
    | StorageError
    | BookmarkAlreadyExistsError
    | DeltizingError
    | BlobNotFoundError
  > {
    return Result.fromAsync(async () => {
      const blob = (await Sha256Hash.fromString(data)) as BlobHash
      // don't commit if nothing changed
      if (
        this._head &&
        blob.compare(this._head.blob) &&
        (this._head.metadata && metadata
          ? this._head.metadata.compare(metadata)
          : true)
      ) {
        return Result.ok(null)
      }

      const commit = await Commit.create(
        blob,
        new Date(),
        metadata,
        this._head ? this._head.hash : undefined,
      )

      const setCommitResult = await this.storage.setCommit(commit, data)
      if (!setCommitResult.ok) return setCommitResult

      this._head = commit
      return Result.ok(commit)
    })
  }

  /**
   * Set head to `hash` and return a `Checkout`
   * */
  checkout(
    hash: CommitHash,
  ): AsyncResult<
    Checkout<M>,
    | ParseError
    | StorageError
    | CommitNotFoundError
    | BlobNotFoundError
    | BookmarkNotFoundError
    | BookmarkAlreadyExistsError
    | DeltizingError
  > {
    return Result.fromAsync(async () => {
      let commit =
        hash === this._head?.hash // use head if it matches to prevent storage call
          ? this._head
          : null
      if (commit === null) {
        const commitResult = await this.storage.getCommit(hash)
        if (!commitResult.ok) return commitResult
        commit = commitResult.value
      }
      if (commit === null) return Result.error(new CommitNotFoundError(hash))
      const blobResult = await this.storage.getCommitData(commit.blob)
      if (!blobResult.ok) return blobResult

      const data = blobResult.value
      if (data === null) return Result.error(new BlobNotFoundError(commit.blob))

      this._head = commit

      return Result.ok({ commit, data })
    })
  }
}
