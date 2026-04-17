import { AsyncResult, Result } from 'typescript-result'
import { JsonValue, Storage } from './Storage'
import {
  BlobHash,
  Commit,
  CommitHash,
  CommitJson,
  MetaData,
  MetaJsonOf,
} from './Commit'
import { Bookmark, BookmarkJson } from './Bookmark'
import { Sha256Hash } from './Sha256Hash'
import { BlobCache, Deltizer } from './Deltizer'

export const COMMITS_STORE = 'commits'
export const BLOB_STORE = 'blobs'
export const BOOKMARKS_STORE = 'bookmarks'
export type StoreName =
  | typeof COMMITS_STORE
  | typeof BLOB_STORE
  | typeof BOOKMARKS_STORE

const VERSION = 1

function unknownErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

class IndexDBStorageCreateBaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class IndexDBStorageOpenError extends IndexDBStorageCreateBaseError {
  readonly type = 'indexdb-open-error'

  constructor(error: unknown) {
    super(`failed to open index db: ${unknownErrorMessage(error)}`)
  }
}

export class IndexDBStorageUpgradeError extends IndexDBStorageCreateBaseError {
  readonly type = 'indexdb-upgrade-error'

  constructor(error: unknown) {
    super(`failed to upgrade index db: ${unknownErrorMessage(error)}`)
  }
}

export type IndexDBStorageCreateError =
  | IndexDBStorageOpenError
  | IndexDBStorageUpgradeError

export type IndexDBStorageOptions<M extends MetaData> = {
  /**
   * Change how delta blobs are fetched, for reconstructing full blobs
   *
   * Useful in the case of blobs being stored outside of IndexDb
   */
  lookupDeltaBlob?: (
    indexdb: IndexDBStorage<M>,
    hash: BlobHash,
  ) => Promise<Uint8Array | null>
  /** Optional delta chain cap forwarded to Deltizer */
  maxDeltaChainCount?: number
  /** Optional cache implementation forwarded to Deltizer */
  deltaCache?: BlobCache
}

/** Handle migrations  */
function migrations(oldVersion: number, db: IDBDatabase) {
  if (oldVersion < 1) {
    db.createObjectStore(BLOB_STORE)

    let os = db.createObjectStore(COMMITS_STORE)
    os.createIndex('blob', 'blob')
    os.createIndex('editorVersion', 'editorVersion')
    os.createIndex('libraries', 'libraries')
    os.createIndex('parent', 'parent')
    os.createIndex('author', 'author')

    os = db.createObjectStore(BOOKMARKS_STORE)
    os.createIndex('name', 'name')
    os.createIndex('commit', 'commit')
    os.createIndex('createdOn', 'createdOn')
  }
}

/** Entry point for fetching all data */
export class IndexDBStorage<M extends MetaData> implements Storage<M> {
  static create<M extends MetaData>(
    options?: IndexDBStorageOptions<M>,
  ): AsyncResult<
    { indexdb: IndexDBStorage<M>; persisted: boolean },
    IndexDBStorageCreateError
  > {
    return Result.fromAsync(async () => {
      // Make storage persistent https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria#does_browser-stored_data_persist
      let persisted = false
      try {
        persisted = await navigator.storage.persisted()
      } catch {
        persisted = false
      }

      if (!persisted) {
        try {
          persisted = await navigator.storage.persist()
        } catch {
          persisted = false
        }
      }

      return await new Promise<
        Result<
          { indexdb: IndexDBStorage<M>; persisted: boolean },
          IndexDBStorageOpenError | IndexDBStorageUpgradeError
        >
      >((resolve) => {
        const req = indexedDB.open('versie', VERSION)
        let settled = false

        const resolveOnce = (
          value: Result<
            { indexdb: IndexDBStorage<M>; persisted: boolean },
            IndexDBStorageOpenError | IndexDBStorageUpgradeError
          >,
        ) => {
          if (settled) return
          settled = true
          resolve(value)
        }

        req.onerror = () => {
          resolveOnce(Result.error(new IndexDBStorageOpenError(req.error)))
        }

        req.onsuccess = () => {
          resolveOnce(
            Result.ok({
              indexdb: new IndexDBStorage(req.result, options),
              persisted,
            }),
          )
        }

        req.onupgradeneeded = (event) => {
          if (event.target === null) {
            resolveOnce(
              Result.error(
                new IndexDBStorageUpgradeError('missing event target'),
              ),
            )
            return
          }
          if (!('result' in event.target)) {
            resolveOnce(
              Result.error(
                new IndexDBStorageUpgradeError('event target missing result'),
              ),
            )
            return
          }

          const db = event.target.result as IDBDatabase
          db.onerror = () => {
            resolveOnce(
              Result.error(
                new IndexDBStorageUpgradeError('database error during upgrade'),
              ),
            )
          }

          try {
            migrations(event.oldVersion, db)
          } catch (error) {
            resolveOnce(Result.error(new IndexDBStorageUpgradeError(error)))
          }
        }
      })
    })
  }

