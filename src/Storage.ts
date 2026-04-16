import { Bookmark, BookmarkJson } from './Bookmark'
import {
  CommitHash,
  BlobHash,
  Commit,
  MetaData,
  CommitJson,
  MetaJsonOf,
} from './Commit'

export type JsonPrimitive = string | number | boolean
export type JsonValue =
  | JsonPrimitive
  | (JsonValue | null)[]
  | { [key: string]: JsonValue | null }

/** Generic storage interface for fetching and storing vcs objects */
export interface Storage<M extends MetaData = undefined> {
  /** Get a single commit */
  getCommit(hash: CommitHash): Promise<CommitJson<MetaJsonOf<M>> | null>
  /** Return the full commit data */
  getCommitData(hash: BlobHash): Promise<string | null>

  /**
   * Store a commit with its corresponding data, where `commit.blob` is always the hash of `data`
   * */
  setCommit(commit: Commit<M>, data: string): Promise<void>
  /** Overwrite existing bookmark or set a new one */
  setBookmark(bookmark: Bookmark): Promise<void>
  removeBookmark(name: string): Promise<void>

  /** Get all commits */
  getAllCommits(): Promise<CommitJson<MetaJsonOf<M>>[]>
  /** Get all bookmarks */
  getAllBookmarks(): Promise<BookmarkJson[]>
}
