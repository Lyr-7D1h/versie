import { LRUCache } from 'lru-cache'
import diff from 'fast-diff'
import { BlobHash } from './Commit'
import { Sha256Hash } from './Sha256Hash'
import { VersieError } from './VersieError'

const COMPRESSION_FORMAT = 'deflate'

/** An error that happened when trying to turn commit data in deltas */
export class DeltizingError extends VersieError {
  readonly type = 'blob-storage-error'
}

/** Lookup operation for fetching deltizer compressed data */
type LookupBlob = (hash: BlobHash) => Promise<Uint8Array | null>
export interface DeltaChainCountCache {
  get(hash: BlobHash): number | undefined
  set(hash: BlobHash, count: number): void
}

/** In memory delta chain count cache */
export class LRUDeltaChainCountCache implements DeltaChainCountCache {
  private readonly cache: LRUCache<BlobHash, number>

  constructor(max = 200) {
    this.cache = new LRUCache({ max })
  }

  get(hash: BlobHash): number | undefined {
    return this.cache.get(hash)
  }

  set(hash: BlobHash, count: number): void {
    this.cache.set(hash, count)
  }
}

// TODO: Run in web worker, diffing algorithm can be expensive
/**
 * Handle how blobs are stored by weighing if it should be turned into a delta and compressing string values
 *
 * Binary format of a blob is
 *
 * ```
 * 0  3  7  11  15  19  23  27  31
 * | 0x00| BLOB DATA...
 * ```
 *
 * Binary format of a delta is
 *
 * ```
 * 0  3  7  11  15  19  23  27  31
 * | 0x01|
 *
 *
 *
 *
 *        BLOB HASH (32 bytes)
 *
 *
 *
 *       | DELTA OPERATIONS...
 *```
 * */
export class Deltizer {
  constructor(
    /** The lookup operation for commit data */
    readonly lookup: LookupBlob,
    /** Cache for getting the amount of deltas this commit is counting on */
    readonly deltaChainCountCache: DeltaChainCountCache = new LRUDeltaChainCountCache(),
    /**
     * Cap of the number of deltas that may be chained for a blob. Once the cap is reached, the blob is stored as a full blob instead of another delta.
     *
     * Constructing a delta chain requires reading and applying each delta in sequence. So lookup costs grow with chain depth. */
    private readonly maxDeltaChainCount: number = 50,
  ) {}

  /**
   * Returns null if `hash` could not be found.
   * Throws a `DeltizingError` if the stored blob data has an unknown type or if a delta cannot be reconstructed because its base blob is missing.
   */
  async reconstruct(hash: BlobHash): Promise<string | null> {
    const data = await this.lookup(hash)
    if (data === null) return null
    const type = data[0]
    if (type === 0x00) {
      const decompressed = await decompressBytes(data.subarray(1))
      return new TextDecoder().decode(decompressed)
    } else if (type === 0x01) {
      return this.reconstructFromDelta(data)
    }
    throw new DeltizingError(`Unknown data type: ${type}`)
  }

  /** Recursive function to resolve delta */
  private async reconstructFromDelta(blob: Uint8Array): Promise<string | null> {
    const delta = await decompressBytes(blob.subarray(1))
    const { base: baseHash, ops } = dedeltize(delta)
    const base = await this.reconstruct(baseHash)
    if (base === null)
      throw new DeltizingError(
        'Failed to construct base from hash ' + baseHash.toHex(),
      )
    let result = ''
    for (const op of ops) {
      switch (op.type) {
        case DeltaType.Copy: {
          result += base.slice(op.offset, op.offset + op.length)
          continue
        }
        case DeltaType.Insert: {
          result += op.data
          continue
        }
      }
    }
    return result
  }

