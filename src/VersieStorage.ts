import { AsyncResult, Result } from 'typescript-result'
import { ZodError } from 'zod'
import { Bookmark, bookmarkSchema } from './Bookmarks'
import { Deltizer, DeltizingError } from './Deltizer'
import { Commit, CommitHash, BlobHash, MetaData, commitSchema } from './Commit'
import { JsonValue, Storage } from './Storage'
import { BlobNotFoundError } from './Versie'

export class StorageError extends Error {
  readonly type = 'storage-error'

  constructor(error: Error) {
    super(error.message)
    this.name = 'StorageError'

    // Preserve stack trace from wrapped error when available.
    this.stack = error.stack ?? this.stack

    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ParseError extends Error {
  readonly type = 'parse-error'

  constructor(error: ZodError) {
    super(`Failed to parse: ${error.message}`)
    this.name = this.constructor.name
  }
}

/** VCS Storage wrapper that handles efficient data storage and parsing */
export class VersieStorage<M extends MetaData> {
  private readonly deltizer: Deltizer

  constructor(
    private readonly storage: Storage<M>,
    private readonly parseMetadata: (raw: unknown) => M,
  ) {
    this.deltizer = new Deltizer((hash) => {
      return Result.fromAsync(async () => {
        try {
          const data = await storage.getCommitData(hash)
          if (data === null) return Result.error(new BlobNotFoundError(hash))
          return Result.ok(data)
        } catch (error) {
          return Result.error(this.toStorageError(error))
        }
      })
    })
  }

  private toStorageError(error: unknown): StorageError {
    if (error instanceof StorageError) return error
    if (error instanceof Error) return new StorageError(error)
    return new StorageError(new Error(String(error)))
  }

  setBookmark(bookmark: Bookmark): AsyncResult<void, StorageError> {
    return Result.fromAsync(async () => {
      try {
        await this.storage.setBookmark(bookmark)
        return Result.ok()
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }
    })
  }

  removeBookmark(name: string): AsyncResult<void, StorageError> {
    return Result.fromAsync(async () => {
      try {
        await this.storage.removeBookmark(name)
        return Result.ok()
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }
    })
  }

  // --- Commits ---

  getCommit(
    hash: CommitHash,
  ): AsyncResult<Commit<M> | null, ParseError | StorageError> {
    return Result.fromAsync(async () => {
      let raw: JsonValue | null
      try {
        raw = await this.storage.getCommit(hash)
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }

      if (raw === null) return Result.ok(null)

      const parsed = commitSchema.safeParse(raw)
      if (!parsed.success) return Result.error(new ParseError(parsed.error))

      const metadata = this.parseMetadata(parsed.data.metadata)

      return Result.ok(
        new Commit(
          hash,
          parsed.data.blob,
          parsed.data.createdOn,
          metadata,
          parsed.data.parent,
        ),
      )
    })
  }

  getCommitData(hash: BlobHash) {
    return this.deltizer.reconstruct(hash)
  }

  setCommit(
    commit: Commit<M>,
    data: string,
  ): AsyncResult<void, StorageError | DeltizingError | BlobNotFoundError> {
    return Result.fromAsync(async () => {
      try {
        const deltized = await this.deltizer.construct(data)
        if (!deltized.ok) return deltized
        await this.storage.setCommit(commit, deltized.value)
        return Result.ok()
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }
    })
  }

  getAllBookmarks() {
    return Result.fromAsync(async () => {
      let rawList
      try {
        rawList = await this.storage.getAllBookmarks()
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }

      const bookmarks: Bookmark[] = []
      for (const raw of rawList) {
        const parsed = bookmarkSchema.safeParse(raw)
        if (!parsed.success) return Result.error(new ParseError(parsed.error))

        bookmarks.push(parsed.data)
      }
      return Result.ok(bookmarks)
    })
  }

  getAllCommits(): AsyncResult<Commit<M>[], ParseError | StorageError> {
    return Result.fromAsync(async () => {
      let rawList: Awaited<ReturnType<Storage<M>['getAllCommits']>>
      try {
        rawList = await this.storage.getAllCommits()
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }

      const commits: Commit<M>[] = []
      for (const raw of rawList) {
        const parsed = commitSchema.safeParse(raw)
        if (!parsed.success) return Result.error(new ParseError(parsed.error))

        const metadata = this.parseMetadata(parsed.data.metadata)

        commits.push(
          await Commit.create(
            parsed.data.blob,
            parsed.data.createdOn,
            metadata,
            parsed.data.parent,
          ),
        )
      }
      return Result.ok(commits)
    })
  }
}