  readonly deltizer: Deltizer
  private constructor(
    private readonly db: IDBDatabase,
    options?: IndexDBStorageOptions<M>,
  ) {
    const lookup =
      options?.lookupDeltaBlob != null
        ? (hash: BlobHash) => options.lookupDeltaBlob!(this, hash)
        : (hash: BlobHash) => this.get(BLOB_STORE, hash)
    this.deltizer = new Deltizer(
      lookup,
      options?.maxDeltaChainCount,
      options?.deltaCache,
    )
  }

  getCommit(hash: CommitHash): Promise<CommitJson<MetaJsonOf<M>> | null> {
    return this.get(COMMITS_STORE, hash)
  }
  async getCommitData(hash: BlobHash): Promise<string | null> {
    return this.deltizer.reconstruct(hash)
  }
  getBookmark(name: string): Promise<JsonValue | null> {
    return this.get(BOOKMARKS_STORE, name) as Promise<JsonValue | null>
  }
  getAllBookmarks(): Promise<BookmarkJson[]> {
    return this.getAll(BOOKMARKS_STORE) as unknown as Promise<BookmarkJson[]>
  }
  getAllCommits(): Promise<CommitJson<MetaJsonOf<M>>[]> {
    return this.getAll(COMMITS_STORE) as unknown as Promise<
      CommitJson<MetaJsonOf<M>>[]
    >
  }

  removeBookmark(id: string): Promise<void> {
    return this.delete(BOOKMARKS_STORE, id)
  }
  setBookmark(bookmark: Bookmark): Promise<void> {
    return this.set(BOOKMARKS_STORE, bookmark.name, bookmark.toJson())
  }
  async setCommit(commit: Commit<M>, data: string): Promise<void> {
    let parentBlobHash: BlobHash | undefined
    if (commit.parent) {
      const parentCommit = await this.getCommit(commit.parent)
      if (
        parentCommit !== null &&
        typeof parentCommit === 'object' &&
        !Array.isArray(parentCommit) &&
        typeof parentCommit['blob'] === 'string'
      ) {
        parentBlobHash = Sha256Hash.fromHex(parentCommit['blob']) as BlobHash
      }
    }
    const { data: bytes } = await this.deltizer.construct(data, parentBlobHash)
    const trans = this.db.transaction([COMMITS_STORE, BLOB_STORE], 'readwrite')
    await new Promise<void>((resolve, reject) => {
      trans.oncomplete = () => {
        resolve()
      }
      trans.onerror = (event) => {
        const err =
          trans.error ?? (event.target as IDBRequest | undefined)?.error
        reject(
          new Error(
            `Failed to create commit transaction: ${err?.message ?? 'unknown error'}`,
          ),
        )
      }

      const commitsStore = trans.objectStore(COMMITS_STORE)
      const commitReq = commitsStore.put(commit.toJson(), commit.hash)
      commitReq.onerror = (event) => {
        const err =
          trans.error ?? (event.target as IDBRequest | undefined)?.error
        reject(
          new Error(`Failed to add commit: ${err?.message ?? 'unknown error'}`),
        )
      }

      const blobsStore = trans.objectStore(BLOB_STORE)
      const blobReq = blobsStore.put(bytes, commit.blob)
      blobReq.onerror = (event) => {
        const err =
          trans.error ?? (event.target as IDBRequest | undefined)?.error
        reject(
          new Error(`Failed to add blob: ${err?.message ?? 'unknown error'}`),
        )
      }
    })
  }

