import { AsyncResult, Result } from 'typescript-result'
import { ZodError } from 'zod'
import { Bookmark, bookmarkSchema } from './Bookmark'
import {
  Commit,
  CommitHash,
  BlobHash,
  MetaData,
  commitSchema,
  CommitJson,
} from './Commit'
import { Storage } from './Storage'
import { DeltizingError } from './Deltizer'
import { Checkout } from './Versie'

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

export type VersieStorageError = StorageError | DeltizingError

/** VCS Storage wrapper for parsing and error handling of storage data */
export class VersieStorage<M extends MetaData> {
  constructor(
    private readonly storage: Storage<M>,
    private readonly parseMetadata: (raw: unknown) => M,
  ) {}

  private toStorageError(error: unknown): VersieStorageError {
    if (error instanceof StorageError) return error
    if (error instanceof DeltizingError) return error
    if (error instanceof Error) return new StorageError(error)
    return new StorageError(new Error(String(error)))
  }

  setBookmark(bookmark: Bookmark): AsyncResult<void, VersieStorageError> {
    return Result.fromAsync(async () => {
      try {
        await this.storage.setBookmark(bookmark)
        return Result.ok()
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }
    })
  }

  removeBookmark(name: string): AsyncResult<void, VersieStorageError> {
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
  getCheckout(
    hash: CommitHash,
  ): AsyncResult<Checkout<M> | null, ParseError | VersieStorageError> {
    return Result.fromAsync(async () => {
      try {
        const checkout = await this.storage.getCheckout(hash)
        if (checkout === null) return Result.ok(null)

        const commit = commitSchema.safeParse(checkout.commit)
        if (!commit.success) return Result.error(new ParseError(commit.error))
        const metadata = this.parseMetadata(commit.data.metadata)

        return Result.ok({
          commit: new Commit(
            hash,
            commit.data.blob,
            commit.data.createdOn,
            metadata,
            commit.data.parent,
          ),
          data: checkout.data,
        })
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }
    })
  }

  getCommit(
    hash: CommitHash,
  ): AsyncResult<Commit<M> | null, ParseError | VersieStorageError> {
    return Result.fromAsync(async () => {
      let raw: CommitJson | null
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

  getCommitData(
    hash: BlobHash,
  ): AsyncResult<string | null, VersieStorageError> {
    return Result.fromAsync(async () => {
      try {
        return Result.ok(await this.storage.getCommitData(hash))
      } catch (error) {
        return Result.error(this.toStorageError(error))
      }
    })
  }

  setCommit(
    commit: Commit<M>,
    data: string,
  ): AsyncResult<void, VersieStorageError> {
    return Result.fromAsync(async () => {
      try {
        await this.storage.setCommit(commit, data)
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

  getAllCommits(): AsyncResult<Commit<M>[], ParseError | VersieStorageError> {
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
