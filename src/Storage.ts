import { Bookmark } from './Bookmarks'
import { CommitHash, BlobHash, Commit, MetaData } from './Commit'

export type JsonPrimitive = string | number | boolean
export type JsonValue =
  | JsonPrimitive
  | (JsonValue | null)[]
  | { [key: string]: JsonValue | null }

/** Generic storage interface for fetching and storing vcs objects */
export interface Storage<M extends MetaData> {
  getBookmark(name: string): Promise<JsonValue | null>
  getCommit(hash: CommitHash): Promise<JsonValue | null>
  getCommitData(hash: BlobHash): Promise<Uint8Array>

  /** Overwrite existing bookmark or set a new one */
  setBookmark(bookmark: Bookmark): Promise<void>
  /**
   * Store a commit with its corresponding data
   * commit.blob is always the hash of this data
   * */
  setCommit(commit: Commit<M>, data: Uint8Array): Promise<void>

  removeBookmark(name: string): Promise<void>

  getAllCommitData(): Promise<Uint8Array[]>
  getAllCommits(): Promise<JsonValue[]>
  getAllBookmarks(): Promise<JsonValue[]>
}
