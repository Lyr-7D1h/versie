import { BlobHash, CommitHash } from './Commit'

export class VersieError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class BookmarkNotFoundError extends VersieError {
  readonly type = 'bookmark-not-found'

  constructor(name: string) {
    super(`Bookmark '${name}' not found`)
  }
}

export class BookmarkAlreadyExistsError extends VersieError {
  readonly type = 'bookmark-already-exists'

  constructor(name: string) {
    super(`Bookmark '${name}' already exists`)
  }
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

/** An error that happened when trying to turn commit data in deltas */
export class DeltizingError extends VersieError {
  readonly type = 'blob-storage-error'
}
