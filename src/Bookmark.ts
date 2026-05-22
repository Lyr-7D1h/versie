import { Result } from 'typescript-result'
import { z } from 'zod'
import { Commit, CommitHash, commitHashSchema, MetaData } from './Commit'
import { InvalidBookmarkNameError } from './VersieError'

export const bookmarkNameSchema = z.string().regex(/^[^~:\r\n]{1,32}$/)
export const bookmarkSchema = z
  .object({
    name: bookmarkNameSchema,
    commit: commitHashSchema,
    createdOn: z.number().transform((epochMs) => new Date(epochMs)),
  })
  .transform(({ name, commit, createdOn }) => {
    // Name is already validated by bookmarkNameSchema above
    return Bookmark._unsafeCreate(name, commit, createdOn)
  })

export interface BookmarkJson {
  name: string
  commit: string
  createdOn: number
}
export class Bookmark {
  private constructor(
    /** Unique bookmark name */
    readonly name: string,
    readonly commit: CommitHash,
    readonly createdOn: Date,
  ) {}

  /** @internal Used by bookmarkSchema after validation */
  static _unsafeCreate(
    name: string,
    commit: CommitHash,
    createdOn: Date,
  ): Bookmark {
    return new Bookmark(name, commit, createdOn)
  }

  static create(
    name: string,
    commit: CommitHash,
    createdOn: Date,
  ): Result<Bookmark, InvalidBookmarkNameError> {
    const validationResult = bookmarkNameSchema.safeParse(name)
    if (!validationResult.success) {
      const firstIssue = validationResult.error.issues[0]
      return Result.error(
        new InvalidBookmarkNameError(name, firstIssue?.message),
      )
    }
    return Result.ok(new Bookmark(name, commit, createdOn))
  }

  toJson(): BookmarkJson {
    return {
      name: this.name,
      commit: this.commit.toHex(),
      createdOn: this.createdOn.getTime(),
    }
  }

  static isBookmark(
    bm: Bookmark | Commit<MetaData> | CommitHash,
  ): bm is Bookmark {
    return 'name' in bm
  }
}
