import { z } from 'zod'
import { Sha256Hash } from './Sha256Hash'
import { JsonValue } from './Storage'
import { Tagged } from './Tagged'

export const commitHashSchema = Sha256Hash.schema as z.ZodPipe<
  z.ZodString,
  z.ZodTransform<CommitHash, string>
>
export type CommitHash = Tagged<Sha256Hash, 'CommitHash'>

export const blobHashSchema = Sha256Hash.schema as z.ZodPipe<
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

export interface CommitMetadataInterface<TJson extends JsonValue = JsonValue> {
  toJson(): TJson
  /**
   * Return true when `this` is the same as `meta`
   *
   * NOTE: metadata has to change in order to commit
   */
  compare(meta: this): boolean
}

export type MetaData = CommitMetadataInterface | undefined

/** Extracts the JSON shape of metadata from a MetaData type parameter */
export type MetaJsonOf<M extends MetaData> =
  M extends CommitMetadataInterface<infer TJson> ? TJson : undefined

export interface CommitJson<
  TMeta extends JsonValue | undefined = JsonValue | undefined,
> {
  blob: string
  createdOn: number
  metadata: TMeta
  parent?: string
}
/**
 * Commit of a change made: [64 byte hash][hex encoded Extension]
 */
export class Commit<M extends MetaData = undefined> {
  constructor(
    readonly hash: CommitHash,
    /** Hash of the blob of code */
    readonly blob: BlobHash,
    readonly createdOn: Date,
    readonly metadata: M,
    /** Hash of parent commit */
    readonly parent?: CommitHash,
  ) {}

  /** Convert data to a hash */
  static async hash(
    blob: BlobHash,
    /** Epoch integer `Date.getTime()` */
    createdOn: number,
    metadata: MetaJsonOf<MetaData>,
    /** Hash of parent commit, null if it is a root commit */
    parent?: CommitHash,
  ): Promise<CommitHash> {
    const metaBytes =
      typeof metadata !== 'undefined'
        ? new TextEncoder().encode(JSON.stringify(metadata))
        : new Uint8Array(0)
    // blob(32) + timestamp(8) + parent(32, optional) + metadata
    const buf = new ArrayBuffer(
      32 + 8 + (parent ? 32 : 0) + metaBytes.byteLength,
    )
    const view = new DataView(buf)
    new Uint8Array(buf).set(blob, 0)
    view.setFloat64(32, createdOn)
    if (parent) new Uint8Array(buf).set(parent, 40)
    new Uint8Array(buf).set(metaBytes, 32 + 8 + (parent ? 32 : 0))
    return (await Sha256Hash.fromBytes(new Uint8Array(buf))) as CommitHash
  }

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
    const hash = await Commit.hash(
      blob,
      createdOn.getTime(),
      metadata?.toJson(),
      parent,
    )
    return new Commit(hash, blob, createdOn, metadata, parent)
  }

  /** Get a json serializable object with only primitive types */
  toJson(): CommitJson<MetaJsonOf<M>> {
    const { metadata, blob, parent, createdOn } = this
    const res = {
      blob: blob.toHex(),
      createdOn: createdOn.getTime(),
      parent: parent?.toHex(),
      ...(metadata ? { metadata: metadata.toJson() } : {}),
    }
    return res as CommitJson<MetaJsonOf<M>>
  }

  toSub() {
    return this.hash.toSub()
  }

  toHex() {
    return this.hash.toHex()
  }
}
