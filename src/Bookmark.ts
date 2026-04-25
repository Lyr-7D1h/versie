import { z } from 'zod'
import { Commit, CommitHash, commitHashSchema, MetaData } from './Commit'

export const bookmarkNameSchema = z.string().regex(/^[^~:\r\n]{1,32}$/)
export const bookmarkSchema = z
  .object({
    name: bookmarkNameSchema,
    commit: commitHashSchema,
    createdOn: z.number().transform((epochMs) => new Date(epochMs)),
  })
  .transform(({ name, commit, createdOn }) => {
    return new Bookmark(name, commit, createdOn)
  })

export interface BookmarkJson {
  name: string
  commit: string
  createdOn: number
}
export class Bookmark {
  constructor(
    /** Unique bookmark name */
    readonly name: string,
    readonly commit: CommitHash,
    readonly createdOn: Date,
  ) {}

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
