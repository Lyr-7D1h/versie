import { z } from 'zod'
import { Sha256Hash, sha256HashSchema } from './Sha256Hash'
import { JsonValue } from './Storage'
import { Tagged } from './Tagged'

export const commitHashSchema = sha256HashSchema as z.ZodPipe<
  z.ZodString,
  z.ZodTransform<CommitHash, string>
>
export type CommitHash = Tagged<Sha256Hash, 'CommitHash'>

export const blobHashSchema = sha256HashSchema as z.ZodPipe<
  z.ZodString,
  z.ZodTransform<BlobHash, string>
>
export type BlobHash = Tagged<Sha256Hash, 'BlobHash'>

export const dateNumberSchema = z
  .number()
  .refine((epoch) => !isNaN(new Date(epoch).getTime()), 'Invalid timestamp')
  .transform((n) => new Date(n))
export const commitSchema = z.object({
  blob: blobHashSchema,
  parent: commitHashSchema.optional(),
  createdOn: dateNumberSchema,
  metadata: z.unknown(),
})

export interface _MetaData {
  toJson(): JsonValue
  /**
   * Return true when `this` is the same as `meta`
   *
   * NOTE: metadata has to change in order to commit
   */
  compare(meta: this): boolean
}

export type MetaData = _MetaData | undefined

/**
 * Commit of a change made: [64 byte hash][hex encoded Extension]
 */
export class Commit<M extends MetaData> {
  constructor(
    readonly hash: CommitHash,
    /** Hash of the blob of code */
    readonly blob: BlobHash,
    readonly createdOn: Date,
    readonly metadata: M,
    /** Hash of parent commit */
    readonly parent?: CommitHash,
  ) {}

  /**
   * Creates a new Commit
   */
  static async create<M extends MetaData>(
    /** Hash of the blob of code */
    blob: BlobHash,
    createdOn = new Date(),
    metadata: M,
    /** Hash of parent commit, null if it is a root commit */
    parent?: CommitHash,
  ): Promise<Commit<M>> {
    const hash = (await Sha256Hash.create(
      `${blob.toBase64()}${createdOn.getTime()}${parent?.toBase64() ?? ''}${typeof metadata !== 'undefined' ? JSON.stringify(metadata.toJson()) : ''}`,
    )) as CommitHash

    return new Commit(hash, blob, createdOn, metadata, parent)
  }

  /** Get a json serializable object with only primitive types */
  toJson(): {
    blob: string
    createdOn: number
    parent?: string
    metadata?: JsonValue
  } {
    const { metadata, blob, parent, createdOn } = this
    return {
      blob: blob.toHex(),
      createdOn: createdOn.getTime(),
      parent: parent?.toHex(),
      ...(metadata ? { metadata: metadata.toJson() } : {}),
    }
  }

  toSub() {
    return this.hash.toSub()
  }

  toHex() {
    return this.hash.toHex()
  }
}