  async set(
    storeName: typeof COMMITS_STORE,
    id: CommitHash,
    /** Commit as json value */
    value: CommitJson<MetaJsonOf<M>>,
  ): Promise<void>
  async set(
    storeName: typeof BLOB_STORE,
    id: BlobHash,
    /** Compressed delta blob */
    value: Uint8Array,
  ): Promise<void>
  async set(
    storeName: typeof BOOKMARKS_STORE,
    id: string,
    /** Bookmark as json value */
    value: BookmarkJson,
  ): Promise<void>
  async set(storeName: StoreName, id: IDBValidKey, value: unknown) {
    const trans = this.db.transaction(storeName, 'readwrite')
    await new Promise<void>((resolve, reject) => {
      trans.oncomplete = () => {
        resolve()
      }
      trans.onerror = (_e) => {
        reject(new Error(`failed to set value: ${trans.error?.message ?? ''}`))
      }

      const store = trans.objectStore(storeName)
      // TODO(perf): Use add() to prevent overwriting existing data and doing a write operation, needs to catch the error constraint however which can proof to be tricky for different browser environment
      const req = store.put(value, id)
      req.onsuccess = () => {
        resolve()
      }
      req.onerror = (_e) => {
        reject(new Error(`failed to set item: ${req.error?.message ?? ''}`))
      }
    })
  }
  delete(storeName: typeof BOOKMARKS_STORE, name: string): Promise<void>
  async delete(storeName: StoreName, id: IDBValidKey) {
    const trans = this.db.transaction(storeName, 'readwrite')
    await new Promise<void>((resolve, reject) => {
      trans.oncomplete = () => {
        resolve()
      }
      trans.onerror = (_e) => {
        reject(
          new Error(`failed to delete value: ${trans.error?.message ?? ''}`),
        )
      }

      const store = trans.objectStore(storeName)
      const req = store.delete(id)
      req.onsuccess = () => {
        resolve()
      }
      req.onerror = (_e) => {
        reject(new Error(`failed to delete item: ${req.error?.message ?? ''}`))
      }
    })
  }

  /** Get compressed delta blob */
  async get(
    storeName: typeof BLOB_STORE,
    hash: BlobHash,
  ): Promise<Uint8Array | null>
  /** Get commit json */
  async get(
    storeName: typeof COMMITS_STORE,
    hash: CommitHash,
  ): Promise<CommitJson<MetaJsonOf<M>> | null>
  /** Get bookmark json */
  async get(
    storeName: typeof BOOKMARKS_STORE,
    name: string,
  ): Promise<BookmarkJson | null>
  async get(
    storeName: StoreName,
    query: IDBValidKey | IDBKeyRange,
  ): Promise<
    CommitJson<MetaJsonOf<M>> | BookmarkJson | JsonValue | Uint8Array | null
  > {
    const trans = this.db.transaction(storeName)
    return await new Promise((resolve, reject) => {
      trans.onerror = (_e) => {
        reject(new Error(`failed to set value: ${trans.error?.message ?? ''}`))
      }
      const store = trans.objectStore(storeName)
      const req = store.get(query)
      req.onsuccess = () => {
        if (typeof req.result === 'undefined') {
          resolve(null)
          return
        }
        resolve(req.result as JsonValue)
      }
      req.onerror = (_e) => {
        reject(new Error(`failed to get item: ${req.error?.message ?? ''}`))
      }
    })
  }
  async getAll(storename: StoreName): Promise<JsonValue[]> {
    const trans = this.db.transaction(storename, 'readonly')
    return await new Promise((resolve, reject) => {
      trans.onerror = (_e) => {
        reject(
          new Error(`failed to get all commits: ${trans.error?.message ?? ''}`),
        )
      }
      const store = trans.objectStore(storename)
      const req = store.getAll()
      req.onsuccess = () => {
        resolve(req.result)
      }
      req.onerror = (_e) => {
        reject(
          new Error(`failed to get all commits: ${req.error?.message ?? ''}`),
        )
      }
    })
  }

