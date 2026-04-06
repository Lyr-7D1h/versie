import { Bookmark } from './Bookmarks'
import { CommitHash, BlobHash, Commit, MetaData } from './Commit'

export type JsonPrimitive = string | number | boolean
export type JsonValue =
  | JsonPrimitive
  | (JsonValue | null)[]
  | { [key: string]: JsonValue | null }
export type StorageCheckout = { commit: JsonValue; data: Uint8Array }

/** Generic storage interface for fetching and storing vcs objects */
export interface Storage<M extends MetaData> {
  /** Get a single commit */
  getCommit(hash: CommitHash): Promise<JsonValue | null>
  /** Get binary commit data exactly as how it was stored */
  getCommitData(hash: BlobHash): Promise<Uint8Array | null>
  /** Performance improved to get commit and commit data at same time */
  getCheckout(hash: CommitHash): Promise<StorageCheckout | null>

  /**
   * Store a commit with its corresponding data
   * commit.blob is always the hash of this data
   * */
  setCommit(commit: Commit<M>, data: Uint8Array): Promise<void>
  /** Overwrite existing bookmark or set a new one */
  setBookmark(bookmark: Bookmark): Promise<void>
  removeBookmark(name: string): Promise<void>

  /** Get all commits */
  getAllCommits(): Promise<JsonValue[]>
  /** Get all bookmarks */
  getAllBookmarks(): Promise<JsonValue[]>
}