  /** Get delta chain count for a baseHash that can be referencing a blob or delta, throwing an error if it could not be found */
  async getDeltaCount(baseHash: BlobHash): Promise<number> {
    const cached = this.deltaChainCountCache.get(baseHash)
    if (cached != null) {
      return cached
    }

    const raw = await this.lookup(baseHash)
    if (raw === null)
      throw new DeltizingError(
        'Failed to construct base from hash ' + baseHash.toHex(),
      )

    const type = raw[0]
    if (type === 0x00) {
      this.deltaChainCountCache.set(baseHash, 0)
      return 0
    }
    if (type !== 0x01) {
      throw new DeltizingError(`Unknown data type: ${type}`)
    }
    const delta = await decompressBytes(raw.subarray(1))

    // get count from base and add 1
    const base = Sha256Hash.fromBuffer(delta.slice(0, 32)) as BlobHash
    // chain count is previous + 1
    const baseCount = await this.getDeltaCount(base)
    const count = baseCount + 1
    this.deltaChainCountCache.set(baseHash, count)
    return count
  }

  /** Return a compressed blob or delta */
  async construct(value: string, base?: BlobHash): Promise<Uint8Array> {
    if (base) {
      const baseValue = await this.shouldStoreAsDelta(value, base)
      if (baseValue !== false) {
        const delta = deltize(base, baseValue, value)
        const compressedDelta = await compressBytes(delta)
        const deltaBytes = new Uint8Array(1 + compressedDelta.length)
        deltaBytes[0] = 0x01
        deltaBytes.set(compressedDelta, 1)
        return deltaBytes
      }
    }

    const encoder = new TextEncoder()
    const blob = encoder.encode(value)
    const compressedBlob = await compressBytes(blob)
    const blobBytes = new Uint8Array(1 + compressedBlob.length)
    blobBytes[0] = 0x00
    blobBytes.set(compressedBlob, 1)
    return blobBytes
  }

  /**
   * Estimate if the change is big enough that it should be stored as a delta
   *
   * @returns null if hash not found, false if should not be stored as delta, string with value of base if should be stored
   * */
  async shouldStoreAsDelta(
    value: string,
    base: BlobHash,
  ): Promise<string | false> {
    // skip deltize if value is very small
    // minimum delta overhead is roughly:
    // id + blob hash + 1 copy delta op + 1 insert delta op
    // = 1 + 32 + 12 + ~14 bytes ~= 57 bytes
    // use a conservative 64-byte cutoff by rounding that estimate up
    if (value.length < 64) return false

    const count = await this.getDeltaCount(base)
    if (count > this.maxDeltaChainCount) {
      return false
    }

    // Quick estimate of how different the strings are
    const baseValue = await this.reconstruct(base)

    if (baseValue === null)
      throw new DeltizingError(
        'Failed to construct base from hash ' + base.toHex(),
      )

    if (baseValue.length === 0) return false

    const maxLen = Math.max(baseValue.length, value.length)
    const lengthDiff = Math.abs(baseValue.length - value.length)
    // if difference in length is bigger
    if (lengthDiff / maxLen > 0.8) {
      return false
    }

    const changeEstimate = changeSizeSamplingEstimate(baseValue, value, maxLen)
    // if change is higher than 90% skip deltizing, estimation has high error
    if (changeEstimate > 0.9) {
      return false
    }

    return baseValue
  }
}

async function compressBytes(data: Uint8Array): Promise<Uint8Array> {
  const normalized = Uint8Array.from(data)
  const compressed = await new Response(
    new Blob([normalized])
      .stream()
      .pipeThrough(new CompressionStream(COMPRESSION_FORMAT)),
  ).arrayBuffer()
  return new Uint8Array(compressed)
}

async function decompressBytes(data: Uint8Array): Promise<Uint8Array> {
  const normalized = Uint8Array.from(data)
  const decompressed = await new Response(
    new Blob([normalized])
      .stream()
      .pipeThrough(new DecompressionStream(COMPRESSION_FORMAT)),
  ).arrayBuffer()
  return new Uint8Array(decompressed)
}

/**
 * Quickly estimate how much two strings differ (0 = identical, 1 = completely different)
 * Uses common prefix/suffix
 */