  /**
   * Import indexdb data
   *
   * NOTE: Skips inner validation due to performance overhead
   * */
  async import(data: IndexdbImport) {
    if (data.version !== VERSION) {
      throw Error('Import version mismatch')
    }
    const trans = this.db.transaction(
      [COMMITS_STORE, BLOB_STORE, BOOKMARKS_STORE],
      'readwrite',
    )

    const writeEntries = (
      store: IDBObjectStore,
      entries: Array<{ key: string; value: JsonValue }>,
      isKeyBinary: boolean,
      isValueBinary: boolean,
      reject: (reason?: unknown) => void,
    ) => {
      for (const entry of entries) {
        const key = isKeyBinary
          ? Sha256Hash.fromBase64(entry.key, true)
          : entry.key
        const value = isValueBinary
          ? dataFromString(entry.value as string)
          : entry.value
        const req = store.put(value, key)
        req.onerror = () => {
          reject(
            new Error(
              `Import write failed for ${store.name}: ${req.error?.message ?? ''}`,
            ),
          )
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      trans.oncomplete = () => {
        resolve()
      }
      trans.onerror = (_e) => {
        reject(
          new Error(`Import transaction failed: ${trans.error?.message ?? ''}`),
        )
      }

      const commitsStore = trans.objectStore(COMMITS_STORE)
      const blobsStore = trans.objectStore(BLOB_STORE)
      const bookmarksStore = trans.objectStore(BOOKMARKS_STORE)

      writeEntries(commitsStore, data.commits, true, false, reject)
      writeEntries(blobsStore, data.blobs, true, true, reject)
      writeEntries(bookmarksStore, data.bookmarks, false, false, reject)
    })
  }

  /**
   * export indexdb data
   *
   * NOTE: Skips inner validation due to performance overhead
   * */
  async export(): Promise<IndexdbImport> {
    const [commits, blobs, bookmarks] = await Promise.all(
      [COMMITS_STORE, BLOB_STORE, BOOKMARKS_STORE].map((storeName) => {
        const t = this.db.transaction(storeName, 'readonly')
        return new Promise<Array<{ key: string; value: JsonValue }>>(
          (resolve, reject) => {
            t.onerror = (_e) => {
              reject(
                new Error(
                  `Export transaction failed: ${t.error?.message ?? ''}`,
                ),
              )
            }
            const store = t.objectStore(storeName)
            const req = store.openCursor()
            const results: Array<{ key: string; value: JsonValue }> = []

            req.onsuccess = () => {
              const cursor = req.result
              if (cursor) {
                // Convert key to string
                let keyStr: string
                const key = cursor.key

                const isBinaryKeyStore =
                  storeName === COMMITS_STORE || storeName === BLOB_STORE

                const isBinaryValueStore = storeName === BLOB_STORE

                if (isBinaryKeyStore) {
                  // cursor.key for binary stores is returned as ArrayBuffer per IDB spec
                  const normalizedKeyBytes = new Uint8Array(key as ArrayBuffer)
                  keyStr = Sha256Hash.create(normalizedKeyBytes).toBase64(true)
                } else if (typeof key === 'string') {
                  keyStr = key
                } else if (typeof key === 'number') {
                  keyStr = key.toString()
                } else {
                  keyStr = JSON.stringify(key)
                }

                results.push({
                  key: keyStr,
                  value: isBinaryValueStore
                    ? (dataToString(cursor.value as Uint8Array) as JsonValue)
                    : (cursor.value as JsonValue),
                })
                cursor.continue()
              } else {
                // No more entries
                resolve(results)
              }
            }

            req.onerror = (_e) => {
              reject(new Error(`Export failed ${req.error?.message ?? ''}`))
            }
          },
        )
      }),
    )

    return {
      version: VERSION,
      commits: commits!,
      blobs: blobs!,
      bookmarks: bookmarks!,
    }
  }
}

function dataToString(value: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < value.length; i += chunkSize) {
    const chunk = value.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function dataFromString(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** A generic type for importing and exporting data */
export interface IndexdbImport {
  version: number
  bookmarks: Array<{ key: string; value: JsonValue }>
  commits: Array<{ key: string; value: JsonValue }>
  blobs: Array<{ key: string; value: JsonValue }>
}