function changeSizeSamplingEstimate(
  base: string,
  value: string,
  maxLen: number,
): number {
  if (base === value) return 0
  if (base.length === 0 || value.length === 0) return 1

  const minLen = Math.min(base.length, value.length)

  // 2. Find common prefix length
  let prefixLen = 0
  const checkLen = Math.min(minLen, 1000) // Only check first 1000 chars for speed
  for (let i = 0; i < checkLen; i++) {
    if (base[i] === value[i]) {
      prefixLen++
    } else {
      break
    }
  }

  // 3. Find common suffix length (check last 1000 chars)
  let suffixLen = 0
  const suffixCheckLen = Math.min(minLen - prefixLen, 1000)
  for (let i = 1; i <= suffixCheckLen; i++) {
    if (base[base.length - i] === value[value.length - i]) {
      suffixLen++
    } else {
      break
    }
  }

  // Common content (as fraction of total)
  const commonLen = prefixLen + suffixLen
  return 1 - commonLen / maxLen
}

/**
 * Encodes delta operations into a binary format using fast-diff
 * Format:
 * - 32 bytes: base hash
 * - For each operation:
 *   - Copy: [0x00][offset:4][length:4]
 *   - Insert: [0x01][length:4][data:length]
 */
type RawDeltaOp =
  | { type: DeltaType.Copy; offset: number; length: number }
  | { type: DeltaType.Insert; data: Uint8Array }

function deltize(baseHash: BlobHash, base: string, value: string): Uint8Array {
  const ops: RawDeltaOp[] = []

  // Use fast-diff to compute the differences
  // diff returns: [op, text] where op is -1 (delete), 0 (equal), 1 (insert)
  const diffs = diff(base, value)

  let charOffset = 0

  for (const [op, text] of diffs) {
    switch (op) {
      case -1: {
        // Delete - skip these characters in the base
        charOffset += text.length
        break
      }
      case 0: {
        // Equal - this is a copy operation
        ops.push({
          type: DeltaType.Copy,
          offset: charOffset,
          length: text.length,
        })
        charOffset += text.length
        break
      }
      case 1: {
        // Insert - add new content (op === 1)
        ops.push({
          type: DeltaType.Insert,
          data: new TextEncoder().encode(text),
        })
        break
      }
    }
  }

  // Calculate total size needed
  let bufferByteSize = 32 // base hash 256/8 bytes
  for (const op of ops) {
    if (op.type === DeltaType.Copy) {
      bufferByteSize += 1 + 4 + 4 // type + offset + length
    } else {
      bufferByteSize += 1 + 4 + op.data.length // type + length + data
    }
  }

  // Encode into binary format
  const buffer = new Uint8Array(bufferByteSize)
  const view = new DataView(buffer.buffer)
  let offset = 0

  // Write base hash (BlobHash is a Sha256Hash which has a .hash property)
  buffer.set(baseHash, offset)
  offset += 32

  // Write operations
  for (const op of ops) {
    if (op.type === DeltaType.Copy) {
      buffer[offset++] = DeltaType.Copy
      view.setUint32(offset, op.offset, true) // little-endian
      offset += 4
      view.setUint32(offset, op.length, true)
      offset += 4
    } else {
      buffer[offset++] = DeltaType.Insert
      const data = op.data
      view.setUint32(offset, data.length, true)
      offset += 4
      buffer.set(data, offset)
      offset += data.length
    }
  }

  return buffer
}

type Delta = {
  base: BlobHash
  ops: DeltaOperation[]
}
type DeltaOperation =
  | {
      type: DeltaType.Copy
      /** Character offset */
      offset: number
      /** Character length */
      length: number
    }
  | { type: DeltaType.Insert; data: string }

enum DeltaType {
  Copy = 0,
  Insert = 1,
}
/** Convert a base with a delta to the full original blob */
function dedeltize(data: Uint8Array): Delta {
  const base = Sha256Hash.fromBuffer(data.slice(0, 32)) as BlobHash
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  const ops: DeltaOperation[] = []
  let offset = 32
  while (offset < data.length) {
    const type = data[offset++]
    if (type === DeltaType.Copy) {
      const copyOffset = view.getUint32(offset, true)
      offset += 4
      const length = view.getUint32(offset, true)
      offset += 4

      ops.push({ type, offset: copyOffset, length })
    } else if (type === DeltaType.Insert) {
      const length = view.getUint32(offset, true)
      offset += 4
      const textData = data.subarray(offset, offset + length)
      const text = new TextDecoder().decode(textData)
      offset += length

      ops.push({ type, data: text })
    }
  }

  return {
    base,
    ops,
  }
}
